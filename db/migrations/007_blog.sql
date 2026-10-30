-- Blog: categories, posts, comments with moderation.

create table blog_categories (
  id               serial primary key,
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name             text not null check (length(name) between 2 and 80),
  description      text,
  seo_title        text,
  seo_description  text,
  sort             int not null default 100,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null check (length(title) between 3 and 200),
  excerpt          text check (excerpt is null or length(excerpt) <= 400),
  body             text not null default '',          -- Markdown
  cover_url        text,
  cover_alt        text,
  author_id        uuid references auth.users(id) on delete set null,
  author_name      text,
  category_id      int not null references blog_categories(id),
  status           text not null default 'draft' check (status in ('draft', 'scheduled', 'published')),
  published_at     timestamptz,
  seo_title        text,
  seo_description  text check (seo_description is null or length(seo_description) <= 320),
  city_id          int references cities(id),          -- optional: shows as a "Planning guide" on that city's pages
  vendor_category_id int references categories(id),    -- optional: and/or that vendor category's pages
  comments_open    boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status = 'draft' or published_at is not null)
);
create index posts_live_idx on posts(published_at desc) where status in ('published', 'scheduled');
create index posts_category_idx on posts(category_id);
create trigger posts_touch before update on posts for each row execute function touch_updated_at();

create table comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  parent_id   uuid references comments(id) on delete cascade,
  author_name text not null check (length(author_name) between 1 and 80),
  author_email text not null,
  body        text not null check (length(body) between 2 and 3000),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'spam')),
  is_staff    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index comments_post_idx on comments(post_id, created_at);
create index comments_pending_idx on comments(created_at) where status = 'pending';
create index comments_email_idx on comments(lower(author_email), created_at desc);

-- A post's URL locks once it has been published.
create or replace function lock_post_slug() returns trigger language plpgsql as $$
begin
  if new.slug <> old.slug and old.status = 'published' and old.published_at <= now() then
    raise exception 'slug_locked' using errcode = 'P0001', hint = 'This post is live, so its web address cannot change.';
  end if;
  return new;
end $$;
create trigger posts_slug_lock before update on posts for each row execute function lock_post_slug();

-- A blog category's URL locks once it has a live post.
create or replace function lock_blog_category_slug() returns trigger language plpgsql as $$
begin
  if new.slug <> old.slug and exists (select 1 from posts where category_id = old.id and status = 'published' and published_at <= now()) then
    raise exception 'slug_locked' using errcode = 'P0001', hint = 'This category has live posts, so its web address cannot change.';
  end if;
  return new;
end $$;
create trigger blog_categories_slug_lock before update on blog_categories for each row execute function lock_blog_category_slug();

-- Replies are one level deep and must belong to the same post.
create or replace function check_comment_parent() returns trigger language plpgsql as $$
declare p comments;
begin
  if new.parent_id is null then return new; end if;
  select * into p from comments where id = new.parent_id;
  if p.id is null or p.post_id <> new.post_id then raise exception 'invalid_parent' using errcode = '22023'; end if;
  if p.parent_id is not null then new.parent_id := p.parent_id; end if;   -- flatten to one level
  return new;
end $$;
create trigger comments_parent_check before insert on comments for each row execute function check_comment_parent();

-- ---------------------------------------------------------------- security
alter table blog_categories enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;

create policy bc_read on blog_categories for select using (active or is_editor());
create policy bc_write on blog_categories for all to authenticated using (is_editor()) with check (is_editor());

create policy posts_editor on posts for all to authenticated using (is_editor()) with check (is_editor());
revoke all on posts from anon;

-- Comments: read/write only through views and functions (emails stay private).
revoke all on comments from anon;
create policy comments_admin on comments for all to authenticated using (is_admin()) with check (is_admin());

create or replace view public_blog_categories as
  select id, slug, name, description, seo_title, seo_description, sort from blog_categories where active;

-- "Live" = published, or scheduled with its time reached.
create or replace view public_posts as
  select p.id, p.slug, p.title, p.excerpt, p.body, p.cover_url, p.cover_alt, p.author_name, p.category_id,
         p.published_at, p.updated_at, p.seo_title, p.seo_description, p.city_id, p.vendor_category_id, p.comments_open
  from posts p join blog_categories c on c.id = p.category_id
  where p.status in ('published', 'scheduled') and p.published_at <= now() and c.active;

create or replace view public_comments as
  select c.id, c.post_id, c.parent_id, c.author_name, c.body, c.is_staff, c.created_at
  from comments c join public_posts p on p.id = c.post_id
  where c.status = 'approved';

grant select on public_blog_categories, public_posts, public_comments to anon, authenticated;

