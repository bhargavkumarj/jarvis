-- Computer control v1: paired Mac devices, one-use command tickets and receipts.
-- Additive; depends on the whole chain through 202610310005. No earlier migration
-- is edited. Device credentials authenticate ONLY device RPCs for their own
-- device/commands; they never read conversations, memories, tasks or other devices.
-- Protocol: packages/computer-control-contracts (digest/actions mirrored below).

create table public.computer_settings (
 owner_id uuid primary key references public.profiles(owner_id) on delete cascade,
 enabled boolean not null default false,
 consent_version text,
 updated_at timestamptz not null default now(),
 check (not enabled or consent_version='computer-control-2026-11-05-v1')
);
create table public.computer_devices (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 name text not null check (length(name) between 1 and 60 and name=btrim(name) and name !~ '[[:cntrl:]]'),
 extension_id text not null check (extension_id ~ '^[a-p]{32}$'),
 origin text not null check (length(origin) between 1 and 200),
 state text not null default 'active' check (state in ('active','revoked')),
 host_version text check (host_version is null or length(host_version)<=32),
 disabled boolean not null default false,
 enabled_actions text[] not null default '{}' check (enabled_actions <@ array['open_application','open_website','set_volume','open_folder','run_shortcut']),
 volume_auto boolean not null default false,
 catalogue jsonb not null default '[]' check (jsonb_typeof(catalogue)='array' and jsonb_array_length(catalogue)<=100 and octet_length(catalogue::text)<=65536),
 created_at timestamptz not null default now(),
 last_seen_at timestamptz, catalogue_updated_at timestamptz, revoked_at timestamptz,
 unique (id, owner_id)
);
create index computer_devices_owner on public.computer_devices(owner_id, created_at desc);
create table private.computer_credentials (
 device_id uuid primary key references public.computer_devices(id) on delete cascade,
 credential_hash text not null check (credential_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now()
);
create table private.computer_pairings (
 id uuid primary key,
 owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
 extension_id text not null check (extension_id ~ '^[a-p]{32}$'),
 origin text not null check (length(origin) between 1 and 200),
 session_id uuid not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 device_id uuid
);
create index computer_pairings_owner on private.computer_pairings(owner_id, created_at);
create table public.computer_commands (
 id uuid primary key,
 owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 device_id uuid not null,
 request_id uuid not null,
 source text not null check (source in ('text','voice')),
 actions jsonb not null,
 labels jsonb not null default '[]' check (jsonb_typeof(labels)='array' and octet_length(labels::text)<=2048),
 digest text not null check (digest ~ '^[a-f0-9]{64}$'),
 state text not null default 'proposed' check (state in ('proposed','awaiting_confirmation','authorized','running','succeeded','failed','cancelled','expired','outcome_unknown')),
 auto_eligible boolean not null default false,
 created_at timestamptz not null default now(),
 proposal_expires_at timestamptz not null,
 authorized_at timestamptz, ticket_expires_at timestamptz, claimed_at timestamptz, finished_at timestamptz, cancel_requested_at timestamptz,
 results jsonb not null default '[]' check (jsonb_typeof(results)='array' and jsonb_array_length(results)<=5 and octet_length(results::text)<=16384),
 summary text check (summary is null or (length(summary)<=300 and summary !~ '[[:cntrl:]]')),
 unique (owner_id, request_id),
 foreign key (device_id, owner_id) references public.computer_devices(id, owner_id) on delete cascade
);
-- One authorized/running plan per Mac. Proposals awaiting review do not count.
create unique index computer_one_active on public.computer_commands(device_id) where state in ('authorized','running','awaiting_confirmation');
create index computer_commands_owner on public.computer_commands(owner_id, created_at desc);
create table private.computer_tickets (
 command_id uuid primary key references public.computer_commands(id) on delete cascade,
 ticket_hash text not null unique check (ticket_hash ~ '^[a-f0-9]{64}$'),
 session_id uuid not null,
 expires_at timestamptz not null,
 claimed_at timestamptz
);

alter table public.computer_settings enable row level security;
alter table public.computer_devices enable row level security;
alter table public.computer_commands enable row level security;
alter table private.computer_credentials enable row level security;
alter table private.computer_pairings enable row level security;
alter table private.computer_tickets enable row level security;
revoke all on public.computer_settings, public.computer_devices, public.computer_commands from public, anon, authenticated, service_role, jarvis_reminder_worker;
revoke all on private.computer_credentials, private.computer_pairings, private.computer_tickets from public, anon, authenticated, service_role, jarvis_reminder_worker;
-- Ordinary users read their own rows only; every write goes through the RPCs below.
grant select on public.computer_settings, public.computer_commands to authenticated;
grant select (id, owner_id, name, extension_id, origin, state, host_version, disabled, enabled_actions, volume_auto, catalogue, created_at, last_seen_at, catalogue_updated_at, revoked_at) on public.computer_devices to authenticated;
create policy computer_settings_read on public.computer_settings for select to authenticated using (owner_id=(select auth.uid()) and (select private.has_access()));
create policy computer_devices_read on public.computer_devices for select to authenticated using (owner_id=(select auth.uid()) and (select private.has_access()));
create policy computer_commands_read on public.computer_commands for select to authenticated using (owner_id=(select auth.uid()) and (select private.has_access()));
grant select, insert, update, delete on public.computer_settings, public.computer_devices, public.computer_commands to jarvis_auth_guard;
grant select, insert, update, delete on private.computer_credentials, private.computer_pairings, private.computer_tickets to jarvis_auth_guard;
do $$ declare t text; begin
 foreach t in array array['public.computer_settings','public.computer_devices','public.computer_commands','private.computer_credentials','private.computer_pairings','private.computer_tickets'] loop
  execute format('create policy computer_guard on %s to jarvis_auth_guard using (true) with check (true)', t);
 end loop;
end $$;

-- Postgres-owned bridges for the three facts that need managed Auth tables.
-- Same pattern as private.m2b_account_eligible_v1; executable only by the guard.
create function private.computer_account_eligible_v1(p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists (select 1 from auth.users u join private.admissions a on a.owner_id=u.id
   where u.id=p_owner and a.enabled and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<now()))
  and not exists (select 1 from private.privacy_jobs j where j.owner_id=p_owner and j.scope='account');
$$;
create function private.computer_session_live_v1(p_owner uuid, p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists (select 1 from auth.sessions s where s.id=p_session and s.user_id=p_owner and (s.not_after is null or s.not_after>now()))
  and not exists (select 1 from private.revoked_sessions r where r.session_id=p_session);
$$;
create function private.computer_account_label_v1(p_owner uuid) returns text language sql stable security definer set search_path='' as $$
 -- Masked: enough to recognise the account in a native approval, not a full address.
 select left(split_part(u.email,'@',1),1)||'•••@'||split_part(u.email,'@',2) from auth.users u where u.id=p_owner;
$$;
revoke all on function private.computer_account_eligible_v1(uuid), private.computer_session_live_v1(uuid,uuid), private.computer_account_label_v1(uuid) from public, anon, authenticated, service_role, authenticator, jarvis_reminder_worker;
grant execute on function private.computer_account_eligible_v1(uuid), private.computer_session_live_v1(uuid,uuid), private.computer_account_label_v1(uuid) to jarvis_auth_guard;

grant create on schema public, private to jarvis_auth_guard;
set local role jarvis_auth_guard;

-- Mirrors canonicalCommand() in TypeScript and Canonical.swift (fixture-tested).
create function private.computer_digest_v1(p_device uuid, p_command uuid, p_actions jsonb) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to('jarvis-computer-control/v1'||E'\n'||'device:'||p_device::text||E'\n'||'command:'||p_command::text||E'\n'||
  (select string_agg((e.ord-1)::text||':'||(e.a->>'type')||':'||coalesce(e.a->>'alias',e.a->>'percent'),E'\n' order by e.ord) from jsonb_array_elements(p_actions) with ordinality e(a,ord)),'UTF8')),'hex');
