-- Row level security. Rule of thumb:
--   * anon (the public site) reads only through the public_* views and
--     writes only through RPC functions (submit_lead, track_event, ...).
--   * vendors (authenticated) see and edit only the listing they own.
--   * admins see everything; privileged changes go through admin_* functions.

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function owns_vendor(v uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from vendors where id = v and owner_id = auth.uid())
$$;

alter table countries        enable row level security;
alter table regions          enable row level security;
alter table cities           enable row level security;
alter table categories       enable row level security;
alter table profiles         enable row level security;
alter table vendors          enable row level security;
alter table vendor_cities    enable row level security;
alter table packages         enable row level security;
alter table photos           enable row level security;
alter table reviews          enable row level security;
alter table leads            enable row level security;
alter table lead_recipients  enable row level security;
alter table claims           enable row level security;
alter table events           enable row level security;
alter table notifications    enable row level security;
alter table settings         enable row level security;

-- Reference data: readable by everyone, writable by admins.
create policy ref_read on countries  for select using (true);
create policy ref_read on regions    for select using (true);
create policy ref_read on cities     for select using (true);
create policy ref_read on categories for select using (true);
create policy ref_read on settings   for select using (true);
create policy ref_admin on countries  for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_admin on regions    for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_admin on cities     for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_admin on categories for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_admin on settings   for all to authenticated using (is_admin()) with check (is_admin());

-- Profiles: you see yourself; admins see all. Role changes only by admin.
create policy profile_self on profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy profile_update_self on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

-- Vendors: the table itself is private (it holds the delivery email);
-- the public site reads public_vendors instead.
revoke all on vendors from anon;
create policy vendor_owner_read on vendors for select to authenticated using (owner_id = auth.uid() or is_admin());
create policy vendor_owner_update on vendors for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy vendor_admin_update on vendors for update to authenticated using (is_admin()) with check (is_admin());
-- Owners may edit their content, not status/plan/owner/rating.
revoke update on vendors from authenticated;
grant update (name, address, zip, phone, website, email, description, price_from, capacity_max, setting, amenities) on vendors to authenticated;
revoke insert, delete on vendors from authenticated;

-- Service-area cities: public read, owner edits (plan limit enforced by trigger).
create policy vc_read on vendor_cities for select using (true);
create policy vc_owner on vendor_cities for all to authenticated using (owns_vendor(vendor_id) or is_admin()) with check (owns_vendor(vendor_id) or is_admin());

create policy pkg_read on packages for select using (true);
create policy pkg_owner on packages for all to authenticated using (owns_vendor(vendor_id) or is_admin()) with check (owns_vendor(vendor_id) or is_admin());

create policy photo_read on photos for select using (true);
create policy photo_owner on photos for all to authenticated using (owns_vendor(vendor_id) or is_admin()) with check (owns_vendor(vendor_id) or is_admin());

-- Reviews: approved ones are public; new ones arrive via submit_review().
revoke all on reviews from anon;
create policy review_vendor_read on reviews for select to authenticated using (owns_vendor(vendor_id) or is_admin());

-- Leads: a vendor sees a lead only if it was routed to their listing.
revoke all on leads, lead_recipients from anon;
create policy lead_read on leads for select to authenticated using (
  is_admin() or exists (
    select 1 from lead_recipients lr join vendors v on v.id = lr.vendor_id
    where lr.lead_id = leads.id and v.owner_id = auth.uid()
  )
);
create policy lr_read on lead_recipients for select to authenticated using (owns_vendor(vendor_id) or is_admin());
revoke insert, update, delete on leads, lead_recipients from authenticated;

-- Claims: create and read your own; admins decide through admin_decide_claim().
revoke all on claims from anon;
create policy claim_read on claims for select to authenticated using (user_id = auth.uid() or is_admin());
create policy claim_insert on claims for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
revoke update, delete on claims from authenticated;

-- Events and notifications: no direct access (functions / service role only).
revoke all on events, notifications from anon, authenticated;
revoke all on events_id_seq, notifications_id_seq from anon, authenticated;

-- ------------------------------------------------------------ public views
-- These run with the view owner's rights, so they expose only the columns
-- listed here and only non-hidden vendors.
create or replace view public_vendors as
  select v.id, v.slug, v.name, v.category_id, v.city_id, v.address, v.zip, v.phone, v.website,
         v.description, v.price_from, v.capacity_max, v.setting, v.amenities,
         v.status, v.plan = 'featured' as featured, v.rating, v.review_count, v.avg_reply_minutes,
         v.updated_at
  from vendors v where v.status <> 'hidden';

create or replace view public_reviews as
  select id, vendor_id, author_name, wedding_date, rating, body, created_at
  from reviews where status = 'approved';

-- Vendor counts per city x category page, including service-area cities.
-- The site build uses this to decide which pages exist and which are noindex.
create or replace view page_counts as
  with links as (
    select id as vendor_id, city_id, category_id from vendors where status <> 'hidden'
    union
    select vc.vendor_id, vc.city_id, v.category_id
    from vendor_cities vc join vendors v on v.id = vc.vendor_id where v.status <> 'hidden'
  )
  select city_id, category_id, count(distinct vendor_id)::int as vendor_count
  from links group by city_id, category_id;

grant select on public_vendors, public_reviews, page_counts to anon, authenticated;