-- -------------------------------------------------------- submit_comment
-- Every comment waits for moderation. Spam controls: honeypot, rate limit,
-- link limit, length limits, and a closed-comments switch per post.
create or replace function submit_comment(payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_post   uuid;
  v_parent uuid := nullif(payload->>'parent_id', '')::uuid;
  v_name   text := nullif(trim(payload->>'name'), '');
  v_email  text := lower(trim(coalesce(payload->>'email', '')));
  v_body   text := trim(coalesce(payload->>'body', ''));
  v_status text := 'pending';
  v_id     uuid;
begin
  begin v_post := (payload->>'post_id')::uuid; exception when others then raise exception 'invalid_post' using errcode = '22023'; end;
  if not exists (select 1 from public_posts where id = v_post and comments_open) then
    raise exception 'comments_closed' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 80 then raise exception 'name_required' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'invalid_email' using errcode = '22023'; end if;
  if length(v_body) < 2 or length(v_body) > 3000 then raise exception 'invalid_body' using errcode = '22023'; end if;
  if (select count(*) from regexp_matches(v_body, 'https?://|www\.', 'gi')) > 2 then
    raise exception 'too_many_links' using errcode = '22023';
  end if;
  if (select count(*) from comments where lower(author_email) = v_email and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if coalesce(payload->>'website', '') <> '' then v_status := 'spam'; end if;   -- honeypot

  insert into comments (post_id, parent_id, author_name, author_email, body, status)
  values (v_post, v_parent, v_name, v_email, v_body, v_status) returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

-- ------------------------------------------------------ moderation (admin)
create or replace function admin_moderate_comments(p_ids uuid[], p_status text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_admin();
  if p_status not in ('approved', 'rejected', 'spam', 'pending') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update comments set status = p_status where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- Reply as the site: published immediately, marked as staff.
create or replace function admin_reply_comment(p_parent uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p comments; v_id uuid; em text;
begin
  perform require_admin();
  select * into p from comments where id = p_parent;
  if p.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select email into em from auth.users where id = auth.uid();
  insert into comments (post_id, parent_id, author_name, author_email, body, status, is_staff)
  values (p.post_id, p.id, coalesce((select full_name from profiles where id = auth.uid()), 'Team'), coalesce(em, 'team@local'), trim(p_body), 'approved', true)
  returning id into v_id;
  if p.status = 'pending' then update comments set status = 'approved' where id = p.id; end if;
  return v_id;
end $$;

-- Delete a blog category only once it is empty; optionally move its posts first.
create or replace function editor_delete_blog_category(p_id int, p_move_to int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_editor() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_move_to is not null then
    if p_move_to = p_id or not exists (select 1 from blog_categories where id = p_move_to) then
      raise exception 'invalid_target' using errcode = '22023';
    end if;
    update posts set category_id = p_move_to where category_id = p_id;
  end if;
  if exists (select 1 from posts where category_id = p_id) then
    raise exception 'category_has_posts' using errcode = 'P0001', hint = 'Move its posts to another category first.';
  end if;
  delete from blog_categories where id = p_id;
end $$;

-- Storage for cover images: editors/admins write, everyone reads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-images', 'blog-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "blog images: editors write" on storage.objects for insert to authenticated with check (bucket_id = 'blog-images' and public.is_editor());
create policy "blog images: editors update" on storage.objects for update to authenticated using (bucket_id = 'blog-images' and public.is_editor());
create policy "blog images: editors delete" on storage.objects for delete to authenticated using (bucket_id = 'blog-images' and public.is_editor());
create policy "blog images: public read" on storage.objects for select using (bucket_id = 'blog-images');

-- Seed categories.
insert into blog_categories (slug, name, sort, description) values
  ('planning', 'Planning & checklists', 10, 'Timelines, checklists and first steps for planning your wedding.'),
  ('budget', 'Budget & costs', 20, 'What weddings really cost, city by city, and how to plan your budget.'),
  ('venues', 'Venues', 30, 'How to choose a wedding venue, questions to ask and venue roundups.'),
  ('photo-video', 'Photo & video', 40, 'Choosing a photographer or videographer, shot lists and styles.'),
  ('hair-makeup', 'Hair & makeup', 50, 'Bridal beauty trials, trends and tips.'),
  ('food-cake', 'Food & cake', 60, 'Catering styles, menus and wedding cake ideas.'),
  ('flowers-decor', 'Flowers & decor', 70, 'Florals, themes, decor and rentals.'),
  ('real-weddings', 'Real weddings', 80, 'Real couples, their days and the vendors who made them happen.'),
  ('city-guides', 'City guides', 90, 'Planning a wedding in a specific city: venues, costs and local tips.')
on conflict (slug) do nothing;

revoke execute on function submit_comment(jsonb), admin_moderate_comments(uuid[], text), admin_reply_comment(uuid, text),
  editor_delete_blog_category(int, int) from public, anon;
grant execute on function submit_comment(jsonb) to anon, authenticated;
grant execute on function admin_moderate_comments(uuid[], text), admin_reply_comment(uuid, text), editor_delete_blog_category(int, int) to authenticated;
