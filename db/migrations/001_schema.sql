-- Bloomvow wedding directory: core schema.
-- Designed for Supabase (Postgres 15+). Multi-country from day one: every
-- city belongs to a region, every region to a country (us, ca, uk, au).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- geography
create table countries (
  code        text primary key check (code ~ '^[a-z]{2}$'),
  name        text not null,
  currency    text not null default 'USD',
  active      boolean not null default false
);

create table regions (
  id            serial primary key,
  country_code  text not null references countries(code),
  code          text not null,            -- 'tx', 'on', 'nsw'
  name          text not null,            -- 'Texas'
  slug          text not null,            -- 'texas'
  unique (country_code, code),
  unique (country_code, slug)
);

create table cities (
  id          serial primary key,
  region_id   int not null references regions(id),
  name        text not null,
  slug        text not null,
  lat         double precision,
  lng         double precision,
  population  int,
  unique (region_id, slug)
);
create index cities_region_idx on cities(region_id);

-- --------------------------------------------------------------- categories
create table categories (
  id            serial primary key,
  slug          text not null unique,     -- 'wedding-venues'
  name          text not null,            -- 'Wedding venues'
  singular      text not null,            -- 'Wedding venue'
  sort          int not null default 100,
  -- Typical share of a total wedding budget spent on this category.
  -- Used to match a couple's budget against a vendor's starting price.
  budget_share  numeric(4,3) not null default 0.08 check (budget_share > 0 and budget_share <= 1),
  -- Whether guest capacity applies when matching (venues, caterers).
  uses_capacity boolean not null default false
);

-- ----------------------------------------------------------------- profiles
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'vendor' check (role in ('vendor', 'admin', 'couple')),
  full_name   text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ vendors
create table vendors (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null check (length(name) between 2 and 120),
  category_id        int not null references categories(id),
  city_id            int not null references cities(id),
  address            text,
  zip                text,
  phone              text,
  website            text,
  email              text,               -- private: where leads are delivered
  description        text,
  price_from         int check (price_from is null or price_from >= 0),
  capacity_max       int check (capacity_max is null or capacity_max > 0),
  setting            text,
  amenities          text[] not null default '{}',
  status             text not null default 'unclaimed' check (status in ('unclaimed', 'claimed', 'hidden')),
  plan               text not null default 'free' check (plan in ('free', 'featured')),
  plan_renews_at     date,
  owner_id           uuid references auth.users(id) on delete set null,
  rating             numeric(2,1) check (rating is null or rating between 1 and 5),
  review_count       int not null default 0,
  avg_reply_minutes  int,
  -- import bookkeeping, used for de-duplication
  source             text,
  phone_digits       text generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored,
  website_domain     text generated always as (
                       nullif(lower(regexp_replace(regexp_replace(coalesce(website, ''), '^https?://(www\.)?', '', 'i'), '/.*$', '')), '')
                     ) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index vendors_city_cat_idx on vendors(city_id, category_id) where status <> 'hidden';
create index vendors_owner_idx on vendors(owner_id);
create index vendors_phone_idx on vendors(phone_digits);
create index vendors_domain_idx on vendors(website_domain);

-- Extra city pages a vendor appears on (service area).
create table vendor_cities (
  vendor_id  uuid not null references vendors(id) on delete cascade,
  city_id    int not null references cities(id),
  primary key (vendor_id, city_id)
);
create index vendor_cities_city_idx on vendor_cities(city_id);

create table packages (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references vendors(id) on delete cascade,
  name         text not null check (length(name) between 1 and 80),
  description  text,
  price        int check (price is null or price >= 0),
  sort         int not null default 0
);

create table photos (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references vendors(id) on delete cascade,
  url        text not null,
  alt        text,
  sort       int not null default 0
);

create table reviews (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references vendors(id) on delete cascade,
  author_name   text not null,
  author_email  text,
  wedding_date  date,
  rating        int not null check (rating between 1 and 5),
  body          text not null check (length(body) between 20 and 4000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------- leads
create table leads (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  source         text not null check (source in ('profile', 'matched', 'bulk')),
  couple_name    text not null,
  email          text not null,
  phone          text,
  wedding_date   date,
  date_flexible  boolean not null default false,
  guests         int check (guests is null or guests between 1 and 3000),
  city_id        int not null references cities(id),
  budget_band    smallint check (budget_band is null or budget_band between 0 and 4),
  message        text,
  category_ids   int[] not null,
  status         text not null default 'routed' check (status in ('routed', 'unmatched', 'spam'))
);
create index leads_created_idx on leads(created_at desc);
create index leads_email_idx on leads(lower(email), created_at desc);

create table lead_recipients (
  lead_id     uuid not null references leads(id) on delete cascade,
  vendor_id   uuid not null references vendors(id) on delete cascade,
  sent_at     timestamptz not null default now(),
  opened_at   timestamptz,
  replied_at  timestamptz,
  reminded_at timestamptz,
  status      text not null default 'new' check (status in ('new', 'replied', 'tour', 'booked', 'lost')),
  reply       text,
  primary key (lead_id, vendor_id)
);
create index lead_recipients_vendor_idx on lead_recipients(vendor_id, sent_at desc);

-- ------------------------------------------------------------------- claims
create table claims (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references vendors(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  phone       text,
  note        text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index claims_one_pending on claims(vendor_id, user_id) where status = 'pending';

-- ---------------------------------------------------------- analytics events
create table events (
  id          bigserial primary key,
  vendor_id   uuid references vendors(id) on delete cascade,
  kind        text not null check (kind in ('view', 'impression', 'click_phone', 'click_website', 'click_directions', 'shortlist')),
  page_path   text,
  created_at  timestamptz not null default now()
);
create index events_vendor_idx on events(vendor_id, created_at desc);
create index events_created_idx on events(created_at desc);

-- -------------------------------------------- outbound email/SMS queue
-- Rows are written by triggers and functions; a scheduled Edge Function
-- reads unsent rows and delivers them (Resend / Twilio).
create table notifications (
  id          bigserial primary key,
  kind        text not null,       -- 'lead_to_vendor', 'reply_to_couple', 'lead_reminder', 'claim_decided'
  to_email    text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);
create index notifications_unsent_idx on notifications(created_at) where sent_at is null;

-- ---------------------------------------------------------------- settings
create table settings (
  key    text primary key,
  value  jsonb not null
);
insert into settings(key, value) values
  ('min_vendors_to_index', '5'),         -- city x category pages below this are noindex
  ('vendors_per_category', '3'),         -- leads routed per category in "Get matched"
  ('bulk_max_vendors', '8'),             -- "Request pricing from all"
  ('similar_vendors', '3'),              -- "Also send to 3 similar" on profile form
  ('nearby_km', '60'),                   -- widen matching to nearby cities
  ('free_plan_cities', '1'),
  ('featured_plan_cities', '5'),
  ('budget_bands', '[15000, 30000, 50000, 80000, 150000]');  -- upper bound per band

-- ----------------------------------------------------------- housekeeping
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger vendors_touch before update on vendors for each row execute function touch_updated_at();

create or replace function slugify(t text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(t, ''),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ&', 'aaaaaaceeeeiiiinooooouuuuyy ')), '[^a-z0-9]+', '-', 'g'))
$$;

-- Every new auth user gets a profile (vendor by default).
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name) values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
