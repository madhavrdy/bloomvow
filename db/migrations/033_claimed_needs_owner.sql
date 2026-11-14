-- Fix: setting a listing to "Claimed" in Admin > Vendors didn't approve the waiting claim, so
-- the listing showed as claimed on the site while the vendor's dashboard still said "awaiting
-- approval" (the dashboard follows the owner, which only claim approval sets).
-- Now "Claimed" approves the claim when exactly one is waiting; with several waiting the admin
-- picks one under Claims; with none it is refused (a claimed listing needs an owner).
create or replace function admin_set_vendor(p_vendor uuid, p_status text default null, p_plan text default null, p_renews date default null) returns vendors
language plpgsql security definer set search_path = public as $$
declare v vendors; n int; cid uuid;
begin
  perform require_admin();
  select * into v from vendors where id = p_vendor;
  if v.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status = 'claimed' and v.owner_id is null then
    select count(*), min(id::text)::uuid into n, cid from claims where vendor_id = p_vendor and status = 'pending';
    if n = 0 then raise exception 'claim_needs_owner' using errcode = 'P0001'; end if;
    if n > 1 then raise exception 'choose_claim' using errcode = 'P0001'; end if;
    perform admin_decide_claim(cid, true);
  end if;
  update vendors set
    status = coalesce(p_status, status),
    plan = coalesce(p_plan, plan),
    plan_renews_at = case when p_plan = 'free' then null else coalesce(p_renews, plan_renews_at) end
  where id = p_vendor returning * into v;
  return v;
end $$;

-- Repair listings already set to "Claimed" that way: approve their one waiting claim.
do $$
declare r record;
begin
  for r in select v.id, (select min(c.id::text)::uuid from claims c where c.vendor_id = v.id and c.status = 'pending') as cid
           from vendors v where v.status = 'claimed' and v.owner_id is null
             and (select count(*) from claims c where c.vendor_id = v.id and c.status = 'pending') = 1 loop
    update claims set status = 'approved', decided_at = now() where id = r.cid;
    update vendors v set owner_id = c.user_id, email = coalesce(v.email, c.email) from claims c where c.id = r.cid and v.id = r.id;
    insert into notifications (kind, to_email, payload)
    select 'claim_decided', c.email, jsonb_build_object('vendor_id', c.vendor_id, 'approved', true) from claims c where c.id = r.cid;
  end loop;
end $$;
