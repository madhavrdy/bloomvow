-- Security fix: the public views run with their owner's rights (so they can show public
-- columns without exposing the tables), and Postgres makes simple views writable. With
-- Supabase's default grants that let anyone holding the public key edit or delete vendors
-- (public_vendors), reviews (public_reviews) and blog categories (public_blog_categories).
-- Views are for reading only: every write goes through the tables (row-level security) or
-- the checked functions. Anonymous visitors never write tables directly either (forms use
-- submit_lead / submit_review / submit_comment / track_*), so take those rights away too.

do $$
declare r record;
begin
  for r in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', r.table_name);
  end loop;
  for r in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon', r.table_name);
  end loop;
end $$;

-- Same for anything created later.
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon;

-- The database's own web calls (site rebuilds) run from the scheduled job only.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    execute 'revoke execute on all functions in schema net from anon, authenticated, public';
    execute 'revoke usage on schema net from anon, authenticated';
  end if;
end $$;
