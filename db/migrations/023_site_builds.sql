-- Publish blog posts without waiting for the nightly site build.
-- Publishing, editing, unpublishing or deleting a live post (and a scheduled post reaching
-- its time) queues a site rebuild. Once a minute pg_cron sends one queued request to GitHub
-- ("Build and deploy" workflow), so several quick saves become one rebuild. The new pages are
-- live about 15 minutes later; until then the post already opens via /blog-post/?p=<slug>.
--
-- Needs a GitHub token with "Actions: Read and write" on the site repository, stored once in
-- Supabase Vault (Project Settings > Vault, or the SQL editor), never in chat or code:
--   select vault.create_secret('github_pat_…', 'github_deploy_token');
-- Without it, requests wait in the queue and the nightly build still publishes everything.

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
end $$;

insert into settings (key, value) values ('github_repo', '"madhavrdy/bloomvow"') on conflict (key) do nothing;

create table if not exists site_builds (
  id            bigint generated always as identity primary key,
  reason        text not null,
  requested_at  timestamptz not null default now(),
  sent_at       timestamptz,
  request_id    bigint,
  result        text                     -- 'ok', an error, or null while waiting
);
create index if not exists site_builds_pending on site_builds (requested_at) where sent_at is null;
alter table site_builds enable row level security;
create policy site_builds_editor_read on site_builds for select to authenticated using (is_editor());

create or replace function github_deploy_token() returns text
language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'github_deploy_token' limit 1$q$ into k;
  end if;
  return coalesce(k, nullif(current_setting('bloomvow.test_github_token', true), ''));
end $$;

create or replace function github_dispatch_post(token text) returns bigint
language plpgsql security definer set search_path = public as $$
declare rid bigint; repo text := (select value #>> '{}' from settings where key = 'github_repo');
begin
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into rid using format('https://api.github.com/repos/%s/actions/workflows/deploy.yml/dispatches', repo),
    '{"ref":"main"}'::jsonb,
    jsonb_build_object('Authorization', 'Bearer ' || token, 'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'celebrateio-site-builder', 'Content-Type', 'application/json');
  return rid;
end $$;

-- Queue a rebuild (one waiting request is enough).
create or replace function queue_site_build(p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from site_builds where sent_at is null) then
    insert into site_builds (reason) values (left(p_reason, 200));
  end if;
end $$;

create or replace function posts_queue_build() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was_live boolean := tg_op <> 'INSERT' and old.status in ('published', 'scheduled') and old.published_at <= now();
  is_live  boolean := tg_op <> 'DELETE' and new.status in ('published', 'scheduled') and new.published_at <= now();
begin
  if was_live or is_live then
    perform queue_site_build(format('post %s: %s', lower(tg_op), coalesce(case when tg_op = 'DELETE' then old.slug else new.slug end, '')));
  end if;
  return null;
end $$;
drop trigger if exists posts_site_build on posts;
create trigger posts_site_build after insert or update or delete on posts
  for each row execute function posts_queue_build();

-- Once a minute (pg_cron): settle the last request, queue scheduled posts whose time has come,
-- then send one waiting request.
create or replace function send_site_build() returns text
language plpgsql security definer set search_path = public as $$
declare b site_builds; last_sent timestamptz; tok text; st int; content text; failed text;
begin
  for b in select * from site_builds where sent_at is not null and result is null and request_id is not null loop
    begin
      execute 'select status_code, content, error_msg from net._http_response where id = $1' into st, content, failed using b.request_id;
    exception when others then st := null; failed := null;
    end;
    if st is not null or failed is not null then
      update site_builds set result = case when st between 200 and 299 then 'ok' else left(coalesce(failed, st::text || ' ' || content), 300) end where id = b.id;
    elsif b.sent_at < now() - interval '10 minutes' then
      update site_builds set result = 'no response' where id = b.id;
    end if;
  end loop;

  select max(sent_at) into last_sent from site_builds where sent_at is not null;
  if exists (select 1 from posts where status in ('published', 'scheduled')
             and published_at <= now() and published_at > coalesce(last_sent, now() - interval '1 day')
             and published_at > now() - interval '1 day') then
    perform queue_site_build('scheduled post went live');
  end if;

  select * into b from site_builds where sent_at is null order by requested_at limit 1;
  if b.id is null then return 'nothing queued'; end if;
  tok := github_deploy_token();
  if tok is null then return 'waiting: no github_deploy_token in Vault'; end if;
  update site_builds set sent_at = now(), request_id = github_dispatch_post(tok) where id = b.id;
  return 'sent';
end $$;

-- For the admin: is auto-publishing set up, and what happened last.
create or replace function site_build_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_editor() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'ready', github_deploy_token() is not null,
    'waiting_since', (select min(requested_at) from site_builds where sent_at is null),
    'last', (select jsonb_build_object('sent_at', sent_at, 'result', result) from site_builds where sent_at is not null order by sent_at desc limit 1));
end $$;

-- "Update the site now" button.
create or replace function request_site_build() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_editor() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform queue_site_build('requested from admin');
  return site_build_status();
end $$;

revoke execute on function github_deploy_token(), github_dispatch_post(text), queue_site_build(text), posts_queue_build(), send_site_build()
  from public, anon, authenticated;
revoke execute on function site_build_status(), request_site_build() from public, anon;
grant execute on function site_build_status(), request_site_build() to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('site-build', '* * * * *', 'select public.send_site_build()');
  end if;
end $$;