$$;
create function private.computer_actions_valid_v1(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p)='array' and jsonb_array_length(p) between 1 and 5 and not exists (
  select 1 from jsonb_array_elements(p) a where not (
   jsonb_typeof(a)='object' and (select count(*) from jsonb_object_keys(a))=2 and (
    (a->>'type' in ('open_application','open_website','open_folder','run_shortcut') and jsonb_typeof(a->'alias')='string' and (a->>'alias') ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$')
    or (a->>'type'='set_volume' and jsonb_typeof(a->'percent')='number' and (a->>'percent') ~ '^([0-9]|[1-9][0-9]|100)$'))));
$$;
create function private.computer_instant_v1(t timestamptz) returns text language sql immutable set search_path='' as $$
 select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;
create function private.computer_kind_v1(p_type text) returns text language sql immutable set search_path='' as $$
 select (case p_type when 'open_application' then 'application' when 'open_website' then 'website' when 'open_folder' then 'folder' when 'run_shortcut' then 'shortcut' end);
$$;
create function private.computer_session_v1() returns uuid language sql stable set search_path='' as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid;
$$;
-- Bounded lazy maintenance. Expiry replaces late execution: an authorized but
-- unclaimed ticket expires; a claimed plan with no report becomes outcome_unknown.
create function private.computer_maintain_v1(p_owner uuid) returns void language plpgsql set search_path='' as $$
begin
 update public.computer_commands set state='expired', finished_at=now(), summary='Review window expired before it was run. Nothing was sent to the Mac.'
  where id in (select id from public.computer_commands where owner_id=p_owner and state='proposed' and proposal_expires_at<now() limit 50);
 update public.computer_commands set state='expired', finished_at=now(), summary='The Mac did not claim this approval within its validity period, so it can no longer run.'
  where id in (select id from public.computer_commands where owner_id=p_owner and state='authorized' and ticket_expires_at<now() limit 50);
 update public.computer_commands set state='outcome_unknown', finished_at=now(), summary='The Mac claimed this plan but sent no final report within 15 minutes. Its outcome is unknown.'
  where id in (select id from public.computer_commands where owner_id=p_owner and state in ('running','awaiting_confirmation') and claimed_at<now()-interval '15 minutes' limit 50);
 delete from private.computer_tickets where command_id in (select c.id from public.computer_commands c where c.owner_id=p_owner and c.state not in ('authorized','running','awaiting_confirmation'));
 -- 30-day history retention.
 delete from public.computer_commands where id in (select id from public.computer_commands where owner_id=p_owner and created_at<now()-interval '30 days' and state not in ('authorized','running','awaiting_confirmation') limit 100);
 delete from private.computer_pairings where id in (select id from private.computer_pairings where owner_id=p_owner and created_at<now()-interval '1 day' limit 50);
 delete from public.computer_devices d where d.owner_id=p_owner and d.state='revoked' and d.revoked_at<now()-interval '30 days' and not exists (select 1 from public.computer_commands c where c.device_id=d.id);
end $$;
create function private.computer_enabled_v1(p_owner uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce((select enabled from public.computer_settings where owner_id=p_owner),false);
$$;

-- ---------- Ordinary authenticated-user RPCs ----------
create function public.computer_settings_v1(p_enabled boolean default null, p_consent text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); s public.computer_settings;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,51));
 insert into public.computer_settings(owner_id) values (o) on conflict do nothing;
 if p_enabled is not null then
  if p_enabled and p_consent is distinct from 'computer-control-2026-11-05-v1' then raise exception 'Computer-control disclosure must be accepted' using errcode='22023'; end if;
  update public.computer_settings set enabled=p_enabled, consent_version=case when p_enabled then p_consent else consent_version end, updated_at=now() where owner_id=o;
  if not p_enabled then
   -- Disabling stops anything not yet claimed. A plan already on the Mac is asked to stop at its next check.
   update public.computer_commands set state='cancelled', finished_at=now(), summary='Computer control was turned off before this ran.' where owner_id=o and state in ('proposed','authorized');
   update public.computer_commands set cancel_requested_at=coalesce(cancel_requested_at,now()) where owner_id=o and state in ('running','awaiting_confirmation');
  end if;
 end if;
 select * into s from public.computer_settings where owner_id=o;
 return jsonb_build_object('enabled',s.enabled,'consent_version',s.consent_version,'updated_at',s.updated_at);
