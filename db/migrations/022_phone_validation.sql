-- Phone numbers: one rule for every form (the site's normalizePhone in web/src/lib/phone.ts
-- is the same rule).
-- Accepted: US/Canada numbers with 10 digits (leading 1 or +1 fine) in any common layout, or
-- an international number written with + and its country code (8 to 15 digits). An extension
-- may follow ("x12", "ext. 12"). Stored as +12124230172 (US/Canada) or as typed with spaces
-- tidied (+44 20 7123 4567); an extension as ";ext=12".
-- leads and claims: an unusable number is refused with 'invalid_phone'.
-- vendors: refused when an owner or admin changes the phone, or adds a new business; imported numbers that don't fit the
-- rule are kept as they were (they came from public listings) but valid ones are tidied.
-- The admin CSV import is lenient the same way, so one messy number never stops an import.

create or replace function normalize_phone(raw text) returns text
language plpgsql immutable set search_path = public as $$
declare
  s text := btrim(coalesce(raw, ''));
  m text[]; main text; ext text := ''; d text; n text;
begin
  if s = '' then return null; end if;
  m := regexp_match(s, '^(.*?)(?:\s*(?:ext\.?|extension|x|#)\s*(\d{1,6}))?$', 'i');
  main := btrim(m[1]);
  if m[2] is not null then ext := ';ext=' || m[2]; end if;
  if main !~ '^\+?[0-9\s().\-/]+$' then return null; end if;
  d := regexp_replace(main, '\D', '', 'g');
  if left(main, 1) = '+' and left(d, 1) <> '1' then
    return case when length(d) between 8 and 15 then regexp_replace(main, '\s+', ' ', 'g') || ext end;
  end if;
  n := case when length(d) = 11 and left(d, 1) = '1' then substr(d, 2) else d end;
  if n !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' or n ~ '^([0-9])\1{9}$' or n ~ '^[0-9]{3}55501[0-9]{2}$' then
    return null;
  end if;
  return '+1' || n || ext;
end $$;

create or replace function phone_guard() returns trigger
language plpgsql set search_path = public as $$
declare v text; lenient boolean := false;
begin
  if nullif(btrim(coalesce(new.phone, '')), '') is null then new.phone := null; return new; end if;
  v := normalize_phone(new.phone);
  if tg_table_name = 'vendors' then
    if current_setting('app.phone_lenient', true) = 'on' then
      lenient := true;                                   -- admin CSV import (see below)
    elsif tg_op = 'UPDATE' then
      if new.phone is not distinct from old.phone then lenient := true; end if;
    elsif to_jsonb(new)->>'source' is distinct from 'self_signup' then
      lenient := true;
    end if;
    if lenient then
      new.phone := coalesce(v, btrim(new.phone));        -- imports and untouched numbers
      return new;
    end if;
  end if;
  if v is null then raise exception 'invalid_phone' using errcode = '22023'; end if;
  new.phone := v;
  return new;
end $$;

drop trigger if exists leads_phone on leads;
create trigger leads_phone before insert or update of phone on leads
  for each row execute function phone_guard();
drop trigger if exists claims_phone on claims;
create trigger claims_phone before insert or update of phone on claims
  for each row execute function phone_guard();
drop trigger if exists vendors_phone on vendors;
create trigger vendors_phone before insert or update of phone on vendors
  for each row execute function phone_guard();

alter function admin_import_vendors(jsonb, text, boolean) set app.phone_lenient = 'on';
