-- Customer inbox ("My Celebrateio") and the emails around a lead.
--
-- * Vendors get a short "new lead" email: what and where, never the customer's name or
--   contact details. Claimed vendors are sent to their dashboard to read and reply; unclaimed
--   vendors are asked to claim their free listing first (they see the lead once approved).
-- * Vendor replies and customer answers are kept as a conversation (lead_messages). When a
--   vendor replies, the customer gets an email from the site asking them to read it in their
--   inbox; when the customer answers, the vendor is emailed the same way.
-- * Customers don't need a password: every email to them carries a personal link
--   (/account/?t=...), valid 90 days; they can ask for a fresh one with their email address.
--   Only a hash of each link is stored.
-- * After a request, the customer gets a confirmation with their inbox link.
-- * Emails older than 7 days that were never sent (e.g. before sending was switched on) are
--   dropped instead of going out late.

-- Real defaults for this site (only where the placeholders from 012 are still set).
update settings set value = '"Celebrateio <hello@celebrateio.com>"' where key = 'email_from' and value #>> '{}' like '%example.com%';
update settings set value = '"https://celebrateio.com"' where key = 'site_url' and value #>> '{}' like '%example.com%';

-- --------------------------------------------------------------- conversation
create table if not exists lead_messages (
  id          bigserial primary key,
  lead_id     uuid not null,
  vendor_id   uuid not null,
  sender      text not null check (sender in ('vendor', 'customer')),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,                       -- read by the other side
  foreign key (lead_id, vendor_id) references lead_recipients (lead_id, vendor_id) on delete cascade
);
create index if not exists lead_messages_thread_idx on lead_messages (lead_id, vendor_id, created_at);
create index if not exists lead_messages_vendor_idx on lead_messages (vendor_id, created_at desc);
alter table lead_messages enable row level security;
drop policy if exists lead_messages_vendor_read on lead_messages;
create policy lead_messages_vendor_read on lead_messages for select to authenticated using (owns_vendor(vendor_id) or is_admin());
revoke all on lead_messages from anon;
revoke insert, update, delete on lead_messages from authenticated;

-- Existing vendor replies become the first message of each conversation.
insert into lead_messages (lead_id, vendor_id, sender, body, created_at)
select lr.lead_id, lr.vendor_id, 'vendor', left(lr.reply, 4000), coalesce(lr.replied_at, lr.sent_at)
from lead_recipients lr
where lr.reply is not null and btrim(lr.reply) <> ''
  and not exists (select 1 from lead_messages m where m.lead_id = lr.lead_id and m.vendor_id = lr.vendor_id);

-- ------------------------------------------------------------ customer links
create table if not exists customer_tokens (
  token_hash  text primary key,
  email       text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '90 days',
  last_used_at timestamptz
);
create index if not exists customer_tokens_email_idx on customer_tokens (email);
alter table customer_tokens enable row level security;     -- no policies: functions only
revoke all on customer_tokens from anon, authenticated;

