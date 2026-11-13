-- Review spam limits (security audit, low): reviews are moderated, but nothing stopped a
-- script from filling the moderation queue.
--  * one review per email per vendor (a rejected one can be rewritten)
--  * 3 reviews per email per day
--  * 20 waiting reviews per vendor per day (a flood aimed at one vendor)
--  * a valid email is required, and name/body are checked here too, not only in the browser
create or replace function submit_review(p_vendor uuid, p_name text, p_email text, p_wedding_date date, p_rating int, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; v_email text := lower(btrim(coalesce(p_email, ''))); v_name text := btrim(coalesce(p_name, ''));
begin
  if not exists (select 1 from vendors where id = p_vendor and status <> 'hidden') then
    raise exception 'invalid_vendor' using errcode = '22023';
  end if;
  if length(v_name) not between 2 and 80 then raise exception 'name_required' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 20 and 4000 then raise exception 'invalid_review' using errcode = '22023'; end if;
  if exists (select 1 from reviews where vendor_id = p_vendor and author_email = v_email and status <> 'rejected') then
    raise exception 'already_reviewed' using errcode = 'P0001';
  end if;
  if (select count(*) from reviews where author_email = v_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from reviews where vendor_id = p_vendor and status = 'pending' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into reviews (vendor_id, author_name, author_email, wedding_date, rating, body)
  values (p_vendor, v_name, v_email, p_wedding_date, p_rating, btrim(p_body))
  returning id into rid;
  return rid;
end $$;
create index if not exists reviews_email_idx on reviews (author_email, created_at);
create index if not exists reviews_vendor_created_idx on reviews (vendor_id, created_at);
