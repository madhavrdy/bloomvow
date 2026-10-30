-- Admin features: hideable categories, editor role, page-level admin helpers.

-- Categories can be hidden without deleting them (vendors keep their category).
alter table categories add column if not exists active boolean not null default true;
alter table categories add column if not exists description text;

-- Editors write blog content only. Admins keep everything.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('vendor', 'admin', 'editor', 'couple'));

create or replace function is_editor() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'editor'))
$$;

-- A category's slug is its URL: lock it once any vendor uses it.
create or replace function lock_category_slug() returns trigger language plpgsql as $$
begin
  if new.slug <> old.slug and exists (select 1 from vendors where category_id = old.id) then
    raise exception 'slug_locked' using errcode = 'P0001', hint = 'This category has vendors, so its web address cannot change.';
  end if;
  return new;
end $$;
drop trigger if exists categories_slug_lock on categories;
create trigger categories_slug_lock before update on categories for each row execute function lock_category_slug();

-- Never delete a category that vendors use; hide it instead.
create or replace function protect_category_delete() returns trigger language plpgsql as $$
begin
  if exists (select 1 from vendors where category_id = old.id) then
    raise exception 'category_in_use' using errcode = 'P0001', hint = 'Hide this category instead: vendors still use it.';
  end if;
  return old;
end $$;
drop trigger if exists categories_delete_guard on categories;
create trigger categories_delete_guard before delete on categories for each row execute function protect_category_delete();

-- Hidden categories drop out of lead matching.
create or replace function enforce_active_categories(cats int[]) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from categories where id = any (cats) and not active) then
    raise exception 'invalid_categories' using errcode = '22023';
  end if;
end $$;

-- Admin: change a user's role (vendor / editor / admin) by email.
create or replace function admin_set_role(p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  perform require_admin();
  if p_role not in ('vendor', 'editor', 'admin') then raise exception 'invalid_role' using errcode = '22023'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if uid = auth.uid() and p_role <> 'admin' then raise exception 'cannot_demote_self' using errcode = 'P0001'; end if;
  update profiles set role = p_role where id = uid;
end $$;

-- Admin: mark a lead as spam (its recipients stay recorded).
create or replace function admin_mark_spam(p_lead uuid, p_spam boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update leads set status = case when p_spam then 'spam' else 'routed' end where id = p_lead;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Admin vendor editing: content columns too (admins may fix any listing).
create policy vendor_admin_read_all on vendors for select to authenticated using (is_admin());
grant update (status, plan, plan_renews_at, owner_id) on vendors to authenticated;  -- still gated by RLS (admin policy only)

-- Owners must not change status/plan via the column grant: block it in a trigger.
-- Runs as the caller (security invoker) so internal jobs and admin functions are not blocked;
-- only signed-in website users who are not admins are stopped.
create or replace function guard_vendor_admin_columns() returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated' and not is_admin() and (new.status is distinct from old.status or new.plan is distinct from old.plan
      or new.plan_renews_at is distinct from old.plan_renews_at or new.owner_id is distinct from old.owner_id) then
    raise exception 'permission denied for column' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists vendors_admin_guard on vendors;
create trigger vendors_admin_guard before update on vendors for each row execute function guard_vendor_admin_columns();

revoke execute on function admin_set_role(text, text), admin_mark_spam(uuid, boolean), is_editor() from public, anon;
grant execute on function admin_set_role(text, text), admin_mark_spam(uuid, boolean), is_editor() to authenticated;