end $$;

create function public.computer_pairing_begin_v1(p_id uuid, p_code_hash text, p_extension text, p_origin text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); sess uuid:=private.computer_session_v1(); e timestamptz:=now()+interval '300 seconds';
begin
 if not private.computer_enabled_v1(o) then raise exception 'Computer control is off' using errcode='42501'; end if;
 if sess is null or p_id is null or coalesce(p_code_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_extension,'') !~ '^[a-p]{32}$' or p_origin is null or length(p_origin)>200 then raise exception 'Invalid pairing request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(o::text,51));
 perform private.computer_maintain_v1(o);
 if (select count(*) from private.computer_pairings where owner_id=o and created_at>now()-interval '10 minutes')>=5 then raise exception 'Pairing limit' using errcode='54000'; end if;
 if (select count(*) from public.computer_devices where owner_id=o and state='active')>=3 then raise exception 'Device limit' using errcode='54000'; end if;
 insert into private.computer_pairings(id,owner_id,code_hash,extension_id,origin,session_id,expires_at) values (p_id,o,p_code_hash,p_extension,p_origin,sess,e);
 return jsonb_build_object('pairing_id',p_id,'expires_at',e);
end $$;

create function public.computer_propose_v1(p_command uuid, p_request uuid, p_device uuid, p_source text, p_actions jsonb, p_labels jsonb, p_digest text, p_auto boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); d public.computer_devices; c public.computer_commands;
begin
 if not private.computer_enabled_v1(o) then raise exception 'Computer control is off' using errcode='42501'; end if;
 if p_command is null or p_request is null or p_source not in ('text','voice') or not private.computer_actions_valid_v1(p_actions) or jsonb_typeof(p_labels) is distinct from 'array' or jsonb_array_length(p_labels)<>jsonb_array_length(p_actions) or p_auto is null then raise exception 'Invalid computer proposal' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(o::text,51));
 perform private.computer_maintain_v1(o);
 select * into c from public.computer_commands where owner_id=o and request_id=p_request;
 if found then
  if c.digest<>p_digest or c.device_id<>p_device then raise exception 'Request reused with different parameters' using errcode='23505'; end if;
  return to_jsonb(c);
 end if;
 select * into d from public.computer_devices where id=p_device and owner_id=o and state='active';
 if not found then raise exception 'Device unavailable' using errcode='42501'; end if;
 if private.computer_digest_v1(p_device,p_command,p_actions) is distinct from p_digest then raise exception 'Digest mismatch' using errcode='22023'; end if;
 -- Aliases must be ones the companion published; it still re-checks its own local policy.
 if exists (select 1 from jsonb_array_elements(p_actions) a where a->>'type'<>'set_volume' and not exists (
   select 1 from jsonb_array_elements(d.catalogue) k where k->>'alias'=a->>'alias' and k->>'kind'=private.computer_kind_v1(a->>'type'))) then
  raise exception 'Unknown alias for this Mac' using errcode='22023';
 end if;
 if (select count(*) from public.computer_commands where owner_id=o and created_at>now()-interval '10 minutes')>=60 then raise exception 'Computer proposal limit' using errcode='54000'; end if;
 insert into public.computer_commands(id,owner_id,device_id,request_id,source,actions,labels,digest,auto_eligible,proposal_expires_at)
  values (p_command,o,p_device,p_request,p_source,p_actions,p_labels,p_digest,p_auto,now()+interval '300 seconds') returning * into c;
 return to_jsonb(c);
