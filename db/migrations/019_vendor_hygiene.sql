-- Hide imported listings that are clearly not wedding businesses (nail and brow bars in
-- Hair & makeup, real-estate photographers, school auditoriums, bounce houses, taxis...).
-- Nothing is deleted: the row stays, status becomes 'hidden' and hidden_reason says why,
-- so an admin can bring any of them back (status 'unclaimed' + hidden_reason null).
-- Only imported, unclaimed listings are touched; claimed vendors and anything with a
-- wedding/bridal word in its name are never hidden by these rules.

alter table vendors add column if not exists hidden_reason text;

create or replace function vendor_misfit_reason(p_name text, p_cat text) returns text
language sql immutable set search_path = public as $$
  with n as (select lower(coalesce(p_name, '')) s)
  select case
    when s ~ '\m(wedding|weddings|bridal|bride|brides|wed|marry|matrimony)\M' then null
    when s ~ '\m(insurance|attorney|law firm|realty|real estate|self storage|apartments|dental|dentist|hospital|elementary school|high school|middle school)\M'
      then 'Not a wedding business'
    when p_cat in ('photographers', 'videographers', 'djs-bands', 'caterers') and s ~ '\m(university|college|school)\M'
      then 'A school or university, not a wedding vendor'
    when p_cat = 'hair-makeup' and (s ~ '(permanent makeup|permanent make up|microblad|tattoo)'
         or (s ~ '(\mbrows?\M|\mlash|\mnails?\M|\mskin|esthetic|aesthetic|\mmed ?spa\M|\mwax|barber|\macademy\M|\mschool\M)'
             and s !~ '(makeup|make up|\mmua\M|\mhair)'))
      then 'Beauty service other than wedding hair & makeup'
    when p_cat = 'photographers' and s ~ '(\mdrone|\maerial|headshot|boudoir|prolab|\mlab\M|imaging|\mprints?\M)'
      then 'Photography other than weddings'
    when p_cat = 'videographers' and s ~ '(festival|\macademy\M|\mdrone)'
      then 'Video business other than weddings'
    when p_cat = 'djs-bands' and (s ~ '(\macademy\M|center for|lessons|association|conservatory)'
         or (s ~ 'karaoke' and s !~ '(\mdj|disc jockey|\mband\M)'))
      then 'Music school or organisation, not a wedding DJ or band'
    when p_cat = 'wedding-venues' and s ~ '(auditorium|meeting rooms?\M|coworking|co-working|\moffices\M|executive suites)'
      then 'Not a wedding venue'
    when p_cat = 'caterers' and s ~ '(\mpizza|\mdeli\M|grocery|meal prep|\mmarket\M)' and s !~ 'cater'
      then 'Restaurant or shop, not a wedding caterer'
    when p_cat = 'florists' and s ~ '(nursery|garden cent|landscap|\mlawn)' and s !~ '(florist|flower|floral)'
      then 'Garden or landscaping business, not a wedding florist'
    when p_cat = 'wedding-cakes' and (s ~ '(funnel|insomnia cookies|crumbl)'
         or (s ~ '(donut|doughnut|chimney)' and s !~ '\mcakes?\M'))
      then 'Dessert shop that doesn''t make wedding cakes'
    when p_cat = 'rentals' and s ~ '(bounce|bouncy|\mjumps?\M|jumpers|moonwalk|inflatable|\mkids?\M)'
         and s !~ '(tent|linen|chair|table|event rental)'
      then 'Kids'' party rentals, not wedding rentals'
    when p_cat = 'transportation' and s ~ '(\mtaxi|\mcab\M|towing|\mmoving\M|movers|medical transport|courier|freight|trucking)'
         and s !~ '(limo|chauffeur|party bus|coach|sedan)'
      then 'Taxi or transport service, not wedding transportation'
    when p_cat = 'invitations' and s ~ '(newspaper|packaging)'
      then 'Printer, not a wedding stationer'
  end from n
$$;

-- Un-hiding a listing clears its reason; future imports get the same check.
create or replace function vendors_hygiene_trg() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'hidden' then
    new.hidden_reason := null;
  elsif tg_op = 'INSERT' or old.status <> 'hidden' then
    new.hidden_reason := coalesce(new.hidden_reason, 'Hidden by an admin');
  end if;
  if tg_op = 'INSERT' and new.status = 'unclaimed' and new.owner_id is null and new.source = 'overture' then
    new.hidden_reason := vendor_misfit_reason(new.name, (select slug from categories where id = new.category_id));
    if new.hidden_reason is not null then new.status := 'hidden'; end if;
  end if;
  return new;
end $$;
drop trigger if exists vendors_hygiene on vendors;
create trigger vendors_hygiene before insert or update of status, hidden_reason on vendors
  for each row execute function vendors_hygiene_trg();

-- Apply to imported, unclaimed listings.
update vendors v set status = 'hidden', hidden_reason = r.reason, updated_at = now()
from (select v2.id, vendor_misfit_reason(v2.name, c.slug) reason
      from vendors v2 join categories c on c.id = v2.category_id
      where v2.status = 'unclaimed' and v2.owner_id is null and v2.plan = 'free') r
where v.id = r.id and r.reason is not null;
