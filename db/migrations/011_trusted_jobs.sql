-- Scheduled jobs (GitHub Actions: vendor import, backups) connect straight to the
-- database as its owner with the secret connection string. Let those sessions use
-- admin functions such as admin_import_vendors. Website visitors never qualify:
-- they arrive through the API as 'authenticator' and always switch role.
create or replace function require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if session_user = 'postgres' and current_setting('role') = 'none' then return; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;
