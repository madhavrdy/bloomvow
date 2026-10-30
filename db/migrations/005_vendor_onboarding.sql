-- Vendor onboarding and photo storage.

-- A vendor not yet in the directory can add their business. The listing is
-- created hidden, with a pending claim; it goes live when an admin approves
-- the claim (admin_decide_claim sets status = 'claimed').
create or replace function create_listing(
  p_name text, p_category int, p_city int, p_phone text default null, p_website text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  em   text;
  vid  uuid;
  cid  uuid;
  base text;
  s    text;
  k    int := 1;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' or length(trim(p_name)) < 2 or length(p_name) > 120 then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if not exists (select 1 from categories where id = p_category) then raise exception 'invalid_category' using errcode = '22023'; end if;
  if not exists (select 1 from cities where id = p_city) then raise exception 'invalid_city' using errcode = '22023'; end if;
  if (select count(*) from claims c join vendors v on v.id = c.vendor_id
      where c.user_id = auth.uid() and c.status = 'pending' and v.status = 'hidden') >= 3 then
    raise exception 'too_many_pending' using errcode = 'P0001';
  end if;

  select email into em from auth.users where id = auth.uid();
  base := slugify(trim(p_name) || '-' || (select name from cities where id = p_city));
  s := base;
  while exists (select 1 from vendors where slug = s) loop k := k + 1; s := base || '-' || k; end loop;

  insert into vendors (slug, name, category_id, city_id, phone, website, email, status, source)
  values (s, trim(p_name), p_category, p_city, nullif(trim(p_phone), ''), nullif(trim(p_website), ''), em, 'hidden', 'self_signup')
  returning id into vid;
  insert into claims (vendor_id, user_id, email, phone, note)
  values (vid, auth.uid(), em, nullif(trim(p_phone), ''), coalesce(nullif(trim(p_note), ''), 'New business added by owner'))
  returning id into cid;
  return jsonb_build_object('vendor_id', vid, 'claim_id', cid, 'slug', s);
end $$;

-- Owners may have several listings (e.g. photography + video). A pending
-- claimant sees their claimed listing's public fields via public_vendors,
-- and the hidden one they created through this view:
create or replace view my_claims as
  select c.id as claim_id, c.status as claim_status, c.created_at, v.id as vendor_id, v.name, v.slug, v.status as vendor_status,
         v.category_id, v.city_id
  from claims c join vendors v on v.id = c.vendor_id
  where c.user_id = auth.uid();
grant select on my_claims to authenticated;

-- Photo limit per listing.
create or replace function enforce_photo_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from photos where vendor_id = new.vendor_id) >= 30 then
    raise exception 'photo_limit_reached' using errcode = 'P0001', hint = 'Up to 30 photos per listing.';
  end if;
  return new;
end $$;
create trigger photos_limit before insert on photos for each row execute function enforce_photo_limit();

-- Storage: files live at vendor-photos/<vendor_id>/<file>. Anyone can view;
-- only the listing's owner (or an admin) can upload, replace or delete.
create or replace function can_edit_vendor_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then owns_vendor(split_part(p_name, '/', 1)::uuid) or is_admin()
    else is_admin() end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-photos', 'vendor-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "vendor photos: owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor-photos' and public.can_edit_vendor_path(name));
create policy "vendor photos: owners update" on storage.objects for update to authenticated
  using (bucket_id = 'vendor-photos' and public.can_edit_vendor_path(name));
create policy "vendor photos: owners delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vendor-photos' and public.can_edit_vendor_path(name));
create policy "vendor photos: public read" on storage.objects for select
  using (bucket_id = 'vendor-photos');

revoke execute on function create_listing(text, int, int, text, text, text), can_edit_vendor_path(text) from public, anon;
grant execute on function create_listing(text, int, int, text, text, text), can_edit_vendor_path(text) to authenticated;
