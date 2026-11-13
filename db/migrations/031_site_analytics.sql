-- Own analytics (Admin > Analytics), without cookies or IP addresses.
-- Each visit sends one row per page: an anonymous random visitor id (kept in the browser's
-- storage), a session id (new after 30 minutes without activity), where the visit came from
-- (referring site's domain or utm_ tags) and the device type. Lead-form starts and finished
-- leads are recorded the same way so leads can be traced back to their traffic source.

alter table events add column if not exists visitor_id text check (visitor_id ~ '^[a-z0-9]{8,32}$');
alter table events add column if not exists session_id text check (session_id ~ '^[a-z0-9]{8,32}$');
alter table events add column if not exists referrer   text check (length(referrer) <= 120);
alter table events add column if not exists utm_source text check (length(utm_source) <= 80);
alter table events add column if not exists utm_medium text check (length(utm_medium) <= 80);
alter table events add column if not exists utm_campaign text check (length(utm_campaign) <= 120);
alter table events add column if not exists device     text check (device in ('mobile', 'tablet', 'desktop'));

alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check
  check (kind in ('view', 'impression', 'click_phone', 'click_website', 'click_directions', 'shortlist', 'page_view', 'lead_start', 'lead'));
create index if not exists events_kind_created_idx on events (kind, created_at);

-- One hit with visit details. Bad or oversized details are dropped, never fatal.
create or replace function track_hit(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p->>'kind';
  v_vendor uuid;
  v_path text := left(p->>'path', 300);
  clean text := '[^a-z0-9._ -]';
  v_ref text := lower(nullif(btrim(p->>'ref'), ''));
begin
  if v_kind is null or v_kind not in ('view', 'click_phone', 'click_website', 'click_directions', 'shortlist', 'page_view', 'lead_start', 'lead') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if v_path is null or v_path !~ '^/[A-Za-z0-9/_.-]*$' then return; end if;
  begin v_vendor := nullif(p->>'vendor', '')::uuid; exception when others then return; end;
  if v_vendor is not null and not exists (select 1 from vendors where id = v_vendor and status <> 'hidden') then return; end if;
  if v_kind in ('view', 'click_phone', 'click_website', 'click_directions', 'shortlist') and v_vendor is null then return; end if;
  -- The site itself and the dashboards are not traffic sources.
  if v_ref is not null and (v_ref !~ '^[a-z0-9.-]{3,120}$' or v_ref ~ '(^|\.)celebrateio\.com$') then v_ref := null; end if;
  insert into events (vendor_id, kind, page_path, visitor_id, session_id, referrer, utm_source, utm_medium, utm_campaign, device)
  values (v_vendor, v_kind, v_path,
    case when p->>'vid' ~ '^[a-z0-9]{8,32}$' then p->>'vid' end,
    case when p->>'sid' ~ '^[a-z0-9]{8,32}$' then p->>'sid' end,
    v_ref,
    nullif(left(regexp_replace(lower(coalesce(p->>'us', '')), clean, '', 'g'), 80), ''),
    nullif(left(regexp_replace(lower(coalesce(p->>'um', '')), clean, '', 'g'), 80), ''),
    nullif(left(regexp_replace(lower(coalesce(p->>'uc', '')), clean, '', 'g'), 120), ''),
    case when p->>'dev' in ('mobile', 'tablet', 'desktop') then p->>'dev' end);
end $$;
revoke execute on function track_hit(jsonb) from public;
grant execute on function track_hit(jsonb) to anon, authenticated;

-- Where a visit came from, as a channel.
create or replace function traffic_channel(p_ref text, p_source text, p_medium text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_medium ~ '(cpc|ppc|paid|ads?)$' then 'Paid ads'
    when p_medium = 'email' or p_source ~ '(newsletter|email|brevo|mailchimp)' then 'Email'
    when coalesce(p_source, p_ref, '') ~ '(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave)' then 'Search'
    when coalesce(p_source, p_ref, '') ~ '(facebook|instagram|pinterest|tiktok|reddit|youtube|linkedin|^t\.co$|twitter|x\.com|threads)' then 'Social'
    when coalesce(p_source, p_ref, '') ~ '(chatgpt|openai|perplexity|claude|gemini|copilot)' then 'AI assistants'
    when p_source is not null or p_ref is not null then 'Other sites'
    else 'Direct' end
$$;

-- Everything Admin > Analytics shows, for the last p_days days and the same span before it.
create or replace function admin_analytics(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d int := least(greatest(coalesce(p_days, 30), 1), 400);
  t0 timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
  p0 timestamptz := t0 - make_interval(days => d);
  res jsonb;
begin
  perform require_admin();
  with e as (
    select * from events where created_at >= p0 and kind in ('page_view', 'view', 'lead_start', 'lead', 'click_phone', 'click_website', 'click_directions')
  ), cur as (select * from e where created_at >= t0), prev as (select * from e where created_at < t0),
  -- A session's source and landing page come from its first hit.
  firsts as (
    select distinct on (session_id) session_id, visitor_id, page_path as landing, device,
           traffic_channel(referrer, utm_source, utm_medium) as channel, coalesce(utm_source, referrer, '(direct)') as source, utm_campaign
    from cur where session_id is not null and kind in ('page_view', 'view') order by session_id, created_at
  ),
  sess_leads as (select distinct session_id from cur where kind = 'lead' and session_id is not null),
  sess_starts as (select distinct session_id from cur where kind = 'lead_start' and session_id is not null),
  lead_rows as (select * from leads where created_at >= p0 and status <> 'spam')
  select jsonb_build_object(
    'days', d, 'since', t0::date,
    'kpi', jsonb_build_object(
      'visitors', (select count(distinct visitor_id) from cur where kind in ('page_view', 'view')),
      'visitors_prev', (select count(distinct visitor_id) from prev where kind in ('page_view', 'view')),
      'sessions', (select count(distinct session_id) from cur where kind in ('page_view', 'view')),
      'sessions_prev', (select count(distinct session_id) from prev where kind in ('page_view', 'view')),
      'pageviews', (select count(*) from cur where kind in ('page_view', 'view')),
      'pageviews_prev', (select count(*) from prev where kind in ('page_view', 'view')),
      'leads', (select count(*) from lead_rows where created_at >= t0),
      'leads_prev', (select count(*) from lead_rows where created_at < t0),
      'form_starts', (select count(*) from sess_starts),
      'contacts', (select count(*) from cur where kind like 'click_%'),
      'contacts_prev', (select count(*) from prev where kind like 'click_%'),
      'live', (select count(distinct coalesce(visitor_id, id::text)) from events where created_at > now() - interval '30 minutes' and kind in ('page_view', 'view')),
      'tracked_since', (select min(created_at)::date from events where visitor_id is not null)
    ),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date,
        'visitors', (select count(distinct visitor_id) from cur where kind in ('page_view', 'view') and created_at >= g and created_at < g + interval '1 day'),
        'pageviews', (select count(*) from cur where kind in ('page_view', 'view') and created_at >= g and created_at < g + interval '1 day'),
        'leads', (select count(*) from lead_rows where created_at >= g and created_at < g + interval '1 day')) order by g), '[]')
      from generate_series(t0, date_trunc('day', now()), interval '1 day') g),
    'pages', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
        select page_path as path, count(*) as views, count(distinct visitor_id) as visitors
        from cur where kind in ('page_view', 'view') group by page_path order by count(*) desc limit 12) x),
    'landing', (select coalesce(jsonb_agg(x order by x.sessions desc), '[]') from (
        select f.landing as path, count(*) as sessions, count(l.session_id) as leads
        from firsts f left join sess_leads l using (session_id) group by f.landing order by count(*) desc limit 15) x),
    'channels', (select coalesce(jsonb_agg(x order by x.sessions desc), '[]') from (
        select f.channel, count(*) as sessions, count(distinct f.visitor_id) as visitors, count(l.session_id) as leads
        from firsts f left join sess_leads l using (session_id) group by f.channel) x),
    'sources', (select coalesce(jsonb_agg(x order by x.sessions desc), '[]') from (
        select f.source, f.channel, count(*) as sessions, count(l.session_id) as leads
        from firsts f left join sess_leads l using (session_id) group by f.source, f.channel order by count(*) desc limit 15) x),
    'campaigns', (select coalesce(jsonb_agg(x order by x.sessions desc), '[]') from (
        select f.utm_campaign as campaign, f.source, count(*) as sessions, count(l.session_id) as leads
        from firsts f left join sess_leads l using (session_id) where f.utm_campaign is not null group by 1, 2 order by count(*) desc limit 10) x),
    'devices', (select coalesce(jsonb_agg(x order by x.sessions desc), '[]') from (
        select coalesce(f.device, 'unknown') as device, count(*) as sessions, count(l.session_id) as leads
        from firsts f left join sess_leads l using (session_id) group by 1) x),
    'funnel', jsonb_build_object(
        'sessions', (select count(*) from firsts),
        'started', (select count(*) from sess_starts),
        'sent', (select count(*) from sess_leads)),
    'vendors', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
        select v.id, v.name, v.slug, count(*) filter (where c.kind = 'view') as views,
               count(*) filter (where c.kind like 'click_%') as contacts,
               (select count(*) from lead_recipients r join leads l on l.id = r.lead_id where r.vendor_id = v.id and l.created_at >= t0 and l.status <> 'spam') as leads
        from cur c join vendors v on v.id = c.vendor_id where c.kind in ('view', 'click_phone', 'click_website', 'click_directions')
        group by v.id order by count(*) filter (where c.kind = 'view') desc limit 15) x),
    'lead_forms', (select coalesce(jsonb_agg(x order by x.leads desc), '[]') from (
        select source, count(*) as leads from lead_rows where created_at >= t0 group by source) x),
    'lead_categories', (select coalesce(jsonb_agg(x order by x.leads desc), '[]') from (
        select c.name as category, count(*) as leads from lead_rows l cross join unnest(l.category_ids) cid join categories c on c.id = cid
        where l.created_at >= t0 group by c.name order by count(*) desc limit 15) x),
    'lead_cities', (select coalesce(jsonb_agg(x order by x.leads desc), '[]') from (
        select ci.name || ', ' || upper(r.code) as city, count(*) as leads from lead_rows l join cities ci on ci.id = l.city_id join regions r on r.id = ci.region_id
        where l.created_at >= t0 group by 1 order by count(*) desc limit 15) x)
  ) into res;
  return res;
end $$;
revoke execute on function admin_analytics(int) from public, anon;
grant execute on function admin_analytics(int) to authenticated;
