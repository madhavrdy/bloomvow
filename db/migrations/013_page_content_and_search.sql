-- Page content editor, page-view tracking and database-backed listing filters.

-- ------------------------------------------------------------ page content
-- One row per public page, keyed by its URL path (e.g. /us/texas/austin/wedding-venues/).
-- Empty fields fall back to the automatic text on the site.
create table page_content (
  path             text primary key check (path ~ '^/[a-z0-9/-]*/$'),
  intro            text check (intro is null or length(intro) <= 600),     -- short text above the listings (aim for ~350)
  body             text check (body is null or length(body) <= 60000),     -- long guide below the listings (Markdown)
  faqs             jsonb not null default '[]'::jsonb check (jsonb_typeof(faqs) = 'array'),
  seo_title        text check (seo_title is null or length(seo_title) <= 120),
  seo_description  text check (seo_description is null or length(seo_description) <= 320),
  hero_url         text check (hero_url is null or hero_url ~ '^(https://|/)'),
  hero_alt         text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);
alter table page_content enable row level security;
create policy page_content_read on page_content for select using (true);
create policy page_content_write on page_content for all to authenticated using (is_editor()) with check (is_editor());
create or replace function touch_page_content() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger page_content_touch before insert or update on page_content for each row execute function touch_page_content();
grant select on page_content to anon, authenticated;
grant insert, update, delete on page_content to authenticated;

-- FAQ items must be {q, a} with text.
create or replace function check_page_faqs() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from jsonb_array_elements(new.faqs) f
             where jsonb_typeof(f) <> 'object' or coalesce(trim(f->>'q'), '') = '' or coalesce(trim(f->>'a'), '') = '') then
    raise exception 'invalid_faqs' using errcode = '22023', hint = 'Each FAQ needs a question and an answer.';
  end if;
  if jsonb_array_length(new.faqs) > 20 then raise exception 'too_many_faqs' using errcode = '22023'; end if;
  return new;
end $$;
create trigger page_content_faqs before insert or update on page_content for each row execute function check_page_faqs();

-- ------------------------------------------------------------ page views
alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check
  check (kind in ('view', 'impression', 'click_phone', 'click_website', 'click_directions', 'shortlist', 'page_view'));
create index if not exists events_page_idx on events(page_path, created_at) where kind = 'page_view';

create or replace function track_event(p_vendor uuid, p_kind text, p_path text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('view', 'impression', 'click_phone', 'click_website', 'click_directions', 'shortlist', 'page_view') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_kind = 'page_view' and (p_vendor is not null or p_path is null or p_path !~ '^/[a-z0-9/-]*/$') then return; end if;
  if p_vendor is not null and not exists (select 1 from vendors where id = p_vendor and status <> 'hidden') then
    return;
  end if;
  insert into events (vendor_id, kind, page_path) values (p_vendor, p_kind, left(p_path, 300));
end $$;

-- Views per page for the admin page list ("sort by traffic").
create or replace function admin_page_traffic(p_days int default 30) returns table (path text, views bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_editor() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select e.page_path, count(*) from events e
    where e.kind = 'page_view' and e.created_at >= now() - make_interval(days => p_days)
    group by e.page_path;
end $$;
revoke execute on function admin_page_traffic(int) from public, anon;
grant execute on function admin_page_traffic(int) to authenticated;

-- ------------------------------------------------------- listing search
-- All vendors for a city + category (primary city or service area), filtered
-- and sorted, for listing pages when a filter is used. Same ranking as the site.
-- p: {guests, prices: [[min,max]...] (max 0 = no limit), settings: [...], min_rating, style, sort, offset, limit}
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
      and (v_style is null or vendor_matches_style(b.name, b.setting, b.amenities, v_style))
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

-- Venue styles used by sub-category pages (e.g. /us/texas/austin/wedding-venues/barn/).
-- Mirrors web/src/lib/styles.ts.
create or replace function vendor_matches_style(p_name text, p_setting text, p_amenities text[], p_style text) returns boolean
language sql immutable set search_path = public as $$
  select case p_style
    when 'barn'      then p_name ~* '(barn|ranch|farm)'
    when 'garden'    then p_name ~* '(garden|botanic|arboretum|greenhouse)'
    when 'vineyard'  then p_name ~* '(vineyard|winery|wine|cellars)'
    when 'outdoor'   then coalesce(p_setting, '') ~* 'outdoor'
    when 'ballroom'  then p_name ~* '(ballroom|grand hall|hotel)'
    when 'loft'      then p_name ~* '(loft|warehouse|industrial|studio)'
    when 'waterfront' then p_name ~* '(beach|lake|harbor|harbour|bay|river|waterfront|marina|pier)'
    when 'historic'  then p_name ~* '(historic|mansion|manor|castle|estate)'
    else false end
$$;
grant execute on function search_vendors(int, int, jsonb) to anon, authenticated;
create index if not exists vendors_cat_city_idx on vendors(category_id, city_id) where status <> 'hidden';
