begin;
alter table public.academy_admins drop constraint if exists academy_admins_role_key;
create unique index if not exists academy_one_super_admin on public.academy_admins(role) where role='super_admin';
create schema if not exists academy_private;
revoke all on schema academy_private from public, anon, authenticated;
create table if not exists academy_private.pending_admins (
  email text primary key,
  role text not null check (role='admin')
);
alter table academy_private.pending_admins enable row level security;
revoke all on academy_private.pending_admins from public, anon, authenticated;

-- Approved emails are provisioned privately by the database owner.
-- auth.identities is maintained by Supabase Auth and cannot be edited by clients.
create or replace function academy_private.assign_verified_google_admin()
returns trigger language plpgsql security definer set search_path='' as $$
declare assigned_role text;
begin
  if new.provider='google' and new.identity_data->>'email_verified'='true' then
    delete from academy_private.pending_admins
      where email=lower(new.identity_data->>'email')
      returning role into assigned_role;
    if assigned_role is not null then
      insert into public.academy_admins(user_id,role) values(new.user_id,assigned_role)
        on conflict(user_id) do nothing;
    end if;
  end if;
  return new;
end $$;
revoke all on function academy_private.assign_verified_google_admin() from public, anon, authenticated;
drop trigger if exists academy_assign_google_admin on auth.identities;
create trigger academy_assign_google_admin after insert or update of identity_data on auth.identities
for each row execute function academy_private.assign_verified_google_admin();

do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
commit;
