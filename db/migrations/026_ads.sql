-- Advertising (Admin > Ads).
-- * Sponsor banners you sell (ad_campaigns): image + link, targeted by country/state/city and
--   category, with dates and a weight; shown on city pages and vendor pages.
-- * Google AdSense (settings key 'ads'): publisher ID plus an ad-unit ID per placement, used on
--   the blog and wherever no sponsor banner is booked.
-- Pages ask ads_for() which ad goes in each slot; featured vendors' pages never get ads.
-- Views and clicks are counted per banner per day (ad_stats, via track_ad()).

-- Placements a page can have.
create or replace function ad_placements() returns text[] language sql immutable as $$
  select array['city_top', 'city_list', 'vendor_page', 'blog_list', 'post_intro', 'post_mid', 'post_end', 'post_side']
$$;
create or replace function sponsor_placements() returns text[] language sql immutable as $$
  select array['city_top', 'city_list', 'vendor_page']
$$;

-- AdSense settings: only IDs and well-formed ads.txt lines, never raw code.
create or replace function ads_ok(v jsonb) returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(v) = 'object'
    and not exists (select 1 from jsonb_object_keys(v) k where k not in ('client', 'slots', 'off', 'ads_txt'))
    and coalesce(v->>'client', 'ca-pub-0000000000') ~ '^ca-pub-[0-9]{10,20}$'
    and coalesce(jsonb_typeof(v->'slots'), 'object') = 'object'
    and not exists (select 1 from jsonb_each(coalesce(v->'slots', '{}')) s
                    where s.key <> all (ad_placements()) or jsonb_typeof(s.value) <> 'string' or s.value #>> '{}' !~ '^[0-9]{6,20}$')
    and coalesce(jsonb_typeof(v->'off'), 'array') = 'array'
    and not exists (select 1 from jsonb_array_elements(coalesce(v->'off', '[]')) o
                    where jsonb_typeof(o) <> 'string' or o #>> '{}' <> all (ad_placements()))
    and coalesce(jsonb_typeof(v->'ads_txt'), 'string') = 'string'
    and length(coalesce(v->>'ads_txt', '')) <= 3000
    and not exists (select 1 from regexp_split_to_table(coalesce(v->>'ads_txt', ''), '\n') line
                    where btrim(line) <> '' and btrim(line) !~ '^#'
                      and btrim(line) !~* '^[a-z0-9.-]+\.[a-z]{2,}\s*,\s*[A-Za-z0-9_-]{1,64}\s*,\s*(DIRECT|RESELLER)(\s*,\s*[A-Za-z0-9]{1,64})?$')
$$;
alter table settings drop constraint if exists settings_ads_check;
alter table settings add constraint settings_ads_check check (key <> 'ads' or ads_ok(value));
insert into settings (key, value) values ('ads', '{}') on conflict (key) do nothing;

create table if not exists ad_campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 2 and 120),
  advertiser   text check (length(advertiser) <= 120),
  image_url    text not null check ((image_url ~ '^https://' or image_url ~ '^http://(localhost|127\.0\.0\.1)[:/]') and length(image_url) <= 500),
  link_url     text not null check (link_url ~ '^https?://[^\s<>"]+$' and length(link_url) <= 500),
  alt          text not null check (length(btrim(alt)) between 2 and 150),
  placements   text[] not null check (cardinality(placements) between 1 and 3 and placements <@ sponsor_placements()),
  country_code text references countries(code),
  region_id    int references regions(id) on delete cascade,
  city_id      int references cities(id) on delete cascade,
  category_id  int references categories(id) on delete cascade,
  starts_on    date,
  ends_on      date,
  weight       int not null default 1 check (weight between 1 and 100),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
alter table ad_campaigns enable row level security;
create policy ad_campaigns_admin on ad_campaigns for all to authenticated using (is_admin()) with check (is_admin());

create table if not exists ad_stats (
  ad_id  uuid not null references ad_campaigns(id) on delete cascade,
  day    date not null default current_date,
  views  int not null default 0,
  clicks int not null default 0,
  primary key (ad_id, day)
);
alter table ad_stats enable row level security;
create policy ad_stats_admin_read on ad_stats for select to authenticated using (is_admin());
-- Visitors never read these directly; pages go through ads_for().
revoke all on ad_campaigns, ad_stats from anon;

-- What goes in each slot on a page. Sponsors first (most specific targeting wins, weighted
-- random among equals); AdSense unit IDs for every enabled placement as the fallback.
create or replace function ads_for(p_placements text[], p_city int default null, p_category int default null, p_vendor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from settings where key = 'ads'), '{}');
  places text[];
  v_region int; v_country text;
  slots jsonb := '{}'; sponsors jsonb := '{}';
  p text; s record;
