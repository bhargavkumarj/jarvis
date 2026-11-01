-- Only migration/admin roles manage admission. No arbitrary email is admitted.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'jarvis_auth_guard') then
    create role jarvis_auth_guard nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  -- Roles survive database resets. Reject unsafe existing attributes rather than
  -- using ALTER ROLE NOSUPERUSER, which itself requires a superuser.
  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'jarvis_auth_guard'
      and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) or exists (
    select 1 from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles r on r.oid = m.member where r.rolname = 'jarvis_auth_guard'
  ) then
    raise exception 'Existing jarvis_auth_guard role has unexpected privileges; administrator review required' using errcode = '42501';
  end if;
  -- Ownership transfer requires SET ROLE; no application role receives membership.
  execute pg_catalog.format('grant jarvis_auth_guard to %I with set true', current_user);
  execute pg_catalog.format('grant jarvis_auth_guard to %I with inherit false', current_user);
end $$;
grant usage on schema public, private, auth to jarvis_auth_guard;
-- Temporary prerequisite for function ownership transfer; revoked at the end.
grant create on schema public, private to jarvis_auth_guard;
grant select on auth.users, auth.sessions to jarvis_auth_guard;

create table private.admissions (
  email text primary key check (email = lower(btrim(email)) and length(email) <= 254),
  owner_id uuid unique references auth.users(id) on delete cascade deferrable initially deferred,
  enabled boolean not null default true
);
alter table private.admissions enable row level security;
grant select, update on private.admissions to jarvis_auth_guard;
create policy guard_admission on private.admissions for all to jarvis_auth_guard using (true) with check (true);

create table private.revoked_sessions (
  session_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revoked_at timestamptz not null default now()
);
alter table private.revoked_sessions enable row level security;
grant select, insert on private.revoked_sessions to jarvis_auth_guard;
create policy guard_revocation on private.revoked_sessions for all to jarvis_auth_guard using (true) with check (true);

create function private.has_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    join auth.users u on u.id = s.user_id
    join private.admissions a on a.owner_id = u.id
    where s.id::text = (auth.jwt() ->> 'session_id')
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until < now())
      and a.enabled
      and not exists (select 1 from private.revoked_sessions r where r.session_id = s.id)
  );
$$;
revoke all on function private.has_access() from public;
grant usage on schema private to authenticated;
grant execute on function private.has_access() to authenticated;

create table public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 60 and display_name = btrim(display_name) and display_name !~ '[[:cntrl:]]'),
  assistant_name text not null default 'Assistant' check (length(assistant_name) between 1 and 40 and assistant_name = btrim(assistant_name) and assistant_name !~ '[[:cntrl:]]'),
  tone text not null default 'balanced' check (tone in ('balanced', 'concise', 'warm')),
  timezone text not null default 'UTC',
  locale text not null default 'en-IN' check (locale in ('en-IN', 'en-GB', 'en-US')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, assistant_name, tone, timezone, locale) on public.profiles to authenticated;
grant insert on public.profiles to jarvis_auth_guard;
create policy profile_read on public.profiles for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.has_access()));
create policy profile_update on public.profiles for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.has_access()))
  with check (owner_id = (select auth.uid()) and (select private.has_access()));
-- Creation is exclusively an Auth trigger; deletion is not a user operation in M1.
create policy profile_no_insert on public.profiles for insert to authenticated with check (false);
create policy profile_no_delete on public.profiles for delete to authenticated using (false);
create policy profile_bootstrap on public.profiles for insert to jarvis_auth_guard with check (true);

create function private.validate_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then
    raise exception 'Owner is immutable' using errcode = '42501';
  end if;
  if length(new.timezone) > 100 or
    (new.timezone <> 'UTC' and (position('/' in new.timezone) = 0 or new.timezone like 'posix/%' or new.timezone like 'right/%')) or
    not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Use a supported IANA timezone' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.validate_profile() from public, anon, authenticated;
create trigger validate_profile before insert or update on public.profiles
  for each row execute function private.validate_profile();

create function private.admit_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- UPDATE locks the admission row; concurrent signups cannot claim it twice.
  update private.admissions set owner_id = new.id
    where email = lower(btrim(new.email)) and enabled and owner_id is null;
  if not found then
    raise exception 'Registration unavailable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.admit_user() from public, anon, authenticated;
create trigger admit_user before insert on auth.users for each row execute function private.admit_user();

create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Never trust raw_user_meta_data for ownership or defaults.
  insert into public.profiles(owner_id) values (new.id);
  return new;
end;
$$;
revoke all on function private.create_profile() from public, anon, authenticated;
create trigger create_profile after insert on auth.users for each row execute function private.create_profile();

create function public.revoke_current_session() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_access() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into private.revoked_sessions(session_id, owner_id)
    values ((auth.jwt() ->> 'session_id')::uuid, auth.uid()) on conflict do nothing;
end;
$$;
revoke all on function public.revoke_current_session() from public, anon;
grant execute on function public.revoke_current_session() to authenticated;

revoke all on all tables in schema private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
-- Finish grants while still the function owner, then transfer to the restricted role.
alter function private.has_access() owner to jarvis_auth_guard;
alter function private.admit_user() owner to jarvis_auth_guard;
alter function private.create_profile() owner to jarvis_auth_guard;
alter function public.revoke_current_session() owner to jarvis_auth_guard;
revoke create on schema public, private from jarvis_auth_guard;
