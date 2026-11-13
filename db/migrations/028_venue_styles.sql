-- Venue styles: Indoor, Outdoor (now works: almost no venue has a "setting", so it also reads
-- names, amenities and the venue type a claimed venue ticks) and Banquet halls.
-- Mirrors web/src/lib/styles.ts. The 4-argument version stays for old callers.

create or replace function vendor_matches_style(p_name text, p_setting text, p_amenities text[], p_details jsonb, p_style text)
returns boolean language sql immutable set search_path = public as $$
  with t as (
    select coalesce(p_amenities, '{}')
             || coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_details->'amenities') = 'array' then p_details->'amenities' end)), '{}') as amen,
           coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_details->'venue_type') = 'array' then p_details->'venue_type' end)), '{}') as vtype,
           coalesce(p_setting, '') as setting, coalesce(p_name, '') as name
  )
  select case p_style
    when 'barn'      then name ~* '(barn|ranch|farm)'
    when 'garden'    then name ~* '(garden|botanic|arboretum|greenhouse)'
    when 'vineyard'  then name ~* '(vineyard|winery|wine|cellars)'
    when 'ballroom'  then name ~* '(ballroom|grand hall|hotel)'
    when 'loft'      then name ~* '(loft|warehouse|industrial|studio)'
    when 'waterfront' then name ~* '(beach|lake|harbor|harbour|bay|river|waterfront|marina|pier)'
    when 'historic'  then name ~* '(historic|mansion|manor|castle|estate)'
    when 'outdoor' then setting ~* '(outdoor|both)'
      or amen && array['Outdoor event space', 'Covered outdoor space']
      or vtype && array['Beach', 'Garden', 'Park', 'Farm & ranch', 'Mountain', 'Rooftop', 'Tented', 'Trees & forest', 'Vineyard & winery', 'Waterfront', 'Golf course']
      or (name ~* '\y(gardens?|park|farms?|ranch|vineyards?|winery|beach|lake|lakeside|orchards?|meadows?|woods|forest|outdoors?|pavilion|terrace|rooftop|botanical?|arboretum|preserve|grove|lawns?)\y'
          and name !~* '\y(hotel|inn|suites|club|cent(er|re)|marriott|hilton|hyatt|aloft|courtyard by|association|jazz|music|senior|theat(er|re)|apartments?|lofts?)\y')
    when 'indoor' then setting ~* '(indoor|both)'
      or amen && array['Indoor event space']
      or vtype && array['Ballroom', 'Banquet hall', 'Hotel', 'Loft', 'Industrial & warehouse', 'Museum & gallery', 'Restaurant', 'Chapel', 'Country club', 'Castle', 'Brewery & distillery']
      or name ~* '\y(halls?|ballroom|hotel|club|lofts?|museum|gallery|theat(er|re)|library|mansion|manor|restaurant|studio|warehouse|cent(er|re)|inn|chapel|banquets?|lounge)\y'
    when 'banquet-halls' then vtype && array['Banquet hall']
      or name ~* '\y(banquets?|event halls?|events halls?|reception halls?|reception cent(er|re)s?|events? cent(er|re)s?|conference cent(er|re)s?|catering halls?|function halls?|party halls?)\y'
    else false end
  from t
$$;

create or replace function vendor_matches_style(p_name text, p_setting text, p_amenities text[], p_style text) returns boolean
language sql immutable set search_path = public as $$
  select vendor_matches_style(p_name, p_setting, p_amenities, null::jsonb, p_style)
$$;

create or replace function search_vendors(p_city int, p_category int, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_guests int := nullif(p->>'guests', '')::int;
  v_rating numeric := nullif(p->>'min_rating', '')::numeric;
  v_settings text[] := array(select jsonb_array_elements_text(coalesce(p->'settings', '[]')));
  v_style text := nullif(p->>'style', '');
  v_sort text := coalesce(p->>'sort', 'rec');
  v_offset int := greatest(0, coalesce((p->>'offset')::int, 0));
  v_limit int := least(60, greatest(1, coalesce((p->>'limit')::int, 20)));
  res jsonb;
begin
  with base as (
    select v.*, (exists (select 1 from photos ph where ph.vendor_id = v.id)
                 or exists (select 1 from packages pk where pk.vendor_id = v.id)) as has_media
    from public_vendors v
    where v.category_id = p_category
      and (v.city_id = p_city or exists (select 1 from vendor_cities vc where vc.vendor_id = v.id and vc.city_id = p_city))
      and not exists (select 1 from country_hidden_categories h join regions r on r.country_code = h.country_code
                      join cities c on c.region_id = r.id where c.id = p_city and h.category_id = p_category)
  ), hits as (
    select b.* from base b
    where (v_guests is null or v_guests = 0 or b.capacity_max is null or b.capacity_max >= v_guests)
      and (v_rating is null or coalesce(b.rating, 0) >= v_rating)
      and (cardinality(v_settings) = 0 or b.setting = any (v_settings))
      and (jsonb_array_length(coalesce(p->'prices', '[]')) = 0 or exists (
            select 1 from jsonb_array_elements(p->'prices') pr
            where b.price_from >= (pr->>0)::int and ((pr->>1)::int = 0 or b.price_from < (pr->>1)::int)))
      and (v_style is null or vendor_matches_style(b.name, b.setting, b.amenities, b.details, v_style))
  ), ranked as (
    select h.*, row_number() over (order by
      case when v_sort = 'rating' then -coalesce(h.rating, 0) end,
      case when v_sort = 'price' then coalesce(h.price_from, 2147483647) end,
      case when v_sort = 'reviews' then -h.review_count end,
      h.featured desc, (h.status = 'claimed') desc, h.rating desc nulls last, h.review_count desc, h.slug) as rn
    from hits h
  )
  select jsonb_build_object('total', (select count(*) from hits), 'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'name', r.name, 'city_id', r.city_id, 'setting', r.setting, 'capacity_max', r.capacity_max,
      'city', (select c.name from cities c where c.id = r.city_id),
      'st', (select upper(g.code) from cities c join regions g on g.id = c.region_id where c.id = r.city_id),
      'price_from', r.price_from, 'rating', r.rating, 'review_count', r.review_count, 'avg_reply_minutes', r.avg_reply_minutes,
      'featured', r.featured, 'description', left(r.description, 170),
      'photo', (select ph.url from photos ph where ph.vendor_id = r.id order by ph.sort limit 1),
      'has_page', r.status = 'claimed' or r.featured or coalesce(trim(r.description), '') <> '' or r.review_count > 0 or r.has_media
    ) order by r.rn), '[]'::jsonb))
  into res from ranked r where r.rn > v_offset and r.rn <= v_offset + v_limit;
  return res;
end $$;
grant execute on function search_vendors(int, int, jsonb) to anon, authenticated;
