-- Vendor dashboard > Analytics: how a claimed listing is doing. Only the listing's owner, once
-- the claim is approved (vendor status 'claimed'), or an admin can read it. Numbers only:
-- vendors never see visitor ids or anything about a single visitor.

create or replace function vendor_analytics(p_vendor uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v vendors;
  d int := least(greatest(coalesce(p_days, 30), 7), 365);
  t0 timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
  p0 timestamptz := t0 - make_interval(days => d);
  res jsonb;
begin
  select * into v from vendors where id = p_vendor;
  if v.id is null or not ((v.owner_id = auth.uid() and v.status = 'claimed') or is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with mine as (
    select kind, created_at, page_path, session_id, visitor_id, device from events
    where vendor_id = p_vendor and created_at >= p0
  ), cur as (select * from mine where created_at >= t0), prev as (select * from mine where created_at < t0),
  -- How each profile view was reached: the page viewed just before it in the same visit, or,
  -- when the profile was the first page, where the visit came from.
  sessions as (select distinct session_id from cur where kind = 'view' and session_id is not null),
  trail as (
    select e.session_id, e.kind, e.vendor_id, e.page_path, e.referrer, e.utm_source, e.utm_medium, e.created_at,
           lag(e.page_path) over (partition by e.session_id order by e.created_at) as prev_path
    from events e join sessions s using (session_id)
    where e.created_at >= t0 - interval '1 hour' and e.kind in ('page_view', 'view')
  ),
  found as (
    select case
      when t.prev_path is null then case traffic_channel(t.referrer, t.utm_source, t.utm_medium)
        when 'Search' then 'Google & other search engines' when 'Direct' then 'Direct (typed or bookmarked)' else traffic_channel(t.referrer, t.utm_source, t.utm_medium) end
      when t.prev_path ~ '^/blog/' then 'Celebrateio blog'
      when t.prev_path ~ '^/(search|shortlist)/' then 'Celebrateio search & shortlist'
      when t.prev_path ~ '^/vendor/' then 'Another vendor''s page'
      when t.prev_path ~ '^/[a-z]{2}/' or t.prev_path ~ '^/categories/' then 'Celebrateio city & category pages'
      else 'Other Celebrateio pages' end as how
    from trail t where t.vendor_id = p_vendor and t.kind = 'view' and t.created_at >= t0
  ),
  peers as (
    select x.id from vendors x where x.city_id = v.city_id and x.category_id = v.category_id and x.status <> 'hidden' and x.id <> v.id
  ),
  ranked as (
    select id, row_number() over (order by (plan = 'featured') desc, (status = 'claimed') desc, rating desc nulls last, review_count desc, id) as rn
    from vendors where city_id = v.city_id and category_id = v.category_id and status <> 'hidden'
  )
  select jsonb_build_object(
    'days', d, 'since', t0::date,
    'kpi', jsonb_build_object(
      'impressions', (select count(*) from cur where kind = 'impression'),
      'impressions_prev', (select count(*) from prev where kind = 'impression'),
      'views', (select count(*) from cur where kind = 'view'),
      'views_prev', (select count(*) from prev where kind = 'view'),
      'visitors', (select count(distinct visitor_id) from cur where kind = 'view'),
      'clicks_phone', (select count(*) from cur where kind = 'click_phone'),
      'clicks_website', (select count(*) from cur where kind = 'click_website'),
      'clicks_directions', (select count(*) from cur where kind = 'click_directions'),
      'clicks', (select count(*) from cur where kind like 'click_%'),
      'clicks_prev', (select count(*) from prev where kind like 'click_%'),
      'shortlists', (select count(*) from cur where kind = 'shortlist'),
      'leads', (select count(*) from lead_recipients where vendor_id = p_vendor and sent_at >= t0),
      'leads_prev', (select count(*) from lead_recipients where vendor_id = p_vendor and sent_at >= p0 and sent_at < t0)
    ),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date,
        'impressions', (select count(*) from cur where kind = 'impression' and created_at >= g and created_at < g + interval '1 day'),
        'views', (select count(*) from cur where kind = 'view' and created_at >= g and created_at < g + interval '1 day'),
        'leads', (select count(*) from lead_recipients where vendor_id = p_vendor and sent_at >= g and sent_at < g + interval '1 day')) order by g), '[]')
      from generate_series(t0, date_trunc('day', now()), interval '1 day') g),
    'found_by', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (select how, count(*) as views from found group by how) x),
    'shown_on', (select coalesce(jsonb_agg(x order by x.times desc), '[]') from (
        select page_path as path, count(*) as times from cur where kind = 'impression' and page_path is not null
        group by page_path order by count(*) desc limit 8) x),
    'devices', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
        select device, count(*) as views from cur where kind = 'view' and device is not null group by device) x),
    'lead_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) as n from lead_recipients where vendor_id = p_vendor and sent_at >= t0 group by status) x),
    'peers', jsonb_build_object(
        'count', (select count(*) from peers),
        'avg_views', (select round(count(*)::numeric / greatest((select count(*) from peers), 1), 1)
                      from events e join peers p on p.id = e.vendor_id where e.kind = 'view' and e.created_at >= t0),
        'avg_leads', (select round(count(*)::numeric / greatest((select count(*) from peers), 1), 1)
                      from lead_recipients r join peers p on p.id = r.vendor_id where r.sent_at >= t0),
        'rank', (select rn from ranked where id = p_vendor), 'rank_of', (select count(*) from ranked)),
    'tracked_since', (select min(created_at)::date from events where visitor_id is not null)
  ) into res;
  return res;
end $$;
revoke execute on function vendor_analytics(uuid, int) from public, anon;
grant execute on function vendor_analytics(uuid, int) to authenticated;
