-- Quote requests must include a phone number (vendors reach couples faster by phone), and a
-- wedding date, when given, must be from today up to 5 years ahead. Runs after leads_phone
-- (alphabetical trigger order), so blanks are already null and numbers already tidy.
-- Only new requests are checked; older ones without a phone are left as they are.
create or replace function lead_required_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.phone is null then
    raise exception 'phone_required' using errcode = '22023';
  end if;
  if new.wedding_date is not null
     and (new.wedding_date < current_date - 1 or new.wedding_date > current_date + interval '5 years') then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists leads_required on leads;
create trigger leads_required before insert on leads
  for each row execute function lead_required_fields();
