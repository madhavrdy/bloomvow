-- Turn a vendor category off in one country only (e.g. "Officiants" in India),
-- without affecting other countries. A row here = hidden in that country.
create table country_hidden_categories (
  country_code text not null references countries(code) on delete cascade,
  category_id  int  not null references categories(id) on delete cascade,
  primary key (country_code, category_id)
);
alter table country_hidden_categories enable row level security;
create policy chc_read on country_hidden_categories for select using (true);
create policy chc_admin on country_hidden_categories for all to authenticated using (is_admin()) with check (is_admin());

-- Leads can't request a category that is hidden globally or in the lead's country.
create or replace function enforce_active_categories(cats int[], p_city int default null) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from categories where id = any (cats) and not active) then
    raise exception 'invalid_categories' using errcode = '22023';
  end if;
  if p_city is not null and exists (
    select 1 from country_hidden_categories h
    join regions r on r.country_code = h.country_code
    join cities c on c.region_id = r.id
    where c.id = p_city and h.category_id = any (cats)) then
    raise exception 'category_unavailable' using errcode = '22023';
  end if;
end $$;
revoke execute on function enforce_active_categories(int[], int) from public, anon, authenticated;