end $$;

create function public.computer_authorize_v1(p_command uuid, p_digest text, p_ticket_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); sess uuid:=private.computer_session_v1(); c public.computer_commands; e timestamptz:=now()+interval '60 seconds';
begin
 if sess is null or coalesce(p_ticket_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid authorization' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(o::text,51));
 perform private.computer_maintain_v1(o);
 if not private.computer_enabled_v1(o) then raise exception 'Computer control is off' using errcode='42501'; end if;
 select * into c from public.computer_commands where id=p_command and owner_id=o for update;
 if not found then raise exception 'Command unavailable' using errcode='42501'; end if;
 -- Approval is bound to the exact reviewed parameters and their version.
 if c.digest is distinct from p_digest then raise exception 'Reviewed parameters changed' using errcode='40001'; end if;
 if not exists (select 1 from public.computer_devices where id=c.device_id and owner_id=o and state='active') then raise exception 'Device unavailable' using errcode='42501'; end if;
 if c.state='authorized' and c.claimed_at is null then
  -- Re-issue for a page that lost its unsent ticket; the previous ticket stops working.
  update private.computer_tickets set ticket_hash=p_ticket_hash, session_id=sess, expires_at=e where command_id=c.id;
  update public.computer_commands set ticket_expires_at=e where id=c.id returning * into c;
 elsif c.state='proposed' then
  if (select count(*) from public.computer_commands where owner_id=o and authorized_at>now()-interval '10 minutes')>=60 then raise exception 'Computer authorization limit' using errcode='54000'; end if;
  update public.computer_commands set state='authorized', authorized_at=now(), ticket_expires_at=e where id=c.id returning * into c;
  insert into private.computer_tickets(command_id,ticket_hash,session_id,expires_at) values (c.id,p_ticket_hash,sess,e);
 else
  raise exception 'Command is no longer awaiting approval' using errcode='40001';
 end if;
 return jsonb_build_object('command_id',c.id,'state',c.state,'ticket_expires_at',c.ticket_expires_at);
end $$;

create function public.computer_cancel_v1(p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); c public.computer_commands;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,51));
 select * into c from public.computer_commands where id=p_command and owner_id=o for update;
 if not found then raise exception 'Command unavailable' using errcode='42501'; end if;
 if c.state in ('proposed','authorized') then
  delete from private.computer_tickets where command_id=c.id;
  update public.computer_commands set state='cancelled', finished_at=now(), summary='Cancelled before the Mac claimed it. Nothing ran.' where id=c.id returning * into c;
 elsif c.state in ('running','awaiting_confirmation') then
  -- The Mac stops before its next step; a step already in progress may complete.
  update public.computer_commands set cancel_requested_at=coalesce(cancel_requested_at,now()) where id=c.id returning * into c;
 end if;
 return jsonb_build_object('command_id',c.id,'state',c.state,'cancel_requested_at',c.cancel_requested_at);
