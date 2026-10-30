-- Business logic. Everything the public site and dashboards change goes
-- through these functions, so the rules live in one tested place.

create or replace function setting_int(k text) returns int language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::int from settings where key = k
$$;

create or replace function budget_band_max(band int) returns int language sql stable security definer set search_path = public as $$
  select (value ->> band)::int from settings where key = 'budget_bands'
$$;

create or replace function km_between(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8 language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ------------------------------------------------------------ matching
-- Vendors that fit a request, best first:
--   serves the city (primary or service area) or a city within nearby_km,
--   right category, has a delivery email, not hidden,
--   fits guest count (for categories that use capacity),
--   starting price fits the couple's budget share for that category.
-- Order: featured plan, same city, claimed, rating, review count.
create or replace function match_vendors(
  p_city int, p_category int, p_guests int, p_band int, p_limit int, p_exclude uuid[] default '{}'
) returns table (vendor_id uuid, km float8)
language sql stable security definer set search_path = public as $$
  with origin as (
    select c.id, c.lat, c.lng, r.country_code
    from cities c join regions r on r.id = c.region_id where c.id = p_city
  ),
  near as (
    select c.id,
           case when c.id = o.id then 0
                when c.lat is null or o.lat is null then null
                else km_between(o.lat, o.lng, c.lat, c.lng) end as km
    from cities c join regions r on r.id = c.region_id, origin o
    where r.country_code = o.country_code
  ),
  near_ok as (select id, km from near where km is not null and km <= setting_int('nearby_km')),
  served as (
    select v.id, min(n.km) as km
    from vendors v
    join near_ok n on n.id = v.city_id
       or n.id in (select vc.city_id from vendor_cities vc where vc.vendor_id = v.id)
    where v.category_id = p_category
    group by v.id
  ),
  cat as (select * from categories where id = p_category)
  select v.id, s.km
  from served s
  join vendors v on v.id = s.id
  cross join cat
  where v.status <> 'hidden'
    and v.email is not null
    and not (v.id = any (coalesce(p_exclude, '{}')))
    and (not cat.uses_capacity or p_guests is null or v.capacity_max is null or v.capacity_max >= p_guests)
    and (p_band is null or v.price_from is null or v.price_from <= budget_band_max(p_band) * cat.budget_share)
  order by (v.plan = 'featured') desc, (s.km = 0) desc, (v.status = 'claimed') desc,
           v.rating desc nulls last, v.review_count desc, v.id
  limit greatest(p_limit, 0)
$$;

-- --------------------------------------------------------- submit_lead
-- Called by every lead form on the public site (anon).
-- payload: source ('profile' | 'matched' | 'bulk'), couple_name, email, phone,
--          wedding_date, date_flexible, guests, city_id, budget_band, message,
--          category_ids (matched/bulk), vendor_id + also_similar (profile),
--          website (hidden honeypot field; bots fill it in)
create or replace function submit_lead(payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_source  text := payload->>'source';
  v_name    text := nullif(trim(payload->>'couple_name'), '');
  v_email   text := lower(trim(coalesce(payload->>'email', '')));
  v_city    int;
  v_guests  int;
  v_band    int;
  v_date    date;
  v_vendor  uuid;
  v_cats    int[];
  v_lead    uuid;
  v_cat     int;
  v_limit   int;
  v_n       int := 0;
  r         record;
begin
  if v_source is null or v_source not in ('profile', 'matched', 'bulk') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  begin
    v_city   := (payload->>'city_id')::int;
    v_guests := nullif(payload->>'guests', '')::int;
    v_band   := nullif(payload->>'budget_band', '')::int;
    v_date   := nullif(payload->>'wedding_date', '')::date;
    v_vendor := nullif(payload->>'vendor_id', '')::uuid;
  exception when others then
    raise exception 'invalid_field' using errcode = '22023';
  end;

  if not exists (select 1 from cities where id = v_city) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if v_guests is not null and (v_guests < 1 or v_guests > 3000) then
    raise exception 'invalid_guests' using errcode = '22023';
  end if;
  if v_band is not null and (v_band < 0 or v_band > 4) then
    raise exception 'invalid_budget' using errcode = '22023';
  end if;

  if v_source = 'profile' then
    select category_id into v_cat from vendors where id = v_vendor and status <> 'hidden';
    if v_cat is null then
      raise exception 'invalid_vendor' using errcode = '22023';
    end if;
    v_cats := array[v_cat];
  else
    select coalesce(array_agg(distinct x::int), '{}') into v_cats
    from jsonb_array_elements_text(coalesce(payload->'category_ids', '[]'::jsonb)) x;
    if cardinality(v_cats) = 0 or cardinality(v_cats) > 15
       or (select count(*) from categories where id = any (v_cats)) <> cardinality(v_cats) then
      raise exception 'invalid_categories' using errcode = '22023';
    end if;
    perform enforce_active_categories(v_cats, v_city);   -- hidden categories can't be requested (006, 010)
  end if;

  -- Simple abuse limit: 5 requests per email per hour.
  if (select count(*) from leads where lower(email) = v_email and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into leads (source, couple_name, email, phone, wedding_date, date_flexible, guests,
                     city_id, budget_band, message, category_ids, status)
  values (v_source, v_name, v_email, nullif(trim(payload->>'phone'), ''), v_date,
          coalesce((payload->>'date_flexible')::boolean, false), v_guests, v_city, v_band,
          left(payload->>'message', 4000), v_cats,
          case when coalesce(payload->>'website', '') <> '' then 'spam' else 'routed' end)
  returning id into v_lead;

  -- Honeypot tripped: accept silently, route nowhere.
  if coalesce(payload->>'website', '') <> '' then
    return jsonb_build_object('lead_id', v_lead, 'matched', 0);
  end if;

  if v_source = 'profile' then
    insert into lead_recipients (lead_id, vendor_id) values (v_lead, v_vendor);
    v_n := 1;
    if coalesce((payload->>'also_similar')::boolean, false) then
      for r in select * from match_vendors(v_city, v_cat, v_guests, v_band, setting_int('similar_vendors'), array[v_vendor]) loop
        insert into lead_recipients (lead_id, vendor_id) values (v_lead, r.vendor_id) on conflict do nothing;
        v_n := v_n + 1;
      end loop;
    end if;
  else
    v_limit := case when v_source = 'bulk' then setting_int('bulk_max_vendors') else setting_int('vendors_per_category') end;
    foreach v_cat in array v_cats loop
      for r in select * from match_vendors(v_city, v_cat, v_guests, v_band, v_limit) loop
        insert into lead_recipients (lead_id, vendor_id) values (v_lead, r.vendor_id) on conflict do nothing;
        v_n := v_n + 1;
      end loop;
    end loop;
  end if;

  if v_n = 0 then
    update leads set status = 'unmatched' where id = v_lead;
  end if;

  return jsonb_build_object('lead_id', v_lead, 'matched', v_n);
end $$;

-- Queue an email to each vendor that receives a lead.
create or replace function queue_lead_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v vendors;
begin
  select * into v from vendors where id = new.vendor_id;
  if v.email is not null then
    insert into notifications (kind, to_email, payload)
    values ('lead_to_vendor', v.email, jsonb_build_object(
      'lead_id', new.lead_id, 'vendor_id', v.id, 'vendor_name', v.name,
      'claimed', v.status = 'claimed', 'sms', v.plan = 'featured', 'phone', v.phone));
  end if;
  return new;
end $$;
create trigger lead_recipient_notify after insert on lead_recipients
  for each row execute function queue_lead_notification();

-- ------------------------------------------------------- vendor actions
create or replace function mark_lead_opened(p_lead uuid, p_vendor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (owns_vendor(p_vendor) or is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update lead_recipients set opened_at = coalesce(opened_at, now())
  where lead_id = p_lead and vendor_id = p_vendor;
end $$;

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
    insert into notifications (kind, to_email, payload) values ('reply_to_couple', l.email,
      jsonb_build_object('lead_id', l.id, 'vendor_id', v.id, 'vendor_name', v.name, 'reply', txt, 'reply_to', v.email));
    update vendors set avg_reply_minutes = (
      select round(avg(extract(epoch from (replied_at - sent_at)) / 60))::int
      from lead_recipients where vendor_id = p_vendor and replied_at is not null)
    where id = p_vendor;
  end if;
  return lr;
end $$;

-- Free listings cover their primary city only; featured listings get more.
create or replace function enforce_city_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v vendors; lim int; used int;
begin
  select * into v from vendors where id = new.vendor_id;
  if new.city_id = v.city_id then return null; end if;   -- primary city: nothing to add
  lim := case when v.plan = 'featured' then setting_int('featured_plan_cities') else setting_int('free_plan_cities') end;
  select 1 + count(*) into used from vendor_cities where vendor_id = new.vendor_id and city_id <> v.city_id;
  if used + 1 > lim then
    raise exception 'city_limit_reached' using errcode = 'P0001',
      hint = format('Your plan allows %s city page(s).', lim);
  end if;
  return new;
end $$;
create trigger vendor_cities_limit before insert on vendor_cities
  for each row execute function enforce_city_limit();

-- ---------------------------------------------------------- public actions
create or replace function track_event(p_vendor uuid, p_kind text, p_path text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('view', 'impression', 'click_phone', 'click_website', 'click_directions', 'shortlist') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_vendor is not null and not exists (select 1 from vendors where id = p_vendor and status <> 'hidden') then
    return;
  end if;
  insert into events (vendor_id, kind, page_path) values (p_vendor, p_kind, left(p_path, 300));
end $$;

-- Batched version for listing pages (one call for all impressions).
create or replace function track_impressions(p_vendors uuid[], p_path text default null) returns void
language sql security definer set search_path = public as $$
  insert into events (vendor_id, kind, page_path)
  select v.id, 'impression', left(p_path, 300) from vendors v
  where v.id = any (p_vendors[1:60]) and v.status <> 'hidden'
$$;

create or replace function submit_review(p_vendor uuid, p_name text, p_email text, p_wedding_date date, p_rating int, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not exists (select 1 from vendors where id = p_vendor and status <> 'hidden') then
    raise exception 'invalid_vendor' using errcode = '22023';
  end if;
  insert into reviews (vendor_id, author_name, author_email, wedding_date, rating, body)
  values (p_vendor, trim(p_name), lower(trim(p_email)), p_wedding_date, p_rating, trim(p_body))
  returning id into rid;
  return rid;
end $$;

create or replace function request_claim(p_vendor uuid, p_phone text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v     vendors;
  em    text;
  cid   uuid;
  check_result text;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into v from vendors where id = p_vendor;
  if v.id is null or v.status = 'hidden' then raise exception 'invalid_vendor' using errcode = '22023'; end if;
  if v.status = 'claimed' then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  select email into em from auth.users where id = auth.uid();
  insert into claims (vendor_id, user_id, email, phone, note)
  values (p_vendor, auth.uid(), em, p_phone, left(p_note, 1000))
  returning id into cid;
  check_result := case
    when v.website_domain is not null and split_part(lower(em), '@', 2) = v.website_domain then 'domain_match'
    when split_part(lower(em), '@', 2) in ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com') then 'free_email'
    else 'unverified' end;
  return jsonb_build_object('claim_id', cid, 'check', check_result);
end $$;

-- ---------------------------------------------------------- admin actions
create or replace function require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function admin_decide_claim(p_claim uuid, p_approve boolean) returns claims
language plpgsql security definer set search_path = public as $$
declare c claims;
begin
  perform require_admin();
  update claims set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
  where id = p_claim and status = 'pending' returning * into c;
  if c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_approve then
    update vendors set owner_id = c.user_id, status = 'claimed', email = coalesce(email, c.email)
    where id = c.vendor_id;
    update claims set status = 'rejected', decided_at = now()
    where vendor_id = c.vendor_id and status = 'pending' and id <> c.id;
  end if;
  insert into notifications (kind, to_email, payload)
  values ('claim_decided', c.email, jsonb_build_object('vendor_id', c.vendor_id, 'approved', p_approve));
  return c;
end $$;

create or replace function admin_set_vendor(p_vendor uuid, p_status text default null, p_plan text default null, p_renews date default null) returns vendors
language plpgsql security definer set search_path = public as $$
declare v vendors;
begin
  perform require_admin();
  update vendors set
    status = coalesce(p_status, status),
    plan = coalesce(p_plan, plan),
    plan_renews_at = case when p_plan = 'free' then null else coalesce(p_renews, plan_renews_at) end
  where id = p_vendor returning * into v;
  if v.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function refresh_vendor_rating(p_vendor uuid) returns void language sql security definer set search_path = public as $$
  update vendors set
    review_count = (select count(*) from reviews where vendor_id = p_vendor and status = 'approved'),
    rating = (select round(avg(rating)::numeric, 1) from reviews where vendor_id = p_vendor and status = 'approved')
  where id = p_vendor
$$;

create or replace function admin_moderate_review(p_review uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare vid uuid;
begin
  perform require_admin();
  update reviews set status = case when p_approve then 'approved' else 'rejected' end
  where id = p_review returning vendor_id into vid;
  if vid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform refresh_vendor_rating(vid);
end $$;

-- Send a lead to more vendors (e.g. when nobody replied).
create or replace function admin_reroute_lead(p_lead uuid, p_extra int default 3) returns int
language plpgsql security definer set search_path = public as $$
declare l leads; c int; r record; n int := 0; existing uuid[];
begin
  perform require_admin();
  select * into l from leads where id = p_lead;
  if l.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  foreach c in array l.category_ids loop
    select coalesce(array_agg(vendor_id), '{}') into existing from lead_recipients where lead_id = p_lead;
    for r in select * from match_vendors(l.city_id, c, l.guests, l.budget_band, p_extra, existing) loop
      insert into lead_recipients (lead_id, vendor_id) values (p_lead, r.vendor_id) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  if n > 0 then update leads set status = 'routed' where id = p_lead and status = 'unmatched'; end if;
  return n;
end $$;

-- Called hourly by pg_cron: remind vendors about leads left unanswered for 24h.
create or replace function queue_lead_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    update lead_recipients lr set reminded_at = now()
    from vendors v
    where v.id = lr.vendor_id and v.email is not null
      and lr.status = 'new' and lr.replied_at is null and lr.reminded_at is null
      and lr.sent_at < now() - interval '24 hours'
    returning lr.lead_id, lr.vendor_id, v.email, v.name
  )
  insert into notifications (kind, to_email, payload)
  select 'lead_reminder', email, jsonb_build_object('lead_id', lead_id, 'vendor_id', vendor_id, 'vendor_name', name) from due;
  get diagnostics n = row_count;
  return n;
end $$;

-- ----------------------------------------------------------- CSV import
-- rows: [{name, category, city, state, country?, address?, zip?, phone?,
--         website?, email?, price_from?, capacity?, description?, lat?, lng?}]
-- Duplicates (same category and same phone or website domain, or same name
-- in the same city) are merged: empty fields are filled, nothing overwritten.
create or replace function admin_import_vendors(p_rows jsonb, p_source text default 'import', p_create_cities boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  row      jsonb;
  i        int := 0;
  ins      int := 0;
  mrg      int := 0;
  issues   jsonb := '[]'::jsonb;
  v_cat    int;
  v_region int;
  v_city   int;
  v_cityname text;
  v_phone  text;
  v_domain text;
  v_found  uuid;
  v_slug   text;
  v_base   text;
  k        int;
  country  text;
begin
  perform require_admin();
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_must_be_array' using errcode = '22023'; end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    if coalesce(trim(row->>'name'), '') = '' then
      issues := issues || jsonb_build_object('row', i, 'reason', 'missing name'); continue;
    end if;

    select id into v_cat from categories
    where slug = slugify(row->>'category') or lower(name) = lower(trim(row->>'category')) or lower(singular) = lower(trim(row->>'category'))
    limit 1;
    if v_cat is null then
      issues := issues || jsonb_build_object('row', i, 'name', row->>'name', 'reason', 'unknown category: ' || coalesce(row->>'category', '')); continue;
    end if;

    country := lower(coalesce(nullif(trim(row->>'country'), ''), 'us'));
    select id into v_region from regions
    where country_code = country and (lower(code) = lower(trim(row->>'state')) or lower(name) = lower(trim(row->>'state')))
    limit 1;
    if v_region is null then
      issues := issues || jsonb_build_object('row', i, 'name', row->>'name', 'reason', 'unknown state: ' || coalesce(row->>'state', '')); continue;
    end if;

    v_cityname := trim(row->>'city');
    if coalesce(v_cityname, '') = '' then
      issues := issues || jsonb_build_object('row', i, 'name', row->>'name', 'reason', 'missing city'); continue;
    end if;
    select id into v_city from cities where region_id = v_region and slug = slugify(v_cityname);
    if v_city is null then
      if not p_create_cities then
        issues := issues || jsonb_build_object('row', i, 'name', row->>'name', 'reason', 'unknown city: ' || v_cityname); continue;
      end if;
      insert into cities (region_id, name, slug, lat, lng)
      values (v_region, initcap(v_cityname), slugify(v_cityname), nullif(row->>'lat', '')::float8, nullif(row->>'lng', '')::float8)
      returning id into v_city;
    end if;

    v_phone  := nullif(right(regexp_replace(coalesce(row->>'phone', ''), '\D', '', 'g'), 10), '');
    v_domain := nullif(lower(regexp_replace(regexp_replace(coalesce(row->>'website', ''), '^https?://(www\.)?', '', 'i'), '/.*$', '')), '');

    select id into v_found from vendors
    where category_id = v_cat and (
      (v_phone is not null and phone_digits = v_phone) or
      (v_domain is not null and website_domain = v_domain) or
      (city_id = v_city and slugify(name) = slugify(row->>'name')))
    limit 1;

    if v_found is not null then
      update vendors set
        address      = coalesce(address, nullif(row->>'address', '')),
        zip          = coalesce(zip, nullif(row->>'zip', '')),
        phone        = coalesce(phone, nullif(row->>'phone', '')),
        website      = coalesce(website, nullif(row->>'website', '')),
        email        = coalesce(email, nullif(lower(row->>'email'), '')),
        description  = coalesce(description, nullif(row->>'description', '')),
        price_from   = coalesce(price_from, nullif(regexp_replace(coalesce(row->>'price_from', ''), '[^0-9]', '', 'g'), '')::int),
        capacity_max = coalesce(capacity_max, nullif(regexp_replace(coalesce(row->>'capacity', ''), '[^0-9]', '', 'g'), '')::int)
      where id = v_found;
      mrg := mrg + 1;
      continue;
    end if;

    v_base := slugify(trim(row->>'name') || '-' || (select name from cities where id = v_city));
    v_slug := v_base; k := 1;
    while exists (select 1 from vendors where slug = v_slug) loop
      k := k + 1; v_slug := v_base || '-' || k;
    end loop;

    insert into vendors (slug, name, category_id, city_id, address, zip, phone, website, email, description,
                         price_from, capacity_max, source)
    values (v_slug, trim(row->>'name'), v_cat, v_city, nullif(row->>'address', ''), nullif(row->>'zip', ''),
            nullif(row->>'phone', ''), nullif(row->>'website', ''), nullif(lower(row->>'email'), ''),
            nullif(row->>'description', ''),
            nullif(regexp_replace(coalesce(row->>'price_from', ''), '[^0-9]', '', 'g'), '')::int,
            nullif(regexp_replace(coalesce(row->>'capacity', ''), '[^0-9]', '', 'g'), '')::int,
            p_source);
    ins := ins + 1;
  end loop;

  return jsonb_build_object('rows', i, 'inserted', ins, 'merged', mrg, 'needs_review', issues);
end $$;

-- ------------------------------------------------------------- dashboards
create or replace function vendor_stats(p_vendor uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v vendors; since timestamptz := now() - make_interval(days => p_days); res jsonb; pos int; total int;
begin
  if not (owns_vendor(p_vendor) or is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from vendors where id = p_vendor;

  with ranked as (
    select id, row_number() over (order by (plan = 'featured') desc, (status = 'claimed') desc,
                                            rating desc nulls last, review_count desc, id) as rn
    from vendors where city_id = v.city_id and category_id = v.category_id and status <> 'hidden'
  )
  select (select rn from ranked where id = p_vendor), (select count(*) from ranked) into pos, total;

  select jsonb_build_object(
    'days', p_days,
    'impressions', count(*) filter (where kind = 'impression'),
    'views', count(*) filter (where kind = 'view'),
    'clicks', count(*) filter (where kind in ('click_phone', 'click_website', 'click_directions')),
    'clicks_phone', count(*) filter (where kind = 'click_phone'),
    'clicks_website', count(*) filter (where kind = 'click_website'),
    'clicks_directions', count(*) filter (where kind = 'click_directions'),
    'shortlists', count(*) filter (where kind = 'shortlist')
  ) into res from events where vendor_id = p_vendor and created_at >= since;

  return res || jsonb_build_object(
    'leads', (select count(*) from lead_recipients where vendor_id = p_vendor and sent_at >= since),
    'leads_new', (select count(*) from lead_recipients where vendor_id = p_vendor and status = 'new'),
    'avg_reply_minutes', v.avg_reply_minutes,
    'rating', v.rating, 'review_count', v.review_count,
    'rank', pos, 'rank_of', total);
end $$;

create or replace function admin_stats(p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => p_days);
begin
  perform require_admin();
  return jsonb_build_object(
    'days', p_days,
    'leads', (select count(*) from leads where created_at >= since and status <> 'spam'),
    'sent', (select count(*) from lead_recipients where sent_at >= since),
    'clicks', (select count(*) from events where created_at >= since and kind in ('click_phone', 'click_website', 'click_directions')),
    'views', (select count(*) from events where created_at >= since and kind = 'view'),
    'reply_rate_24h', (
      select round(100.0 * count(*) filter (where replied_at <= sent_at + interval '24 hours') / nullif(count(*), 0))
      from lead_recipients where sent_at >= since and sent_at < now() - interval '24 hours'),
    'paid_vendors', (select count(*) from vendors where plan = 'featured' and status <> 'hidden'),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'leads', coalesce(l.n, 0), 'replied', coalesce(l.rep, 0)) order by d), '[]')
      from generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day') d
      left join (
        select date_trunc('day', le.created_at) as day, count(distinct le.id) as n,
               count(distinct le.id) filter (where exists (
                 select 1 from lead_recipients lr where lr.lead_id = le.id and lr.replied_at <= lr.sent_at + interval '24 hours')) as rep
        from leads le where le.created_at >= since and le.status <> 'spam' group by 1
      ) l on l.day = d),
    'attention', jsonb_build_object(
      'unreplied_24h', (select count(distinct lead_id) from lead_recipients lr
                        where lr.replied_at is null and lr.sent_at < now() - interval '24 hours'
                          and not exists (select 1 from lead_recipients x where x.lead_id = lr.lead_id and x.replied_at is not null)),
      'unmatched_leads', (select count(*) from leads where status = 'unmatched'),
      'pending_claims', (select count(*) from claims where status = 'pending'),
      'pending_reviews', (select count(*) from reviews where status = 'pending'),
      'pending_comments', (select count(*) from comments where status = 'pending'),   -- table from 007
      'thin_pages', (select count(*) from page_counts where vendor_count < setting_int('min_vendors_to_index')),
      'vendors_without_email', (select count(*) from vendors where email is null and status <> 'hidden'))
  );
end $$;

-- ------------------------------------------------------------- privileges
-- Postgres lets everyone execute functions by default; lock that down.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function submit_lead(jsonb), track_event(uuid, text, text), track_impressions(uuid[], text),
  submit_review(uuid, text, text, date, int, text) to anon, authenticated;

grant execute on function is_admin(), owns_vendor(uuid), request_claim(uuid, text, text),
  mark_lead_opened(uuid, uuid), vendor_reply(uuid, uuid, text, text), vendor_stats(uuid, int),
  admin_decide_claim(uuid, boolean), admin_set_vendor(uuid, text, text, date), admin_moderate_review(uuid, boolean),
  admin_reroute_lead(uuid, int), admin_import_vendors(jsonb, text, boolean), admin_stats(int)
  to authenticated;

-- Used inside RLS policies, views and triggers.
grant execute on function is_admin(), owns_vendor(uuid), slugify(text), setting_int(text) to anon, authenticated;
grant execute on function queue_lead_reminders() to service_role;
