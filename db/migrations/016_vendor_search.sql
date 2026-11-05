-- Header search: fast "type a vendor's name" lookup.
create extension if not exists pg_trgm with schema extensions;
create index if not exists vendors_name_trgm_idx on vendors using gin (lower(name) extensions.gin_trgm_ops) where status <> 'hidden';

create or replace function search_vendor_names(p_q text, p_limit int default 8) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  q text := lower(trim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g')));
  pat text;
  res jsonb;
begin
  if length(q) < 2 or length(q) > 60 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'city', x.city, 'st', x.st, 'cat', x.cat) order by x.rk), '[]'::jsonb)
  into res from (
    select v.slug, v.name, c.name as city, upper(r.code) as st, k.singular as cat,
           row_number() over (order by (lower(v.name) like q || '%') desc, similarity(lower(v.name), q) desc,
             (v.plan = 'featured') desc, coalesce(v.review_count, 0) desc, v.slug) as rk
    from vendors v join cities c on c.id = v.city_id join regions r on r.id = c.region_id join categories k on k.id = v.category_id
    where v.status <> 'hidden' and lower(v.name) like pat
      and not exists (select 1 from country_hidden_categories h where h.country_code = r.country_code and h.category_id = v.category_id)
    order by rk limit least(30, greatest(1, p_limit))
  ) x;
  return res;
end $$;
grant execute on function search_vendor_names(text, int) to anon, authenticated;
