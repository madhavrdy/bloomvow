-- Category images (Admin > Cities & categories). Empty = the built-in illustration.
-- Only https (or site-relative) images; plain http is allowed for local development only.
alter table categories add column if not exists image_url text;
alter table categories add column if not exists image_alt text check (image_alt is null or length(image_alt) <= 200);
alter table categories drop constraint if exists categories_image_url_check;
alter table categories add constraint categories_image_url_check
  check (image_url is null or image_url ~ '^(https://|/[^/]|http://(localhost|127\.0\.0\.1)[:/])');
