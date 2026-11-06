-- Tracking & analytics IDs (Admin > Tracking). Only IDs are stored, never raw code,
-- and each one must match its tool's format, so nothing else can be put on the site.
create or replace function tracking_ok(v jsonb) returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(v) = 'object'
    and not exists (select 1 from jsonb_object_keys(v) k
      where k not in ('ga4', 'gtm', 'google_ads', 'google_ads_lead_label', 'meta_pixel', 'gsc', 'bing'))
    and coalesce(v->>'ga4', 'G-OKOK') ~ '^G-[A-Z0-9]{4,16}$'
    and coalesce(v->>'gtm', 'GTM-OKOK') ~ '^GTM-[A-Z0-9]{4,12}$'
    and coalesce(v->>'google_ads', 'AW-1') ~ '^AW-[0-9]{1,15}$'
    and coalesce(v->>'google_ads_lead_label', 'ok_label') ~ '^[A-Za-z0-9_-]{4,64}$'
    and coalesce(v->>'meta_pixel', '1') ~ '^[0-9]{1,20}$'
    and coalesce(v->>'gsc', 'ok_token') ~ '^[A-Za-z0-9_-]{8,100}$'
    and coalesce(v->>'bing', 'ABCDEF12') ~ '^[A-Fa-f0-9]{8,64}$'
$$;
alter table settings drop constraint if exists settings_tracking_check;
alter table settings add constraint settings_tracking_check check (key <> 'tracking' or tracking_ok(value));
insert into settings (key, value) values ('tracking', '{}') on conflict (key) do nothing;
