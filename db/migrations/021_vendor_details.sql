-- Structured vendor details (amenities, services, styles, policies, languages...).
-- The options per category are defined in web/src/lib/details.ts; the database checks the
-- shape and size so nothing odd can be stored: an object of up to 60 keys, each a list of
-- up to 60 short labels, a short label, or a positive number.
-- Claimed vendors edit their own (existing owner policy); admins edit any (admin policy).

alter table vendors add column if not exists details jsonb not null default '{}';

create or replace function vendor_details_ok(d jsonb) returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(d) = 'object'
    and (select count(*) from jsonb_object_keys(d)) <= 60
    and not exists (
      select 1 from jsonb_each(d) e
      where e.key !~ '^[a-z][a-z_]{0,39}$'
         or case jsonb_typeof(e.value)
              when 'array' then jsonb_array_length(e.value) > 60
                or exists (select 1 from jsonb_array_elements(e.value) x
                           where jsonb_typeof(x) <> 'string' or length(x #>> '{}') not between 1 and 80)
              when 'string' then length(e.value #>> '{}') not between 1 and 80
              when 'number' then (e.value::numeric) <= 0 or (e.value::numeric) > 10000000
              else true
            end)
$$;

alter table vendors drop constraint if exists vendors_details_check;
alter table vendors add constraint vendors_details_check check (vendor_details_ok(details));

grant update (details) on vendors to authenticated;   -- still limited by RLS: owner or admin

create or replace view public_vendors as
  select v.id, v.slug, v.name, v.category_id, v.city_id, v.address, v.zip, v.phone, v.website,
         v.description, v.price_from, v.capacity_max, v.setting, v.amenities,
         v.status, v.plan = 'featured' as featured, v.rating, v.review_count, v.avg_reply_minutes,
         v.updated_at, v.details
  from vendors v where v.status <> 'hidden';

-- New self-signup listings start hidden until their claim is approved; don't label those
-- "Hidden by an admin" (only label hides that happen later, on update).
create or replace function vendors_hygiene_trg() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'hidden' then
    new.hidden_reason := null;
  elsif tg_op = 'UPDATE' and old.status <> 'hidden' then
    new.hidden_reason := coalesce(new.hidden_reason, 'Hidden by an admin');
  end if;
  if tg_op = 'INSERT' and new.status = 'unclaimed' and new.owner_id is null and new.source = 'overture' then
    new.hidden_reason := vendor_misfit_reason(new.name, (select slug from categories where id = new.category_id));
    if new.hidden_reason is not null then new.status := 'hidden'; end if;
  end if;
  return new;
end $$;
