-- Outbound email through Resend (free tier: 3,000 emails/month), sent straight
-- from the database every minute by pg_cron + pg_net. No extra server needed.
--
-- To switch sending on (once, in the Supabase SQL editor, never in chat):
--   select vault.create_secret('re_xxx_your_resend_key', 'resend_api_key');
--   update settings set value = '"Your Brand <hello@yourdomain.com>"' where key = 'email_from';
--   update settings set value = '"https://www.yourdomain.com"' where key = 'site_url';
-- Until the key exists, emails simply wait in the notifications queue.

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
end $$;

alter table notifications add column if not exists attempts int not null default 0;
alter table notifications add column if not exists request_id bigint;

insert into settings (key, value) values
  ('email_from', '"Bloomvow <hello@example.com>"'),
  ('site_url', '"https://www.example.com"')
on conflict (key) do nothing;

create or replace function html_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- The Resend key lives in Supabase Vault. Tests set bloomvow.test_email_key instead.
create or replace function email_api_key() returns text
language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1$q$ into k;
  end if;
  return coalesce(k, nullif(current_setting('bloomvow.test_email_key', true), ''));
end $$;

-- Subject + body for each notification kind.
create or replace function render_email(n notifications, out subject text, out html text, out reply_to text)
language plpgsql stable security definer set search_path = public as $$
declare
  site text := (select value #>> '{}' from settings where key = 'site_url');
  brand text := (select regexp_replace(value #>> '{}', '\s*<.*$', '') from settings where key = 'email_from');
  l leads; c cities; body text;
begin
  if n.payload ? 'lead_id' then
    select * into l from leads where id = (n.payload->>'lead_id')::uuid;
    select * into c from cities where id = l.city_id;
  end if;
  case n.kind
  when 'lead_to_vendor' then
    subject := format('New wedding enquiry from %s%s', l.couple_name, coalesce(' for ' || to_char(l.wedding_date, 'Mon FMDD, YYYY'), ''));
    reply_to := l.email;
    body := format('<p>Hi %s,</p><p><b>%s</b> would like pricing and availability.</p><table cellpadding="4">'
      || '<tr><td>Wedding date</td><td><b>%s</b>%s</td></tr><tr><td>Guests</td><td><b>%s</b></td></tr><tr><td>City</td><td><b>%s</b></td></tr>'
      || '<tr><td>Email</td><td><b>%s</b></td></tr>%s</table>%s'
      || '<p>Reply to this email to answer them directly%s.</p>',
      html_esc(n.payload->>'vendor_name'), html_esc(l.couple_name),
      coalesce(to_char(l.wedding_date, 'FMMonth FMDD, YYYY'), 'Not set'), case when l.date_flexible then ' (flexible)' else '' end,
      coalesce(l.guests::text, 'Not given'), html_esc(c.name), html_esc(l.email),
      case when l.phone is not null then format('<tr><td>Phone</td><td><b>%s</b></td></tr>', html_esc(l.phone)) else '' end,
      case when l.message is not null then format('<blockquote style="border-left:3px solid #c2577a;padding-left:12px">%s</blockquote>', replace(html_esc(l.message), E'\n', '<br>')) else '' end,
      case when (n.payload->>'claimed')::boolean
        then format(', or <a href="%s/vendor-dashboard/">open your lead inbox</a> to reply with one tap. Fast replies win more bookings', site)
        else format('. <a href="%s/for-vendors/?claim=%s">Claim your free listing</a> to manage leads, add photos and pricing', site, n.payload->>'vendor_id') end);
  when 'reply_to_couple' then
    subject := format('%s replied to your wedding enquiry', n.payload->>'vendor_name');
    reply_to := n.payload->>'reply_to';
    body := format('<p>Hi %s,</p><p><b>%s</b> replied:</p><blockquote style="border-left:3px solid #c2577a;padding-left:12px">%s</blockquote><p>Reply to this email to continue the conversation.</p>',
      html_esc(l.couple_name), html_esc(n.payload->>'vendor_name'), replace(html_esc(n.payload->>'reply'), E'\n', '<br>'));
  when 'lead_reminder' then
    subject := format('Reminder: %s is waiting for your reply', l.couple_name);
    reply_to := l.email;
    body := format('<p>Hi %s,</p><p>%s asked about your pricing yesterday and hasn''t heard back yet. Couples usually book one of the first vendors who reply.</p><p>Reply to this email to answer them, or <a href="%s/vendor-dashboard/">open your lead inbox</a>.</p>',
      html_esc(n.payload->>'vendor_name'), html_esc(l.couple_name), site);
  when 'claim_decided' then
    subject := case when (n.payload->>'approved')::boolean then 'Your listing is ready to manage' else 'About your listing claim' end;
    body := case when (n.payload->>'approved')::boolean
      then format('<p>Good news: your claim was approved. <a href="%s/vendor-dashboard/">Sign in to your dashboard</a> to add photos, packages and pricing.</p>', site)
      else '<p>We couldn''t verify your claim from the details provided. Reply to this email with proof you own the business (for example an email from your business domain) and we''ll take another look.</p>' end;
  else
    subject := brand || ' update'; body := '<p>' || html_esc(n.payload::text) || '</p>';
  end case;
  html := format('<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f1a2e;max-width:560px">%s<p style="color:#7a7287;font-size:12px;margin-top:24px">%s · <a href="%s" style="color:#7a7287">%s</a></p></div>',
    body, html_esc(brand), site, regexp_replace(site, '^https?://', ''));
end $$;

-- Low-level send (a separate function so tests can replace it).
create or replace function email_http_post(body jsonb, api_key text) returns bigint
language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into rid using 'https://api.resend.com/emails', body,
    jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json');
  return rid;
end $$;

-- Response check (separate for the same reason). Returns null while pending.
create or replace function email_http_result(rid bigint, out ok boolean, out err text)
language plpgsql security definer set search_path = public as $$
declare st int; content text; failed text;
begin
  execute 'select status_code, content, error_msg from net._http_response where id = $1' into st, content, failed using rid;
  if st is null and failed is null then ok := null; return; end if;
  ok := st between 200 and 299;
  err := case when ok then null else left(coalesce(failed, st::text || ' ' || content), 500) end;
end $$;

-- Called every minute by pg_cron: settle earlier requests, then send up to 40 more.
create or replace function send_pending_emails() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  api_key text := email_api_key();
  sender text := (select s.value #>> '{}' from settings s where s.key = 'email_from');
  n notifications; r record; e record; sent int := 0; queued int := 0;
begin
  for n in select * from notifications where sent_at is null and request_id is not null loop
    select * into r from email_http_result(n.request_id);
    if r.ok is null then
      if n.created_at < now() - interval '1 day' then update notifications set request_id = null, error = 'no response' where id = n.id; end if;
    elsif r.ok then update notifications set sent_at = now(), error = null where id = n.id; sent := sent + 1;
    else update notifications set request_id = null, error = r.err where id = n.id;
    end if;
  end loop;

  if api_key is null then return jsonb_build_object('sent', sent, 'queued', 0, 'note', 'no resend_api_key in vault'); end if;
  for n in select * from notifications where sent_at is null and request_id is null and attempts < 5
           and kind in ('lead_to_vendor', 'reply_to_couple', 'lead_reminder', 'claim_decided')
           order by created_at limit 40 for update skip locked loop
    select * into e from render_email(n);
    update notifications set attempts = attempts + 1, request_id = email_http_post(jsonb_strip_nulls(jsonb_build_object(
      'from', sender, 'to', jsonb_build_array(n.to_email), 'subject', e.subject, 'html', e.html, 'reply_to', e.reply_to)), api_key)
    where id = n.id;
    queued := queued + 1;
  end loop;
  return jsonb_build_object('sent', sent, 'queued', queued);
end $$;

-- ------------------------------------------------ click/view event rollup
-- Raw events older than 120 days are summarised into daily totals and deleted,
-- keeping the free 500 MB database small. Dashboards show the last 90 days.
create table if not exists event_daily (
  vendor_id uuid references vendors(id) on delete cascade,
  day       date not null,
  kind      text not null,
  n         int not null,
  unique nulls not distinct (vendor_id, day, kind)
);
alter table event_daily enable row level security;
create policy event_daily_admin on event_daily for select to authenticated using (is_admin());

create or replace function rollup_events(keep_days int default 120) returns int
language plpgsql security definer set search_path = public as $$
declare cutoff timestamptz := date_trunc('day', now() - make_interval(days => keep_days)); n int;
begin
  insert into event_daily (vendor_id, day, kind, n)
  select vendor_id, created_at::date, kind, count(*) from events where created_at < cutoff group by 1, 2, 3
  on conflict (vendor_id, day, kind) do update set n = event_daily.n + excluded.n;
  delete from events where created_at < cutoff;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function email_api_key(), render_email(notifications), email_http_post(jsonb, text), email_http_result(bigint),
  send_pending_emails(), rollup_events(int) from public, anon, authenticated;

-- ---------------------------------------------------------- schedules
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('send-emails', '* * * * *', 'select public.send_pending_emails()');
    perform cron.schedule('lead-reminders', '17 * * * *', 'select public.queue_lead_reminders()');
    perform cron.schedule('rollup-events', '23 3 * * *', 'select public.rollup_events()');
  end if;
end $$;
