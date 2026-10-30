-- Fixes from Supabase's security advisor (Oct 30).

-- 1. Pin search_path on helper/trigger functions.
alter function km_between(float8, float8, float8, float8) set search_path = public;
alter function touch_updated_at() set search_path = public;
alter function slugify(text) set search_path = public;
alter function lock_category_slug() set search_path = public;
alter function protect_category_delete() set search_path = public;

-- 2. Trigger and internal helper functions are not part of the public API.
--    (Supabase grants EXECUTE on new functions by default; take it back.)
revoke execute on function enforce_photo_limit(), guard_vendor_admin_columns()
  from public, anon, authenticated;

-- 3. The vendor plan/status guard only applies to signed-in website users.
create or replace function guard_vendor_admin_columns() returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated' and not is_admin() and (new.status is distinct from old.status or new.plan is distinct from old.plan
      or new.plan_renews_at is distinct from old.plan_renews_at or new.owner_id is distinct from old.owner_id) then
    raise exception 'permission denied for column' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function guard_vendor_admin_columns() from public, anon, authenticated;