end $$;

create function public.computer_device_v1(p_action text, p_device uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); d public.computer_devices;
begin
 if p_action is distinct from 'revoke' then raise exception 'Unsupported device action' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(o::text,51));
 select * into d from public.computer_devices where id=p_device and owner_id=o for update;
 if not found then raise exception 'Device unavailable' using errcode='42501'; end if;
 update public.computer_devices set state='revoked', revoked_at=coalesce(revoked_at,now()) where id=d.id returning * into d;
 delete from private.computer_credentials where device_id=d.id;
 delete from private.computer_tickets where command_id in (select id from public.computer_commands where device_id=d.id);
 update public.computer_commands set state='cancelled', finished_at=now(), summary='The Mac was disconnected from this account before this ran.' where device_id=d.id and state in ('proposed','authorized');
 update public.computer_commands set cancel_requested_at=coalesce(cancel_requested_at,now()) where device_id=d.id and state in ('running','awaiting_confirmation');
 return jsonb_build_object('device_id',d.id,'state',d.state,'revoked_at',d.revoked_at);
end $$;

create function public.computer_history_clear_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,51));
 delete from public.computer_commands where owner_id=o and state not in ('authorized','running','awaiting_confirmation');
 get diagnostics n=row_count;
 return jsonb_build_object('cleared',n);
end $$;

create function public.computer_export_v1(p_category text, p_after uuid default null, p_at timestamptz default now(), p_epoch bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); rows jsonb;
begin
 if not private.privacy_recent_v1() then raise exception 'Recent password authentication required' using errcode='42501'; end if;
 if p_at is null or p_at>now()+interval '30 seconds' or p_at<now()-interval '5 minutes' then raise exception 'Export window expired' using errcode='22023'; end if;
 if p_epoch is distinct from (select epoch from public.privacy_preferences where owner_id=o) then raise exception 'Privacy state changed during export' using errcode='40001'; end if;
 if p_category='computer_devices' then
  select coalesce(jsonb_agg(to_jsonb(y)),'[]') into rows from (select id,name,state,origin,enabled_actions,catalogue,created_at,last_seen_at,revoked_at from public.computer_devices
   where owner_id=o and (p_after is null or id>p_after) and created_at<=p_at order by id limit 100) y;
 elsif p_category='computer_actions' then
  select coalesce(jsonb_agg(to_jsonb(y)),'[]') into rows from (select id,device_id,source,actions,labels,state,created_at,authorized_at,claimed_at,finished_at,results,summary from public.computer_commands
   where owner_id=o and (p_after is null or id>p_after) and created_at<=p_at order by id limit 100) y;
 else raise exception 'Unknown export category' using errcode='22023';
 end if;
 return jsonb_build_object('rows',rows);
end $$;

