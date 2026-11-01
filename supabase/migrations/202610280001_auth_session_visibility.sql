-- Auth's managed tables have RLS with no guard policy. SELECT grants alone
-- cannot expose rows to the non-bypass guard. Keep that role restricted and
-- expose only a caller-bound boolean through a fixed privileged function.
do $$ begin
  if current_user <> 'postgres' or not exists (
    select 1 from pg_catalog.pg_roles where rolname = current_user and (rolbypassrls or rolsuper)
  ) then
    raise exception 'Run this migration as the local postgres migration role with existing Auth RLS access';
  end if;
end $$;

create or replace function private.auth_session_is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.id::text = (auth.jwt() ->> 'session_id')
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until < now())
  );
$$;
revoke all on function private.auth_session_is_active() from public, anon, authenticated, service_role, authenticator;
grant execute on function private.auth_session_is_active() to jarvis_auth_guard;

-- The migration executor has SET membership from the foundation migration.
-- Temporarily allow replacement as the existing function owner, not as admin.
grant usage, create on schema public, private to jarvis_auth_guard;
set local role jarvis_auth_guard;
create or replace function private.has_access() returns boolean
language sql stable security definer set search_path = '' as $$
  -- PostgREST supplies these transaction-local claims after verifying the JWT.
  -- Do not depend on auth-schema USAGE for this non-inheriting role. NULLIF
  -- handles the empty setting that PostgreSQL can leave after a transaction.
  select private.auth_session_is_active()
    and exists (
      select 1 from private.admissions a
      where a.owner_id::text = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub') and a.enabled
    )
    and not exists (
      select 1 from private.revoked_sessions r
      where r.session_id::text = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')
    );
$$;

create or replace function public.revoke_current_session() returns void
language plpgsql security definer set search_path = '' as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if not private.has_access() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into private.revoked_sessions(session_id, owner_id)
    values ((claims ->> 'session_id')::uuid, (claims ->> 'sub')::uuid) on conflict do nothing;
end;
$$;
reset role;
revoke create on schema public, private from jarvis_auth_guard;
revoke select on auth.users, auth.sessions from jarvis_auth_guard;
