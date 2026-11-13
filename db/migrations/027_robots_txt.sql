-- Editable robots.txt (Admin > SEO files). Stored as text in settings; an empty string means
-- "use the built-in default". Only robots.txt directives, comments and blank lines are
-- accepted (same rules as robotsErrors in web/src/lib/robots.ts), up to 10,000 characters.
-- The site publishes it at the next site update.
create or replace function robots_ok(v jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(v) = 'string'
    and length(v #>> '{}') <= 10000
    and not exists (
      select 1 from regexp_split_to_table(v #>> '{}', '\n') raw
      where btrim(raw, E' \t\r') <> '' and btrim(raw, E' \t\r') !~ '^#'
        and (btrim(raw, E' \t\r') !~* '^(user-agent|allow|disallow|sitemap|crawl-delay|host|clean-param)\s*:\s*[^\s<>"]*(\s+[^\s<>"]+)?$'
             or (btrim(raw, E' \t\r') ~* '^sitemap\s*:' and btrim(raw, E' \t\r') !~* '^sitemap\s*:\s*https?://\S+$'))
    )
$$;
alter table settings drop constraint if exists settings_robots_check;
alter table settings add constraint settings_robots_check check (key <> 'robots_txt' or robots_ok(value));
insert into settings (key, value) values ('robots_txt', '""') on conflict (key) do nothing;
