-- TEMPORARY: lets the GitHub import job upload vendor rows without the database
-- password. Write-only (nobody can read the staging table through the API),
-- needs a one-time token that expires, and is removed right after the import
-- (see the cleanup at the bottom). The token itself is never stored in this repo.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.import_tokens (token text primary key, expires_at timestamptz not null);
create table if not exists public.vendor_import_staging (
  id bigserial primary key, token text not null, row jsonb not null, created_at timestamptz default now());
alter table public.vendor_import_staging enable row level security;
create or replace function public.import_token_ok(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from private.import_tokens where token = t and expires_at > now())
$$;
create policy staging_insert on public.vendor_import_staging for insert to anon with check (public.import_token_ok(token));
grant insert on public.vendor_import_staging to anon;
grant usage on sequence public.vendor_import_staging_id_seq to anon;
create index if not exists vendors_city_slugname_idx on vendors (city_id, slugify(name));
-- then: insert into private.import_tokens values ('<token>', now() + interval '6 hours');

-- CLEANUP (run after the import):
-- drop table public.vendor_import_staging; drop function public.import_token_ok(text); drop schema private cascade;