-- ---------- Device-credential RPCs (anon role; the credential is the authority) ----------
-- Returns the device only when the secret matches, the device is active and the
-- owning account is still eligible (admitted, confirmed, not being deleted).
create function private.computer_device_auth_v1(p_device uuid, p_secret text) returns public.computer_devices language plpgsql set search_path='' as $$
declare d public.computer_devices; o uuid;
begin
 perform pg_advisory_xact_lock_shared(735194002::bigint);
 if p_device is null or coalesce(p_secret,'') !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Device unauthorized' using errcode='42501'; end if;
 -- Same per-owner lock as the user RPCs (global gate first, then owner): device and user
 -- operations for one account serialize, so concurrent redeems cannot deadlock.
 select v.owner_id into o from public.computer_devices v where v.id=p_device;
 if o is not null then perform pg_advisory_xact_lock(hashtextextended(o::text,51)); end if;
 select v.* into d from public.computer_devices v join private.computer_credentials k on k.device_id=v.id
  where v.id=p_device and v.state='active' and k.credential_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex') for share of v;
 if not found or not private.computer_account_eligible_v1(d.owner_id) then raise exception 'Device unauthorized' using errcode='42501'; end if;
 return d;
end $$;

create function private.computer_pairing_check_v1(p_pairing uuid, p_code text, p_extension text, p_lock boolean) returns private.computer_pairings language plpgsql set search_path='' as $$
declare p private.computer_pairings;
begin
 if p_pairing is null or coalesce(p_code,'') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(p_extension,'') !~ '^[a-p]{32}$' then raise exception 'Pairing unavailable' using errcode='42501'; end if;
 if p_lock then select * into p from private.computer_pairings where id=p_pairing and code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') for update;
 else select * into p from private.computer_pairings where id=p_pairing and code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex'); end if;
 -- One generic failure: no oracle distinguishing wrong code, wrong extension, expiry or reuse.
 if not found or p.consumed_at is not null or p.expires_at<=now() or p.extension_id<>p_extension
  or not private.computer_account_eligible_v1(p.owner_id) or not private.computer_session_live_v1(p.owner_id,p.session_id)
  or not private.computer_enabled_v1(p.owner_id) then raise exception 'Pairing unavailable' using errcode='42501'; end if;
 return p;
end $$;

