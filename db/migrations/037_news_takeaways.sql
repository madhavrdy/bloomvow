-- News & updates: AI-drafted takeaways, approved by an admin before they show.
--
-- For each new automatic headline, Claude drafts one or two sentences on what the story means
-- for a couple planning a wedding, using only the headline and our own listing counts. The draft
-- waits in Admin > News ("Takeaways to review"); nothing shows on the site until an admin uses
-- it (it then becomes the item's summary). Off unless the API key is saved in Supabase Vault:
--   Vault > New secret, name: anthropic_api_key
-- Runs inside news_fetch() every 5 minutes, at most 10 drafts per run and a monthly cap
-- (Admin > News > Settings), so cost stays small and predictable.

alter table news_items
  add column if not exists ai_draft text check (length(ai_draft) <= 600),
  add column if not exists ai_status text check (ai_status in ('asked', 'review', 'skipped', 'failed', 'approved', 'dismissed')),
  add column if not exists ai_request_id bigint,
  add column if not exists ai_attempts int not null default 0,
  add column if not exists ai_at timestamptz,
  add column if not exists ai_error text check (length(ai_error) <= 300);
create index if not exists news_items_ai_idx on news_items (ai_status, created_at desc);

-- Settings: allow ai (on/off), ai_model and ai_monthly_cap.
create or replace function news_settings_ok(v jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(v) = 'object'
    and not exists (select 1 from jsonb_object_keys(v) k
                    where k not in ('approval', 'sources', 'local_sources', 'blocked', 'paused', 'ai', 'ai_model', 'ai_monthly_cap'))
    and coalesce(jsonb_typeof(v->'approval'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(v->'paused'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(v->'ai'), 'boolean') = 'boolean'
    and coalesce(v->>'ai_model', 'claude-x') ~ '^claude-[a-z0-9.-]{1,60}$'
    and coalesce(jsonb_typeof(v->'ai_monthly_cap'), 'number') = 'number'
    and coalesce((v->>'ai_monthly_cap')::numeric, 0) between 0 and 5000
    and coalesce(jsonb_typeof(v->'sources'), 'array') = 'array'
    and jsonb_array_length(coalesce(v->'sources', '[]')) <= 500
    and not exists (select 1 from jsonb_array_elements(coalesce(v->'sources', '[]')) s
                    where jsonb_typeof(s) <> 'string' or s #>> '{}' !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
    and coalesce(jsonb_typeof(v->'local_sources'), 'array') = 'array'
    and jsonb_array_length(coalesce(v->'local_sources', '[]')) <= 500
    and not exists (select 1 from jsonb_array_elements(coalesce(v->'local_sources', '[]')) s
                    where jsonb_typeof(s) <> 'string' or s #>> '{}' !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
    and coalesce(jsonb_typeof(v->'blocked'), 'string') = 'string'
    and length(coalesce(v->>'blocked', '')) <= 4000
$$;
update settings set value = value || '{"ai": true, "ai_model": "claude-sonnet-5-5", "ai_monthly_cap": 600}'::jsonb
where key = 'news' and not value ? 'ai';

-- The API key lives in Supabase Vault. Tests set bloomvow.test_ai_key instead.
create or replace function news_ai_key() returns text
language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_api_key' limit 1$q$ into k;
  end if;
  return coalesce(k, nullif(current_setting('bloomvow.test_ai_key', true), ''));
end $$;

-- HTTP request and response (separate so tests can stand in for pg_net).
create or replace function news_ai_post(body jsonb, api_key text) returns bigint
language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
    into rid using 'https://api.anthropic.com/v1/messages', body,
    jsonb_build_object('x-api-key', api_key, 'anthropic-version', '2023-06-01', 'content-type', 'application/json');
  return rid;
end $$;

create or replace function news_ai_result(rid bigint, out status int, out body text)
language plpgsql security definer set search_path = public as $$
begin
  execute 'select status_code, content from net._http_response where id = $1' into status, body using rid;
end $$;

-- What the draft may use besides the headline: our own listing counts for that page type.
create or replace function news_ai_context(n news_items) returns text
language sql stable security definer set search_path = public as $$
  select case
    when n.city_id is not null then (
      select format('Shown on: wedding vendor pages for %s, %s.', ci.name, r.name)
        || case when tot > 0 then format(E'\nOur listings: Celebrateio lists %s wedding vendors in %s, including %s.',
             to_char(tot, 'FM999,999'), ci.name, tops) else '' end
      from cities ci join regions r on r.id = ci.region_id,
      lateral (select sum(cnt) tot, string_agg(format('%s %s', to_char(cnt, 'FM999,999'), lower(nm)), ', ' order by cnt desc) filter (where rn <= 3) tops
               from (select c.name nm, count(*) cnt, row_number() over (order by count(*) desc) rn
                     from vendors v join categories c on c.id = v.category_id
                     where v.city_id = ci.id and v.status <> 'hidden' group by c.name) x) s
      where ci.id = n.city_id)
    when n.category_id is not null then (
      select format('Shown on: %s pages for US cities.', lower(c.name))
        || case when count(v.id) > 0 then format(E'\nOur listings: Celebrateio lists %s %s across %s US cities.',
             to_char(count(v.id), 'FM999,999'), lower(c.name), count(distinct v.city_id)) else '' end
      from categories c left join vendors v on v.category_id = c.id and v.status <> 'hidden'
      where c.id = n.category_id group by c.name)
    else 'Shown on: wedding vendor pages.' end
$$;

create or replace function news_ai_system() returns text language sql immutable as $$
  select 'You write one short takeaway that appears under a news headline on Celebrateio, a US wedding vendor directory. '
    || 'The readers are couples planning a wedding.' || E'\n\nRules:\n'
    || E'- One or two sentences, at most 220 characters. Plain text: no quotes, emoji, hashtags or links.\n'
    || E'- Say what the story could mean for a couple planning a wedding (a practical tip, what to ask vendors, when to book), in your own words. Do not retell the headline.\n'
    || E'- Use only facts in the headline and the page details given. Never invent prices, dates, names, numbers or details of the article.\n'
    || E'- You may point to our listings when it fits naturally, using only the counts given.\n'
    || E'- Do not mention or recommend other wedding websites, apps or directories.\n'
    || E'- Warm, calm and factual. No hype, no exclamation marks, no claims about our own experience.\n'
    || E'- If the headline is not useful to couples, is about someone''s private life, or is sad, alarming or controversial, reply with exactly: SKIP'
$$;

-- Called from news_fetch(): read drafts that came back, then ask for a few more.
create or replace function news_ai_step(p_batch int default 10) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from settings where key = 'news'), '{}');
  blocked text := news_block_regex();
  k text; n news_items; r record; txt text; drafted int := 0; asked int := 0; used int; room int;
begin
  -- 1. Answers.
  for n in select * from news_items where ai_status = 'asked' and ai_request_id is not null loop
    select * into r from news_ai_result(n.ai_request_id);
    if r.status is null and n.ai_at > now() - interval '15 minutes' then continue; end if;
    if r.status between 200 and 299 then
      begin
        txt := btrim(regexp_replace((r.body::jsonb #>> '{content,0,text}'), '\s+', ' ', 'g'), E' "\'');
      exception when others then txt := null; end;
      if txt is null or txt = '' then
        update news_items set ai_status = 'failed', ai_error = 'empty answer', ai_request_id = null where id = n.id;
      elsif upper(txt) like 'SKIP%' or length(txt) < 20 or length(txt) > 300 or txt ~* '(https?://|www\.)'
            or (blocked is not null and txt ~* blocked) then
        update news_items set ai_status = 'skipped', ai_draft = left(txt, 600), ai_request_id = null where id = n.id;
      else
        update news_items set ai_status = 'review', ai_draft = txt, ai_error = null, ai_request_id = null where id = n.id;
        drafted := drafted + 1;
      end if;
    elsif (r.status is null or r.status = 429 or r.status >= 500) and n.ai_attempts < 3 then
      update news_items set ai_status = null, ai_request_id = null, ai_error = coalesce(r.status::text, 'no answer') || ', will retry' where id = n.id;
    else
      update news_items set ai_status = 'failed', ai_request_id = null,
        ai_error = left(coalesce(r.status::text, 'no answer') || ' ' || coalesce(substring(r.body from '"message"\s*:\s*"([^"]{0,200})'), ''), 300)
      where id = n.id;
    end if;
  end loop;

  -- 2. New requests.
  if not coalesce((cfg->>'ai')::boolean, true) or coalesce((cfg->>'paused')::boolean, false) then
    return jsonb_build_object('drafted', drafted, 'asked', 0);
  end if;
  k := news_ai_key();
  if k is null then return jsonb_build_object('drafted', drafted, 'asked', 0, 'note', 'no anthropic_api_key in vault'); end if;
  select count(*) into used from news_items where ai_at >= date_trunc('month', now());
  room := least(p_batch, greatest(coalesce((cfg->>'ai_monthly_cap')::int, 600) - used, 0));
  for n in select * from news_items
           where ai_status is null and origin = 'auto' and summary is null and status <> 'hidden'
             and created_at > now() - interval '30 days'
           order by created_at desc limit room loop
    update news_items set ai_status = 'asked', ai_at = now(), ai_attempts = ai_attempts + 1,
      ai_request_id = news_ai_post(jsonb_build_object(
        'model', coalesce(cfg->>'ai_model', 'claude-sonnet-5-5'),
        'max_tokens', 150,
        'system', news_ai_system(),
        'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content',
          format(E'Headline: %s\nPublisher: %s\n%s', n.title, n.source_name, news_ai_context(n))))), k)
    where id = n.id;
    asked := asked + 1;
  end loop;
  return jsonb_build_object('drafted', drafted, 'asked', asked);
end $$;

-- news_fetch() now also runs the takeaway step (a failure there never stops the news).
create or replace function news_fetch(p_batch int default 6) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t news_targets; st int; content text; added int := 0; asked int := 0; rid bigint; ai jsonb;
begin
  for t in select * from news_targets where request_id is not null loop
    execute 'select status_code, content from net._http_response where id = $1' into st, content using t.request_id;
    if st is null and t.last_run_at is not null and t.last_run_at > now() - interval '30 minutes' then continue; end if;
    if st between 200 and 299 then
      update news_targets set last_found = news_parse(t, content) where id = t.id returning last_found into st;
      added := added + coalesce(st, 0);
    end if;
    update news_targets set request_id = null where id = t.id;
  end loop;
  begin ai := news_ai_step(); exception when others then ai := jsonb_build_object('error', left(sqlerrm, 200)); end;
  if coalesce((select (value->>'paused')::boolean from settings where key = 'news'), false) then
    return jsonb_build_object('added', added, 'asked', 0, 'paused', true, 'ai', ai);
  end if;
  for t in select * from news_targets nt where news_target_due(nt) order by nt.last_run_at nulls first, nt.id limit p_batch loop
    execute 'select net.http_get(url := $1, timeout_milliseconds := 15000)' into rid
      using 'https://news.google.com/rss/search?q=' || replace(replace(replace(t.query, '"', '%22'), ' ', '+'), ':', '%3A') || '&hl=en-US&gl=US&ceid=US:en';
    update news_targets set request_id = rid, last_run_at = now(), first_run_at = coalesce(first_run_at, now()) where id = t.id;
    asked := asked + 1;
  end loop;
  return jsonb_build_object('added', added, 'asked', asked, 'ai', ai);
end $$;

-- Admin > News: is the key saved (never its value), and how many drafts this month.
create or replace function admin_news_ai_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return jsonb_build_object(
    'key_saved', news_ai_key() is not null,
    'this_month', (select count(*) from news_items where ai_at >= date_trunc('month', now())),
    'to_review', (select count(*) from news_items where ai_status = 'review'));
end $$;

revoke execute on function news_ai_key(), news_ai_post(jsonb, text), news_ai_result(bigint), news_ai_context(news_items),
  news_ai_step(int), news_fetch(int), admin_news_ai_status() from public, anon, authenticated;
grant execute on function admin_news_ai_status() to authenticated;