create or replace function issue_customer_token(p_email text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  delete from customer_tokens where expires_at < now();
  insert into customer_tokens (token_hash, email) values (encode(sha256(convert_to(t, 'UTF8')), 'hex'), lower(btrim(p_email)));
  return t;
end $$;

-- The email a link belongs to, or an error when it's unknown or expired.
create or replace function customer_email(p_token text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare e text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'invalid_link' using errcode = '28000'; end if;
  update customer_tokens set last_used_at = now()
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and expires_at > now()
  returning email into e;
  if e is null then raise exception 'invalid_link' using errcode = '28000'; end if;
  return e;
end $$;

-- ------------------------------------------------------------ customer side
-- Everything the customer's inbox shows: their requests of the last 12 months, each with the
-- vendors it went to and the conversation with each.
create or replace function customer_inbox(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare e text := customer_email(p_token);
begin
  return jsonb_build_object(
    'email', e,
    'name', (select couple_name from leads where lower(email) = e order by created_at desc limit 1),
    'requests', coalesce((select jsonb_agg(r order by r->>'created_at' desc) from (
      select jsonb_build_object(
        'lead_id', l.id, 'created_at', l.created_at, 'source', l.source, 'message', l.message,
        'wedding_date', l.wedding_date, 'date_flexible', l.date_flexible, 'guests', l.guests,
        'city', (select ci.name || ', ' || upper(rg.code) from cities ci join regions rg on rg.id = ci.region_id where ci.id = l.city_id),
        'categories', (select coalesce(jsonb_agg(c.name order by c.sort), '[]') from categories c where c.id = any (l.category_ids)),
        'vendors', coalesce((select jsonb_agg(jsonb_build_object(
            'vendor_id', v.id, 'name', v.name, 'slug', v.slug, 'claimed', v.status = 'claimed',
            'category', (select c.singular from categories c where c.id = v.category_id),
            'photo', (select ph.url from photos ph where ph.vendor_id = v.id order by ph.sort limit 1),
            'sent_at', lr.sent_at, 'seen', lr.opened_at is not null, 'replied', lr.replied_at is not null,
            'unread', (select count(*) from lead_messages m where m.lead_id = l.id and m.vendor_id = v.id and m.sender = 'vendor' and m.read_at is null),
            'last_at', coalesce((select max(m.created_at) from lead_messages m where m.lead_id = l.id and m.vendor_id = v.id), lr.sent_at),
            'messages', coalesce((select jsonb_agg(jsonb_build_object('from', m.sender, 'body', m.body, 'at', m.created_at) order by m.created_at)
                                  from lead_messages m where m.lead_id = l.id and m.vendor_id = v.id), '[]'))
            order by lr.replied_at desc nulls last, v.name)
          from lead_recipients lr join vendors v on v.id = lr.vendor_id where lr.lead_id = l.id), '[]')
      ) as r
      from leads l where lower(l.email) = e and l.status <> 'spam' and l.created_at > now() - interval '12 months'
    ) x), '[]'));
end $$;

create or replace function customer_mark_read(p_token text, p_lead uuid, p_vendor uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare e text := customer_email(p_token);
begin
  update lead_messages m set read_at = now()
  from leads l where l.id = m.lead_id and lower(l.email) = e
    and m.lead_id = p_lead and m.vendor_id = p_vendor and m.sender = 'vendor' and m.read_at is null;
end $$;

-- The customer answers a vendor. 30 messages a day per customer at most.
create or replace function customer_send(p_token text, p_lead uuid, p_vendor uuid, p_body text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare e text := customer_email(p_token); l leads; v vendors; txt text := btrim(coalesce(p_body, ''));
begin
  select * into l from leads where id = p_lead and lower(email) = e and status <> 'spam';
  if l.id is null or not exists (select 1 from lead_recipients where lead_id = p_lead and vendor_id = p_vendor) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if length(txt) not between 1 and 4000 then raise exception 'invalid_message' using errcode = '22023'; end if;
  if (select count(*) from lead_messages m join leads x on x.id = m.lead_id
      where lower(x.email) = e and m.sender = 'customer' and m.created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into lead_messages (lead_id, vendor_id, sender, body) values (p_lead, p_vendor, 'customer', txt);
  update lead_messages set read_at = now() where lead_id = p_lead and vendor_id = p_vendor and sender = 'vendor' and read_at is null;
  select * into v from vendors where id = p_vendor;
  if v.email is not null then
    insert into notifications (kind, to_email, payload)
    values ('customer_message', v.email, jsonb_build_object('lead_id', p_lead, 'vendor_id', v.id, 'vendor_name', v.name));
  end if;
end $$;

-- "Email me a link": only for addresses that have sent a request; same answer either way.
create or replace function customer_request_link(p_email text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'invalid_email' using errcode = '22023'; end if;
  if not exists (select 1 from leads where lower(email) = e and status <> 'spam') then return; end if;
  if (select count(*) from notifications where kind = 'customer_link' and to_email = e and created_at > now() - interval '1 hour') >= 3 then return; end if;
  insert into notifications (kind, to_email, payload) values ('customer_link', e, '{}');
end $$;

revoke execute on function issue_customer_token(text), customer_email(text) from public, anon, authenticated;
revoke execute on function customer_inbox(text), customer_mark_read(text, uuid, uuid), customer_send(text, uuid, uuid, text), customer_request_link(text) from public;
grant execute on function customer_inbox(text), customer_mark_read(text, uuid, uuid), customer_send(text, uuid, uuid, text), customer_request_link(text) to anon, authenticated;

-- -------------------------------------------------------------- vendor side
-- Vendor replies now also go into the conversation; the customer is emailed to read it on the site.
create or replace function vendor_reply(p_lead uuid, p_vendor uuid, p_reply text, p_status text default null) returns lead_recipients
language plpgsql security definer set search_path = public as $$
declare
  lr  lead_recipients;
  l   leads;
  v   vendors;
  txt text := nullif(trim(coalesce(p_reply, '')), '');
begin
  if not owns_vendor(p_vendor) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('new', 'replied', 'tour', 'booked', 'lost') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if txt is null and p_status is null then raise exception 'nothing_to_update' using errcode = '22023'; end if;
  if length(txt) > 4000 then raise exception 'invalid_message' using errcode = '22023'; end if;

  update lead_recipients set
    reply      = coalesce(txt, reply),
    replied_at = case when txt is not null then coalesce(replied_at, now()) else replied_at end,
    opened_at  = coalesce(opened_at, now()),
    status     = coalesce(p_status, case when txt is not null and status = 'new' then 'replied' else status end)
  where lead_id = p_lead and vendor_id = p_vendor
  returning * into lr;
  if lr.lead_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  if txt is not null then
    select * into l from leads where id = p_lead;
    select * into v from vendors where id = p_vendor;
    insert into lead_messages (lead_id, vendor_id, sender, body) values (p_lead, p_vendor, 'vendor', txt);
    update lead_messages set read_at = now() where lead_id = p_lead and vendor_id = p_vendor and sender = 'customer' and read_at is null;
    insert into notifications (kind, to_email, payload) values ('reply_to_couple', l.email,
      jsonb_build_object('lead_id', l.id, 'vendor_id', v.id, 'vendor_name', v.name, 'reply', left(txt, 200)));
    update vendors set avg_reply_minutes = (
      select round(avg(extract(epoch from (replied_at - sent_at)) / 60))::int
      from lead_recipients where vendor_id = p_vendor and replied_at is not null)
    where id = p_vendor;
  end if;
  return lr;
end $$;

-- Opening a lead also marks the customer's messages in it as read.
create or replace function mark_lead_opened(p_lead uuid, p_vendor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (owns_vendor(p_vendor) or is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update lead_recipients set opened_at = coalesce(opened_at, now()) where lead_id = p_lead and vendor_id = p_vendor;
  if owns_vendor(p_vendor) then
    update lead_messages set read_at = now() where lead_id = p_lead and vendor_id = p_vendor and sender = 'customer' and read_at is null;
  end if;
end $$;

-- A confirmation (with the inbox link) for every real request.
create or replace function queue_lead_confirmation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'spam' then
    insert into notifications (kind, to_email, payload) values ('lead_confirmation', new.email, jsonb_build_object('lead_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists lead_confirmation on leads;
create trigger lead_confirmation after insert on leads for each row execute function queue_lead_confirmation();

-- ------------------------------------------------------------------ emails
create or replace function email_button(href text, label text) returns text language sql immutable as $$
  select format('<p style="margin:22px 0"><a href="%s" style="background:#3A1D4A;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">%s</a></p>',
    html_esc(href), html_esc(label))
$$;

create or replace function render_email(n notifications, out subject text, out html text, out reply_to text)
language plpgsql volatile security definer set search_path = public as $$
declare
  site text := rtrim((select value #>> '{}' from settings where key = 'site_url'), '/');
  brand text := (select regexp_replace(value #>> '{}', '\s*<.*$', '') from settings where key = 'email_from');
  l leads; v vendors; c cities; cat categories; place text; body text; first text; link text; n_vendors int;
  claim_cta text;
begin
  if n.payload ? 'lead_id' then
    select * into l from leads where id = (n.payload->>'lead_id')::uuid;
    select * into c from cities where id = l.city_id;
    place := c.name || coalesce(', ' || (select upper(code) from regions where id = c.region_id), '');
    first := coalesce(nullif(split_part(btrim(l.couple_name), ' ', 1), ''), 'there');
  end if;
  if n.payload ? 'vendor_id' then
    select * into v from vendors where id = (n.payload->>'vendor_id')::uuid;
    select * into cat from categories where id = v.category_id;
  end if;
  -- Vendors: claimed ones open their dashboard, others are asked to claim first.
  claim_cta := case when v.status = 'claimed'
    then email_button(site || '/vendor-dashboard/#leads', 'View the lead and reply')
    else email_button(site || '/for-vendors/?claim=' || v.id, 'Claim your free listing to view and reply')
         || '<p style="color:#5f566d;font-size:13px">Claiming is free and takes a couple of minutes. Once we''ve confirmed you run the business, the lead and the customer''s details are waiting in your dashboard.</p>' end;

  case n.kind
  when 'lead_to_vendor' then
    subject := format('New %s lead in %s', lower(coalesce(cat.singular, 'vendor')), place);
    body := format('<p>Hi %s,</p><p>You have a new lead on %s: a customer in <b>%s</b> is looking for a <b>%s</b>.</p>'
      || '<table cellpadding="4" style="font-size:15px"><tr><td style="color:#5f566d">Event date</td><td><b>%s</b></td></tr><tr><td style="color:#5f566d">Guests</td><td><b>%s</b></td></tr></table>'
      || '%s<p style="color:#5f566d;font-size:13px">Customers usually book one of the first vendors who reply.</p>',
      html_esc(v.name), html_esc(brand), html_esc(place), html_esc(lower(coalesce(cat.singular, 'vendor'))),
      coalesce(to_char(l.wedding_date, 'FMMonth YYYY'), 'Flexible'), coalesce(l.guests::text, 'Not given'), claim_cta);
  when 'lead_reminder' then
    subject := format('A %s lead in %s is waiting for your reply', lower(coalesce(cat.singular, 'vendor')), place);
    body := format('<p>Hi %s,</p><p>A customer asked about your services yesterday and hasn''t heard back yet. Customers usually book one of the first vendors who reply.</p>%s',
      html_esc(v.name), claim_cta);
  when 'customer_message' then
    subject := format('%s replied about their enquiry', first);
    body := format('<p>Hi %s,</p><p><b>%s</b> sent you a new message about their %s enquiry.</p>%s',
      html_esc(v.name), html_esc(first), html_esc(lower(coalesce(cat.singular, 'vendor'))), claim_cta);
  when 'reply_to_couple' then
    link := site || '/account/?t=' || issue_customer_token(n.to_email);
    subject := format('%s replied to your enquiry', n.payload->>'vendor_name');
    body := format('<p>Hi %s,</p><p><b>%s</b> replied to your request on %s:</p><blockquote style="border-left:3px solid #c2577a;margin:0;padding:4px 0 4px 12px;color:#3d354a">%s%s</blockquote>%s'
      || '<p style="color:#5f566d;font-size:13px">Read the full reply and answer them in your %s inbox. All your vendor conversations are in one place.</p>',
      html_esc(first), html_esc(n.payload->>'vendor_name'), html_esc(brand), replace(html_esc(left(n.payload->>'reply', 160)), E'\n', '<br>'),
      case when length(n.payload->>'reply') > 160 then '…' else '' end, email_button(link, 'Read and reply in My ' || brand), html_esc(brand));
  when 'lead_confirmation' then
    if l.status not in ('routed', 'unmatched') then subject := null; return; end if;
    n_vendors := (select count(*) from lead_recipients where lead_id = l.id);
    link := site || '/account/?t=' || issue_customer_token(n.to_email);
    subject := case when n_vendors > 0 then format('Your request was sent to %s vendor%s', n_vendors, case when n_vendors = 1 then '' else 's' end)
                    else 'We received your request' end;
    body := format('<p>Hi %s,</p><p>%s</p><p>Replies will appear in <b>My %s</b>, your inbox on our site. We''ll email you each time a vendor replies.</p>%s',
      html_esc(first),
      case when n_vendors > 0 then format('Thanks! We sent your request for %s to %s vendor%s. Most reply within a day.', html_esc(place), n_vendors, case when n_vendors = 1 then '' else 's' end)
           else format('Thanks! We''re still finding vendors in %s for you and will be in touch.', html_esc(place)) end,
      html_esc(brand), email_button(link, 'Open My ' || brand));
  when 'customer_link' then
    link := site || '/account/?t=' || issue_customer_token(n.to_email);
    subject := format('Your link to My %s', brand);
    body := format('<p>Hi,</p><p>Here''s your personal link to see your requests and vendor replies. It works for 90 days; keep it to yourself.</p>%s'
      || '<p style="color:#5f566d;font-size:13px">Didn''t ask for this? You can ignore this email.</p>', email_button(link, 'Open My ' || brand));
  when 'claim_decided' then
    subject := case when (n.payload->>'approved')::boolean then 'Your listing is ready to manage' else 'About your listing claim' end;
    body := case when (n.payload->>'approved')::boolean
      then format('<p>Good news: your claim was approved. Sign in to read your leads, reply to customers, and add photos, packages and pricing.</p>%s',
                  email_button(site || '/vendor-dashboard/', 'Open your dashboard'))
      else '<p>We couldn''t verify your claim from the details provided. Reply to this email with proof you own the business (for example an email from your business domain) and we''ll take another look.</p>' end;
  else
    subject := brand || ' update'; body := '<p>' || html_esc(n.payload::text) || '</p>';
  end case;
  html := format('<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f1a2e;max-width:560px">%s<p style="color:#7a7287;font-size:12px;margin-top:28px;border-top:1px solid #eee;padding-top:12px">%s · <a href="%s" style="color:#7a7287">%s</a></p></div>',
    body, html_esc(brand), site, regexp_replace(site, '^https?://', ''));
end $$;

-- Same sender as 012, with the new kinds, the 7-day cut-off and skipped emails.
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
  update notifications set attempts = 5, error = 'expired: not sent within 7 days'
  where sent_at is null and request_id is null and attempts < 5 and created_at < now() - interval '7 days';
  for n in select * from notifications where sent_at is null and request_id is null and attempts < 5
           and kind in ('lead_to_vendor', 'reply_to_couple', 'lead_reminder', 'claim_decided', 'lead_confirmation', 'customer_message', 'customer_link')
           order by created_at limit 40 for update skip locked loop
    select * into e from render_email(n);
    if e.subject is null then
      update notifications set attempts = 5, error = 'skipped' where id = n.id;
      continue;
    end if;
    update notifications set attempts = attempts + 1, request_id = email_http_post(jsonb_strip_nulls(jsonb_build_object(
      'from', sender, 'to', jsonb_build_array(n.to_email), 'subject', e.subject, 'html', e.html, 'reply_to', e.reply_to)), api_key)
    where id = n.id;
    queued := queued + 1;
  end loop;
  return jsonb_build_object('sent', sent, 'queued', queued);
end $$;

revoke execute on function render_email(notifications), send_pending_emails(), email_button(text, text), queue_lead_confirmation() from public, anon, authenticated;

-- Reminders only for leads from the last 3 days (not for old ones when sending is first switched on).
create or replace function queue_lead_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    update lead_recipients lr set reminded_at = now()
    from vendors v
    where v.id = lr.vendor_id and v.email is not null
      and lr.status = 'new' and lr.replied_at is null and lr.reminded_at is null
      and lr.sent_at < now() - interval '24 hours' and lr.sent_at > now() - interval '3 days'
    returning lr.lead_id, lr.vendor_id, v.email, v.name
  )
  insert into notifications (kind, to_email, payload)
  select 'lead_reminder', email, jsonb_build_object('lead_id', lead_id, 'vendor_id', vendor_id, 'vendor_name', name) from due;
  get diagnostics n = row_count;
  return n;
end $$;
