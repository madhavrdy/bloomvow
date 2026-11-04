-- Owner's admin login. The site isn't live yet, so the account doesn't exist:
-- this makes the listed email an admin the moment it signs up AND confirms the
-- email address (an unconfirmed sign-up with someone else's email gets nothing).
-- The email lives inside this function, not in the public settings table, so it isn't exposed on the site.

create or replace function grant_bootstrap_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null
     and lower(new.email) = any (array['madhavrdd25@gmail.com']) then
    update profiles set role = 'admin' where id = new.id and role <> 'admin';
  end if;
  return new;
end $$;
revoke execute on function grant_bootstrap_admin() from public, anon, authenticated;

drop trigger if exists zz_grant_bootstrap_admin on auth.users;
create trigger zz_grant_bootstrap_admin after insert or update of email_confirmed_at on auth.users
  for each row execute function grant_bootstrap_admin();