begin
  places := (select coalesce(array_agg(x), '{}') from unnest(coalesce(p_placements, '{}')) x
             where x = any (ad_placements()) and not coalesce(cfg->'off', '[]') ? x);
  if p_vendor is not null and exists (select 1 from vendors where id = p_vendor and plan = 'featured') then
    return jsonb_build_object('client', null, 'slots', '{}'::jsonb, 'sponsors', '{}'::jsonb);
  end if;
  if p_city is not null then
    select c.region_id, r.country_code into v_region, v_country from cities c join regions r on r.id = c.region_id where c.id = p_city;
  end if;
  foreach p in array places loop
    if cfg->>'client' is not null and cfg->'slots' ? p then
      slots := slots || jsonb_build_object(p, cfg->'slots'->>p);
    end if;
    if p = any (sponsor_placements()) then
      select a.id, a.image_url, a.link_url, a.alt, a.name into s
      from ad_campaigns a
      where a.active and p = any (a.placements)
        and (a.starts_on is null or a.starts_on <= current_date)
        and (a.ends_on is null or a.ends_on >= current_date)
        and (a.city_id is null or a.city_id = p_city)
        and (a.region_id is null or a.region_id = v_region)
        and (a.country_code is null or a.country_code = v_country)
        and (a.category_id is null or p_category is null or a.category_id = p_category)
      order by (a.city_id is not null)::int * 4 + (a.region_id is not null)::int * 2 + (a.country_code is not null)::int
             + (a.category_id is not null)::int * 2 desc,
               -ln(1 - random()) / a.weight
      limit 1;
      if s.id is not null then
        sponsors := sponsors || jsonb_build_object(p, jsonb_build_object('id', s.id, 'image', s.image_url, 'link', s.link_url, 'alt', s.alt));
      end if;
      s := null;
    end if;
  end loop;
  return jsonb_build_object('client', case when slots <> '{}' then cfg->>'client' end, 'slots', slots, 'sponsors', sponsors);
end $$;

create or replace function track_ad(p_ad uuid, p_kind text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_kind not in ('view', 'click') or not exists (select 1 from ad_campaigns where id = p_ad) then return; end if;
  insert into ad_stats (ad_id, views, clicks) values (p_ad, (p_kind = 'view')::int, (p_kind = 'click')::int)
  on conflict (ad_id, day) do update set views = ad_stats.views + excluded.views, clicks = ad_stats.clicks + excluded.clicks;
end $$;

revoke execute on function ads_for(text[], int, int, uuid), track_ad(uuid, text) from public;
grant execute on function ads_for(text[], int, int, uuid), track_ad(uuid, text) to anon, authenticated;

-- Banner images: public to read, admins upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-images', 'ad-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
drop policy if exists "ad images: admins write" on storage.objects;
drop policy if exists "ad images: admins update" on storage.objects;
drop policy if exists "ad images: admins delete" on storage.objects;
drop policy if exists "ad images: public read" on storage.objects;
create policy "ad images: admins write" on storage.objects for insert to authenticated with check (bucket_id = 'ad-images' and public.is_admin());
create policy "ad images: admins update" on storage.objects for update to authenticated using (bucket_id = 'ad-images' and public.is_admin());
create policy "ad images: admins delete" on storage.objects for delete to authenticated using (bucket_id = 'ad-images' and public.is_admin());
create policy "ad images: public read" on storage.objects for select to public using (bucket_id = 'ad-images');
