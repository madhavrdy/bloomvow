-- Second clean-up pass for the wedding-venues category (casting studios, trampoline parks,
-- storage units, gyms, escape rooms, motels...) plus listings marked closed in any category.
-- Same approach as 019: nothing is deleted, hidden_reason says why, admins can restore.
create or replace function vendor_misfit_reason(p_name text, p_cat text) returns text
language sql immutable set search_path = public as $$
  with n as (select lower(coalesce(p_name, '')) s)
  select case
    when s ~ '(\mclosed\M|permanently closed|out of business)' then 'Listed as closed'
    when p_cat = 'wedding-venues' and s ~ 'bridal (shop|boutique|salon)' then 'Bridal shop, not a venue'
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
    when p_cat = 'wedding-venues' and s ~ '(\mstorage\M|casting|talent|modeling|\mmodels\M|exhibits?\M|exposition|trade show|backdrop|drapery|scenery|seating company|\mtickets?\M|currency|home care|repair|insurance|staffing|web agency|technology|recording studio)'
      then 'A business service, not a wedding venue'
    when p_cat = 'wedding-venues' and s ~ '(playground|trampoline|indoor play|play cent|fun cent|fun zone|family fun|\mkids?\M|children''?s|escape room|\maxes?\M|axe throwing|bowling|bowlero|arcade|raceway|laser tag|paintball|go ?karts?|game night|activate games)'
      then 'Kids'' play or games centre, not a wedding venue'
    when p_cat = 'wedding-venues' and s ~ '(\mgym\M|fitness|crossfit|\mdojo\M|jujutsu|jiu.?jitsu|karate|martial|zumba|\myoga\M|pilates|dance studio|\mcheer\M)'
      then 'Gym or fitness studio, not a wedding venue'
    when p_cat = 'wedding-venues' and s ~ '(learning cent|\mtutor|\msylvan\M|\macademy\M|\mschools?\M)' and s !~ '(museum|sciences|of music|of art|ballroom|\mhall\M|event)'
      then 'School or learning centre, not a wedding venue'
    when p_cat = 'wedding-venues' and s ~ '(\msoccer\M|baseball|little league|virtual sports)'
      then 'Sports club, not a wedding venue'
    when p_cat = 'wedding-venues' and s ~ '\mmotel\M'
      then 'Motel, not a wedding venue'
    when p_cat = 'wedding-venues' and s ~ 'photograph' and s !~ '(venue|event|hall|loft|gallery|estate|garden|barn|ranch|manor)'
      then 'Photographer, not a wedding venue'
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


update vendors v set status = 'hidden', hidden_reason = r.reason, updated_at = now()
from (select v2.id, vendor_misfit_reason(v2.name, c.slug) reason
      from vendors v2 join categories c on c.id = v2.category_id
      where v2.status = 'unclaimed' and v2.owner_id is null and v2.plan = 'free') r
where v.id = r.id and r.reason is not null;

drop function if exists vendor_misfit_reason_preview(text, text);