create function public.computer_pairing_inspect_v1(p_pairing uuid, p_code text, p_extension text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.computer_pairings;
begin
 p:=private.computer_pairing_check_v1(p_pairing,p_code,p_extension,false);
 return jsonb_build_object('account_label',private.computer_account_label_v1(p.owner_id),'origin',p.origin,'expires_at',private.computer_instant_v1(p.expires_at));
end $$;

create function public.computer_pairing_complete_v1(p_pairing uuid, p_code text, p_extension text, p_name text, p_credential_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.computer_pairings; d public.computer_devices;
begin
 perform pg_advisory_xact_lock_shared(735194002::bigint);
 p:=private.computer_pairing_check_v1(p_pairing,p_code,p_extension,true);
 perform pg_advisory_xact_lock(hashtextextended(p.owner_id::text,51));
 if coalesce(p_credential_hash,'') !~ '^[a-f0-9]{64}$' or p_name is null or length(p_name) not between 1 and 60 or p_name<>btrim(p_name) or p_name ~ '[[:cntrl:]]' then raise exception 'Invalid device registration' using errcode='22023'; end if;
 if (select count(*) from public.computer_devices where owner_id=p.owner_id and state='active')>=3 then raise exception 'Device limit' using errcode='54000'; end if;
 insert into public.computer_devices(owner_id,name,extension_id,origin,last_seen_at) values (p.owner_id,p_name,p.extension_id,p.origin,now()) returning * into d;
 insert into private.computer_credentials(device_id,credential_hash) values (d.id,p_credential_hash);
 update private.computer_pairings set consumed_at=now(), device_id=d.id where id=p.id;
 return jsonb_build_object('device_id',d.id,'account_label',private.computer_account_label_v1(p.owner_id),'origin',p.origin);
end $$;

create function public.computer_device_sync_v1(p_device uuid, p_secret text, p_sync jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.computer_devices:=private.computer_device_auth_v1(p_device,p_secret);
begin
 -- The web route validates the full contract; this is a defensive structural bound.
 if jsonb_typeof(p_sync) is distinct from 'object' or octet_length(p_sync::text)>65536 or jsonb_typeof(p_sync->'catalogue') is distinct from 'array'
  or jsonb_typeof(p_sync->'enabledActions') is distinct from 'array' or jsonb_typeof(p_sync->'disabled') is distinct from 'boolean' or jsonb_typeof(p_sync->'volumeAuto') is distinct from 'boolean'
  or exists (select 1 from jsonb_array_elements(p_sync->'catalogue') k where jsonb_typeof(k) is distinct from 'object' or (k->>'kind') not in ('application','website','folder','shortcut') or coalesce(k->>'alias','') !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' or (k->>'kind'='shortcut' and (k->>'auto')::boolean)) then
  raise exception 'Invalid device sync' using errcode='22023';
 end if;
 update public.computer_devices set catalogue=p_sync->'catalogue', enabled_actions=array(select jsonb_array_elements_text(p_sync->'enabledActions')), disabled=(p_sync->>'disabled')::boolean,
  volume_auto=(p_sync->>'volumeAuto')::boolean, host_version=left(p_sync->>'hostVersion',32), last_seen_at=now(), catalogue_updated_at=now() where id=d.id;
 perform private.computer_maintain_v1(d.owner_id);
 return jsonb_build_object('device_id',d.id,'state','active','control_enabled',private.computer_enabled_v1(d.owner_id),'account_label',private.computer_account_label_v1(d.owner_id));
end $$;

create function public.computer_redeem_v1(p_device uuid, p_secret text, p_command uuid, p_ticket text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.computer_devices:=private.computer_device_auth_v1(p_device,p_secret); c public.computer_commands; t private.computer_tickets;
begin
 if coalesce(p_ticket,'') !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 perform private.computer_maintain_v1(d.owner_id);
 select * into c from public.computer_commands where id=p_command and device_id=d.id and owner_id=d.owner_id for update;
 if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 if c.claimed_at is not null then
  -- Reconciliation only: the same device learns the state, never a second authorization.
  return jsonb_build_object('status','already_claimed','state',c.state);
 end if;
 -- The device owns this command, so reporting its state is not an oracle. Expired or
 -- cancelled approvals report that truthfully instead of looking like a revoked credential.
 if c.state<>'authorized' then return jsonb_build_object('status',(case when c.state='expired' then 'expired' else 'not_authorized' end),'state',c.state); end if;
 select * into t from private.computer_tickets where command_id=c.id and ticket_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') for update;
 if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 if t.expires_at<=now() then return jsonb_build_object('status','expired','state',c.state); end if;
 if not private.computer_enabled_v1(d.owner_id) then return jsonb_build_object('status','disabled','state',c.state); end if;
 -- Sign-out ends the authority of tickets issued by that session.
 if not private.computer_session_live_v1(d.owner_id,t.session_id) then
  update public.computer_commands set state='cancelled', finished_at=now(), summary='The signed-in session that approved this ended before the Mac claimed it. Nothing ran.' where id=c.id;
  delete from private.computer_tickets where command_id=c.id;
  return jsonb_build_object('status','session_ended','state','cancelled');
 end if;
 update private.computer_tickets set claimed_at=now() where command_id=c.id;
 update public.computer_commands set state='running', claimed_at=now() where id=c.id returning * into c;
 update public.computer_devices set last_seen_at=now() where id=d.id;
 return jsonb_build_object('status','claimed','account_label',private.computer_account_label_v1(d.owner_id),'origin',d.origin,'command',jsonb_build_object(
  'protocolVersion',1,'commandId',c.id,'requestId',c.request_id,'deviceId',c.device_id,'actions',c.actions,
  'issuedAt',private.computer_instant_v1(c.authorized_at),'expiresAt',private.computer_instant_v1(c.ticket_expires_at),'digest',c.digest));
end $$;

create function public.computer_progress_v1(p_device uuid, p_secret text, p_command uuid, p_state text, p_index integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.computer_devices:=private.computer_device_auth_v1(p_device,p_secret); c public.computer_commands; t private.computer_tickets; reason text;
begin
 if p_state not in ('awaiting_confirmation','running') or p_index is null or p_index not between 0 and 4 then raise exception 'Invalid progress' using errcode='22023'; end if;
 select * into c from public.computer_commands where id=p_command and device_id=d.id and owner_id=d.owner_id for update;
 if not found then raise exception 'Command unavailable' using errcode='42501'; end if;
 if c.state not in ('running','awaiting_confirmation') then return jsonb_build_object('continue',false,'reason','not_running','state',c.state); end if;
 select * into t from private.computer_tickets where command_id=c.id;
 reason:=(case when c.cancel_requested_at is not null then 'cancel_requested'
  when not private.computer_enabled_v1(d.owner_id) then 'control_disabled'
  when t.session_id is null or not private.computer_session_live_v1(d.owner_id,t.session_id) then 'session_ended' end);
 update public.computer_commands set state=p_state where id=c.id;
 update public.computer_devices set last_seen_at=now() where id=d.id;
 return jsonb_build_object('continue',reason is null,'reason',reason,'state',p_state);
end $$;

create function public.computer_finish_v1(p_device uuid, p_secret text, p_command uuid, p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.computer_devices:=private.computer_device_auth_v1(p_device,p_secret); c public.computer_commands; s text:=p_result->>'state';
begin
 if jsonb_typeof(p_result) is distinct from 'object' or s not in ('succeeded','failed','cancelled','expired','outcome_unknown') or jsonb_typeof(p_result->'results') is distinct from 'array'
  or jsonb_array_length(p_result->'results')>5 or octet_length((p_result->'results')::text)>16384 or jsonb_typeof(p_result->'summary') is distinct from 'string' or length(p_result->>'summary')>300 then
  raise exception 'Invalid result' using errcode='22023';
 end if;
 select * into c from public.computer_commands where id=p_command and device_id=d.id and owner_id=d.owner_id for update;
 if not found then raise exception 'Command unavailable' using errcode='42501'; end if;
 if c.claimed_at is null then raise exception 'Command was not claimed by this Mac' using errcode='42501'; end if;
 -- A server-side "unknown" may be replaced by the Mac's later report; other final states are kept.
 if c.state in ('running','awaiting_confirmation','outcome_unknown') then
  update public.computer_commands set state=s, results=p_result->'results', summary=p_result->>'summary', finished_at=now() where id=c.id returning * into c;
  delete from private.computer_tickets where command_id=c.id;
 end if;
 update public.computer_devices set last_seen_at=now() where id=d.id;
 return jsonb_build_object('command_id',c.id,'state',c.state);
end $$;

create function public.computer_device_unpair_v1(p_device uuid, p_secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.computer_devices:=private.computer_device_auth_v1(p_device,p_secret);
begin
 update public.computer_devices set state='revoked', revoked_at=now() where id=d.id;
 delete from private.computer_credentials where device_id=d.id;
 update public.computer_commands set state='cancelled', finished_at=now(), summary='This Mac was unpaired before this ran.' where device_id=d.id and state in ('proposed','authorized');
 return jsonb_build_object('device_id',d.id,'state','revoked');
end $$;

-- Grants while still the owning role (revoking as a non-owner fails).
do $$ declare f record; begin
 for f in select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.proname like 'computer\_%' and n.nspname in ('public','private') and pg_get_userbyid(p.proowner)=current_user loop
  execute format('revoke all on function %I.%I(%s) from public, anon, authenticated, service_role, authenticator, jarvis_reminder_worker', f.nspname, f.proname, f.args);
 end loop;
end $$;
grant execute on function public.computer_settings_v1(boolean,text), public.computer_pairing_begin_v1(uuid,text,text,text),
 public.computer_propose_v1(uuid,uuid,uuid,text,jsonb,jsonb,text,boolean), public.computer_authorize_v1(uuid,text,text), public.computer_cancel_v1(uuid),
 public.computer_device_v1(text,uuid), public.computer_history_clear_v1(), public.computer_export_v1(text,uuid,timestamptz,bigint) to authenticated;
grant execute on function public.computer_pairing_inspect_v1(uuid,text,text), public.computer_pairing_complete_v1(uuid,text,text,text,text),
 public.computer_device_sync_v1(uuid,text,jsonb), public.computer_redeem_v1(uuid,text,uuid,text), public.computer_progress_v1(uuid,text,uuid,text,integer),
 public.computer_finish_v1(uuid,text,uuid,jsonb), public.computer_device_unpair_v1(uuid,text) to anon;
reset role;
revoke create on schema public, private from jarvis_auth_guard;
notify pgrst, 'reload schema';
