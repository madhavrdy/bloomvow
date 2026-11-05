-- "More … near …" and "Complete your team in …" sections on vendor pages:
-- other vendors ranked by location first (same city, then nearby cities), then popularity.

-- Distance between two cities in km (great-circle), null when coordinates are missing.
create or replace function city_km(a int, b int) returns double precision
language sql stable set search_path = public as $$
  select case when a = b then 0 else 12742 * asin(sqrt(
    power(sin(radians(c2.lat - c1.lat) / 2), 2) + cos(radians(c1.lat)) * cos(radians(c2.lat)) * power(sin(radians(c2.lng - c1.lng) / 2), 2))) end
  from cities c1, cities c2 where c1.id = a and c2.id = b and c1.lat is not null and c2.lat is not null
$$;

-- Popularity from the last 90 days of activity: page views, clicks to call / website /
-- directions, and shortlist saves. Only a rounded score is public, never raw counts.
create or replace view vendor_popularity as
  select vendor_id, round(ln(1 + sum(case kind when 'view' then 1 when 'shortlist' then 5 when 'impression' then 0 else 3 end))::numeric, 2) as activity
  from events where vendor_id is not null and created_at > now() - interval '90 days'
  group by vendor_id;
grant select on vendor_popularity to anon, authenticated;

-- One number combining what couples respond to. Mirrors popularityScore() in web/src/lib/data.ts.
create or replace function vendor_score(featured boolean, claimed boolean, rating numeric, reviews int, activity numeric, has_phone boolean, has_web boolean)
returns numeric language sql immutable set search_path = public as $$
  select (case when featured then 3 else 0 end) + (case when claimed then 2 else 0 end)
       + coalesce(rating, 0) * ln(1 + coalesce(reviews, 0)) + coalesce(activity, 0)
       + (case when has_phone then 0.5 else 0 end) + (case when has_web then 0.5 else 0 end)
$$;

create or replace function nearby_vendors(p_vendor uuid, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public_vendors; lim int := least(12, greatest(1, p_limit)); res jsonb;
begin
  select * into me from public_vendors where id = p_vendor;
  if me.id is null then return jsonb_build_object('same', '[]'::jsonb, 'team', '[]'::jsonb); end if;
  with near as (                         -- this city plus cities within 80 km
    select c.id, coalesce(city_km(me.city_id, c.id), 1e9) as km from cities c
    where c.id = me.city_id or city_km(me.city_id, c.id) <= 80
  ), same_rows as (                      -- same category: same city, then <=30 km, then <=80 km; popular first
    select v.id, n.km, row_number() over (order by case when n.km = 0 then 0 when n.km <= 30 then 1 else 2 end,
      vendor_score(v.featured, v.status = 'claimed', v.rating, v.review_count, p.activity, v.phone is not null, v.website is not null) desc, v.slug) as rn
    from public_vendors v join near n on n.id = v.city_id left join vendor_popularity p on p.vendor_id = v.id
    where v.category_id = me.category_id and v.id <> me.id
  ), team_rows as (                      -- other categories, same city: most popular per category
    select * from (
      select distinct on (v.category_id) v.id, 0::float8 as km, k.sort
      from public_vendors v join categories k on k.id = v.category_id left join vendor_popularity p on p.vendor_id = v.id
      where v.city_id = me.city_id and v.category_id <> me.category_id and k.active
      order by v.category_id, vendor_score(v.featured, v.status = 'claimed', v.rating, v.review_count, p.activity, v.phone is not null, v.website is not null) desc, v.slug
    ) d order by sort limit lim
  ), card as (                           -- details only for the few vendors shown
    select x.id, jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'category_id', v.category_id,
      'city', ci.name, 'st', upper(g.code), 'km', round(x.km::numeric), 'rating', v.rating, 'review_count', v.review_count,
      'price_from', v.price_from, 'featured', v.featured, 'setting', v.setting, 'capacity_max', v.capacity_max,
      'photo', (select ph.url from photos ph where ph.vendor_id = v.id order by ph.sort limit 1),
      'has_page', v.status = 'claimed' or v.featured or coalesce(trim(v.description), '') <> '' or v.review_count > 0
        or exists (select 1 from photos ph where ph.vendor_id = v.id) or exists (select 1 from packages pk where pk.vendor_id = v.id)) as j
    from (select id, km from same_rows where rn <= lim union select id, km from team_rows) x
    join public_vendors v on v.id = x.id join cities ci on ci.id = v.city_id join regions g on g.id = ci.region_id
  )
  select jsonb_build_object(
    'same', coalesce((select jsonb_agg(c.j order by s.rn) from same_rows s join card c on c.id = s.id where s.rn <= lim), '[]'::jsonb),
    'team', coalesce((select jsonb_agg(c.j order by t.sort) from team_rows t join card c on c.id = t.id), '[]'::jsonb))
  into res;
  return res;
end $$;
grant execute on function nearby_vendors(uuid, int) to anon, authenticated;
