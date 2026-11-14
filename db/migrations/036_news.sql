-- News & updates on city/category listing pages (Admin > News).
--
-- Collected inside the database: every 5 minutes news_fetch() asks Google News (RSS search) about
-- a few "targets" that are due, and reads the answers that came back. Targets are each city
-- (local wedding & venue news) and each vendor type (national news about that service). A target
-- is checked daily during its first 7 days, then weekly.
-- Only items that pass every check are kept:
--   * from a credible publisher on the allow-list (Admin > News > Sources)
--   * the headline is about weddings/events (and names the city, for city news)
--   * nothing on the block-list: deaths, crime, accidents, disasters, lawsuits, closures...
--   * published in the last 21 days
-- New items are published straight away unless "approve before publishing" is on. Admins can
-- edit, hide, delete or add items by hand. Pages show up to 4: this city and vendor type first,
-- then this city, then this vendor type, then general.

create table if not exists news_items (
  id            bigserial primary key,
  title         text not null check (length(btrim(title)) between 5 and 300),
  summary       text check (length(summary) <= 600),
  url           text not null unique check (url ~ '^https?://' and length(url) <= 2000),
  source_name   text not null check (length(source_name) between 1 and 120),
  source_domain text check (length(source_domain) <= 120),
  published_at  timestamptz not null,
  city_id       int references cities(id) on delete cascade,
  category_id   int references categories(id) on delete cascade,
  status        text not null default 'published' check (status in ('published', 'pending', 'hidden')),
  origin        text not null default 'auto' check (origin in ('auto', 'manual')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists news_items_page_idx on news_items (status, city_id, category_id, published_at desc);
alter table news_items enable row level security;
drop policy if exists news_public_read on news_items;
drop policy if exists news_admin_all on news_items;
create policy news_public_read on news_items for select to anon, authenticated using (status = 'published');
create policy news_admin_all on news_items for all to authenticated using (is_admin()) with check (is_admin());
grant select on news_items to anon, authenticated;
grant insert, update, delete on news_items to authenticated;
grant usage on sequence news_items_id_seq to authenticated;

create table if not exists news_targets (
  id           serial primary key,
  city_id      int references cities(id) on delete cascade,
  category_id  int references categories(id) on delete cascade,
  query        text not null,
  must_match   text not null,             -- regex the headline must match
  first_run_at timestamptz,
  last_run_at  timestamptz,
  request_id   bigint,
  last_found   int,
  active       boolean not null default true,
  unique nulls not distinct (city_id, category_id)
);
alter table news_targets enable row level security;
drop policy if exists news_targets_admin on news_targets;
create policy news_targets_admin on news_targets for select to authenticated using (is_admin());
revoke all on news_targets from anon;

-- Settings (Admin > News): approval, credible sources, blocked words.
create or replace function news_settings_ok(v jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(v) = 'object'
    and not exists (select 1 from jsonb_object_keys(v) k where k not in ('approval', 'sources', 'blocked', 'paused'))
    and coalesce(jsonb_typeof(v->'approval'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(v->'paused'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(v->'sources'), 'array') = 'array'
    and jsonb_array_length(coalesce(v->'sources', '[]')) <= 500
    and not exists (select 1 from jsonb_array_elements(coalesce(v->'sources', '[]')) s
                    where jsonb_typeof(s) <> 'string' or s #>> '{}' !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
    and coalesce(jsonb_typeof(v->'blocked'), 'string') = 'string'
    and length(coalesce(v->>'blocked', '')) <= 4000
$$;
alter table settings drop constraint if exists settings_news_check;
alter table settings add constraint settings_news_check check (key <> 'news' or news_settings_ok(value));

insert into settings (key, value) values ('news', jsonb_build_object(
  'approval', false,
  'paused', false,
  'blocked', 'dies, died, dead, death, deaths, killed, kills, murder, shooting, shot, stabbed, stabbing, crash, collision, wreck, fire, blaze, burned, flood, flooding, storm, hurricane, tornado, earthquake, explosion, collapse, injured, injuries, hospitalized, heart stops, cardiac, arrest, arrested, charged, indicted, lawsuit, sued, sues, fraud, scam, theft, stolen, robbery, assault, abuse, harassment, police, crime, victim, missing, tragic, tragedy, mourn, mourning, funeral, obituary, memorial, vigil, overdose, disaster, evacuation, bankrupt, bankruptcy, closes, closing, closed, shut down, layoffs, divorce, scandal, outrage, brawl, fight, recall, protest, shutdown, politics, election',
  'sources', to_jsonb(array[
    -- national news
    'apnews.com', 'reuters.com', 'nytimes.com', 'washingtonpost.com', 'wsj.com', 'usatoday.com', 'npr.org', 'cnn.com', 'nbcnews.com',
    'cbsnews.com', 'abcnews.go.com', 'forbes.com', 'bloomberg.com', 'axios.com', 'cnbc.com', 'time.com', 'today.com', 'goodmorningamerica.com',
    -- weddings, events, lifestyle & travel
    'theknot.com', 'weddingwire.com', 'brides.com', 'marthastewart.com', 'vogue.com', 'harpersbazaar.com', 'townandcountrymag.com',
    'people.com', 'elle.com', 'glamour.com', 'cosmopolitan.com', 'housebeautiful.com', 'veranda.com', 'southernliving.com', 'bizbash.com',
    'eventmarketer.com', 'specialevents.com', 'cntraveler.com', 'travelandleisure.com', 'fodors.com', 'afar.com', 'eater.com', 'timeout.com',
    'thrillist.com', 'bonappetit.com', 'foodandwine.com', 'architecturaldigest.com', 'bizjournals.com', 'communityimpact.com', 'culturemap.com',
    'patch.com',
    -- city & regional papers and TV
    'statesman.com', 'austinmonthly.com', 'austinchronicle.com', 'kxan.com', 'kvue.com', 'expressnews.com', 'mysanantonio.com', 'ksat.com',
    'dallasnews.com', 'dmagazine.com', 'wfaa.com', 'star-telegram.com', 'houstonchronicle.com', 'chron.com', 'houstoniamag.com', 'khou.com',
    'tennessean.com', 'nashvillescene.com', 'wsmv.com', 'williamsonherald.com', 'ny1.com', 'nypost.com', 'nydailynews.com', 'brooklynpaper.com',
    'jerseydigs.com', 'nj.com', 'latimes.com', 'lamag.com', 'sandiegouniontribune.com', 'sandiegomagazine.com', 'sfchronicle.com', 'sfgate.com',
    'sfstandard.com', 'napavalleyregister.com', 'chicagotribune.com', 'chicagomag.com', 'suntimes.com', 'miamiherald.com', 'miaminewtimes.com',
    'orlandosentinel.com', 'orlandoweekly.com', 'tampabay.com', 'ajc.com', 'atlantamagazine.com', 'denverpost.com', '5280.com', 'dailycamera.com',
    'postandcourier.com', 'charlestonmag.com', 'seattletimes.com', 'seattlemet.com', 'azcentral.com', 'phoenixnewtimes.com', 'bostonglobe.com',
    'boston.com', 'bostonmagazine.com', 'inquirer.com', 'phillymag.com', 'charlotteobserver.com', 'charlottemagazine.com', 'citizen-times.com',
    'nola.com', 'neworleansmagazine.com', 'reviewjournal.com', 'lasvegassun.com', 'oregonlive.com', 'portlandmonthlymag.com', 'startribune.com',
    'mspmag.com', 'kansascity.com', 'kcur.org', 'sltrib.com', 'deseret.com', 'washingtonian.com', 'dcist.com', 'wtop.com']::text[])
)) on conflict (key) do nothing;

-- One target per city (local news) and per vendor type (national news). Run again any time;
-- new cities and vendor types are added, existing targets are left alone.
create or replace function news_seed_targets() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into news_targets (city_id, category_id, query, must_match)
  select ci.id, null,
    format('"%s" (wedding OR bridal OR "wedding venue" OR "event venue" OR "event space") when:21d', case ci.slug when 'new-york-city' then 'New York' else ci.name end),
    '(wedding|bridal|bride|engag|elop|venue|event space|ballroom|reception|ceremony)'
  from cities ci
  on conflict (city_id, category_id) do nothing;
  insert into news_targets (city_id, category_id, query, must_match)
  select null, c.id, t.q || ' when:21d', t.re
  from categories c join (values
    ('wedding-venues', '"wedding venue" OR "wedding venues" OR "event venue" OR "event space"', '(wedding venue|event venue|event space|ballroom|banquet)'),
    ('photographers', '"wedding photography" OR "wedding photographer" OR "wedding photos"', 'wedding photo'),
    ('caterers', '"wedding catering" OR "wedding menu" OR "wedding food"', '(wedding cater|catering|wedding menu|wedding food)'),
    ('florists', '"wedding flowers" OR "wedding florist" OR "bridal bouquet"', '(wedding flower|florist|floral|bouquet)'),
    ('planners', '"wedding planner" OR "wedding planning"', 'wedding plann'),
    ('hair-makeup', '"bridal makeup" OR "wedding makeup" OR "bridal hair" OR "wedding hair"', '(bridal|wedding) (makeup|hair|beauty)'),
    ('bridal-shops', '"wedding dress" OR "bridal gown" OR "bridal fashion" OR "bridal collection"', '(wedding dress|bridal (gown|fashion|collection|shop|week)|gown)'),
    ('wedding-cakes', '"wedding cake" OR "wedding cakes" OR "wedding dessert"', '(wedding cake|wedding dessert)'),
    ('djs-bands', '"wedding DJ" OR "wedding band" OR "wedding songs" OR "wedding music"', 'wedding (dj|band|song|music|playlist)'),
    ('videographers', '"wedding video" OR "wedding videographer" OR "wedding film"', 'wedding (video|film)'),
    ('invitations', '"wedding invitations" OR "save the date" OR "wedding stationery"', '(wedding invitation|save.the.date|stationery)'),
    ('rentals', '"event rentals" OR "wedding decor" OR "wedding tent"', '(event rental|wedding (decor|tent|rental))'),
    ('transportation', '"wedding transportation" OR "wedding car" OR "wedding limo"', 'wedding (transport|car|limo)'),
    ('photo-booths', '"photo booth" wedding', 'photo booth'),
    ('officiants', '"wedding officiant" OR "marriage license"', '(officiant|marriage licen)')
  ) as t(slug, q, re) on t.slug = c.slug
  on conflict (city_id, category_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
select news_seed_targets();

-- Daily for a target's first 7 days, then weekly.
create or replace function news_target_due(t news_targets) returns boolean language sql stable as $$
  select t.active and t.request_id is null and (
    t.first_run_at is null
    or (t.first_run_at > now() - interval '7 days' and t.last_run_at < now() - interval '20 hours')
    or t.last_run_at < now() - interval '6 days 20 hours')
$$;

-- Blocked words setting -> one regex.
create or replace function news_block_regex() returns text language sql stable set search_path = public as $$
  select '\m(' || string_agg(regexp_replace(btrim(w), '([.^$|()\[\]{}*+?\\])', '\\\1', 'g'), '|') || ')'
  from unnest(string_to_array((select value->>'blocked' from settings where key = 'news'), ',')) w
  where btrim(w) <> ''
$$;

-- Read one Google News answer into news_items. Returns how many were added.
create or replace function news_parse(t news_targets, body text) returns int
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from settings where key = 'news'), '{}');
  sources text[] := array(select jsonb_array_elements_text(coalesce(cfg->'sources', '[]')));
  blocked text := news_block_regex();
  city_re text;
  doc xml;
  n int := 0;
  it record;
begin
  begin doc := body::xml; exception when others then return 0; end;
  if t.city_id is not null then
    select '\m' || regexp_replace(case slug when 'new-york-city' then 'New York' when 'washington' then 'Washington|D\.C\.|DC' else name end, '([.^$()\[\]{}*+?])', '\\\1', 'g') || '\M'
    into city_re from cities where id = t.city_id;
  end if;
  for it in
    select x.title, x.link, x.src, lower(regexp_replace(coalesce(x.srcurl, ''), '^https?://(www\.)?([^/]+).*$', '\2')) as dom, x.pub
    from (select (xpath('/item/title/text()', i))[1]::text as title, (xpath('/item/link/text()', i))[1]::text as link,
                 (xpath('/item/source/text()', i))[1]::text as src, (xpath('/item/source/@url', i))[1]::text as srcurl,
                 (xpath('/item/pubDate/text()', i))[1]::text as pub
          from unnest(xpath('//item', doc)) i) x
  loop
    declare
      raw text := btrim(replace(replace(replace(coalesce(it.title, ''), '&amp;', '&'), '&#39;', ''''), '&quot;', '"'));
      clean text := btrim(case when it.src is not null and right(raw, length(it.src) + 3) = ' - ' || it.src
                               then left(raw, length(raw) - length(it.src) - 3) else raw end);
      pub timestamptz;
    begin
      begin pub := to_timestamp(substr(it.pub, 6, 20), 'DD Mon YYYY HH24:MI:SS') at time zone 'UTC'; exception when others then continue; end;
      continue when pub < now() - interval '21 days' or pub > now() + interval '1 day';
      continue when it.link is null or it.src is null or length(clean) < 15;
      continue when not exists (select 1 from unnest(sources) s where it.dom = s or it.dom like '%.' || s);
      continue when clean !~* t.must_match;
      continue when city_re is not null and clean !~* city_re;
      continue when blocked is not null and clean ~* blocked;
      continue when exists (select 1 from news_items where lower(title) = lower(clean));
      insert into news_items (title, url, source_name, source_domain, published_at, city_id, category_id, status, origin)
      values (left(clean, 300), it.link, left(it.src, 120), it.dom, pub, t.city_id, t.category_id,
              case when coalesce((cfg->>'approval')::boolean, false) then 'pending' else 'published' end, 'auto')
      on conflict (url) do nothing;
      if found then n := n + 1; end if;
    end;
  end loop;
  return n;
end $$;

-- The scheduled step: read answers that came back, then ask about the next few due targets.
create or replace function news_fetch(p_batch int default 6) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t news_targets; st int; content text; added int := 0; asked int := 0; rid bigint;
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
  if coalesce((select (value->>'paused')::boolean from settings where key = 'news'), false) then
    return jsonb_build_object('added', added, 'asked', 0, 'paused', true);
  end if;
  for t in select * from news_targets nt where news_target_due(nt) order by nt.last_run_at nulls first, nt.id limit p_batch loop
    execute 'select net.http_get(url := $1, timeout_milliseconds := 15000)' into rid
      using 'https://news.google.com/rss/search?q=' || replace(replace(replace(t.query, '"', '%22'), ' ', '+'), ':', '%3A') || '&hl=en-US&gl=US&ceid=US:en';
    update news_targets set request_id = rid, last_run_at = now(), first_run_at = coalesce(first_run_at, now()) where id = t.id;
    asked := asked + 1;
  end loop;
  return jsonb_build_object('added', added, 'asked', asked);
end $$;

-- What a listing page shows: up to p_limit published items from the last 90 days, most specific first.
create or replace function news_for(p_city int, p_category int, p_limit int default 4) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'summary', summary, 'url', url,
      'source', source_name, 'date', published_at::date) order by rk, published_at desc), '[]')
  from (
    select n.*, case when n.city_id = p_city and n.category_id = p_category then 1
                     when n.city_id = p_city and n.category_id is null then 2
                     when n.city_id is null and n.category_id = p_category then 3 else 4 end as rk
    from news_items n
    where n.status = 'published' and n.published_at > now() - interval '90 days'
      and (n.city_id = p_city or n.city_id is null) and (n.category_id = p_category or n.category_id is null)
    order by rk, n.published_at desc
    limit least(greatest(coalesce(p_limit, 4), 1), 8)
  ) x
$$;
grant execute on function news_for(int, int, int) to anon, authenticated;

-- Admin > News: "Check for news now" makes every target due again.
create or replace function admin_news_refresh() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_admin();
  perform news_seed_targets();
  update news_targets set last_run_at = now() - interval '8 days', request_id = null where active;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function news_fetch(int), news_parse(news_targets, text), news_seed_targets(), admin_news_refresh() from public, anon;
grant execute on function admin_news_refresh() to authenticated;

create or replace function news_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists news_items_touch on news_items;
create trigger news_items_touch before update on news_items for each row execute function news_touch();

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('news-fetch', '*/5 * * * *', 'select public.news_fetch()');
  end if;
end $$;
