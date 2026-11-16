-- Hardening and speed (from the Supabase security and performance advisors, Nov 2026).
--
-- 1. Internal news functions: only the scheduled job may run them. Signed-in users (vendors) could
--    call news_parse() directly and insert made-up headlines, or news_fetch() to trigger requests.
revoke execute on function news_fetch(int), news_parse(news_targets, text), news_seed_targets() from authenticated;

-- 2. Row-level security: evaluate auth.uid() / is_admin() once per query instead of once per row.
alter policy profile_self on profiles using ((id = (select auth.uid())) or (select is_admin()));
alter policy profile_update_self on profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy vendor_owner_read on vendors using ((owner_id = (select auth.uid())) or (select is_admin()));
alter policy vendor_owner_update on vendors using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy lead_read on leads using ((select is_admin()) or exists (
  select 1 from lead_recipients lr join vendors v on v.id = lr.vendor_id
  where lr.lead_id = leads.id and v.owner_id = (select auth.uid())));
alter policy claim_read on claims using ((user_id = (select auth.uid())) or (select is_admin()));
alter policy claim_insert on claims with check ((user_id = (select auth.uid())) and status = 'pending');

-- 3. Indexes for foreign keys that pages and dashboards look up by.
create index if not exists photos_vendor_idx on photos (vendor_id);
create index if not exists packages_vendor_idx on packages (vendor_id);
create index if not exists comments_parent_idx on comments (parent_id) where parent_id is not null;
create index if not exists posts_city_idx on posts (city_id) where city_id is not null;
create index if not exists posts_vendor_category_idx on posts (vendor_category_id) where vendor_category_id is not null;
create index if not exists posts_author_idx on posts (author_id);
create index if not exists leads_city_idx on leads (city_id);
create index if not exists claims_user_idx on claims (user_id);
create index if not exists news_items_city_idx on news_items (city_id) where city_id is not null;
create index if not exists news_items_category_idx on news_items (category_id) where category_id is not null;

-- 4. Fixed search_path for helper functions that didn't set one.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('ad_placements', 'sponsor_placements', 'robots_ok', 'html_esc', 'email_button',
             'news_settings_ok', 'news_similar', 'news_target_due', 'news_touch')
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;
