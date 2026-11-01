-- Additive Privacy Center; depends on the entire chain through 202610310003.
-- Source only in this phase. No existing migration is changed.
create table public.privacy_preferences (
 owner_id uuid primary key references public.profiles(owner_id) on delete cascade,
 text_cloud boolean not null default false,notifications boolean not null default false,
 retention_days integer not null default 30 check(retention_days in (7,30,90,365)),
 epoch bigint not null default 0,version integer not null default 1,updated_at timestamptz not null default now()
);
create table private.privacy_jobs (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,request_id uuid not null,
 scope text not null check(scope in ('history','memories','tasks_reminders','account')),
 state text not null default 'queued' check(state in ('queued','running','waiting_external','failed','complete')),
 phase text not null default 'content',receipt_hash text,counts jsonb not null default '{}',
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),lease uuid,lease_until timestamptz,
 last_code text check(last_code in ('cleanup_unavailable','auth_unavailable','credential_cleanup_failed','queue_unavailable')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,
 queue_cursor uuid,queue_checked_at timestamptz,budget_moved_at timestamptz,unique(owner_id,request_id),check(receipt_hash is null or receipt_hash ~ '^[a-f0-9]{64}$')
);
create unique index privacy_one_active_job on private.privacy_jobs(owner_id) where state<>'complete';
create index privacy_job_work on private.privacy_jobs(next_attempt_at,created_at) where state<>'complete';
create table private.privacy_events (
 id uuid primary key default gen_random_uuid(),owner_id uuid,event text not null,counts jsonb not null default '{}',created_at timestamptz not null default now()
);
create index privacy_events_expiry on private.privacy_events(created_at);
-- Minimal retired request IDs prevent old retries recreating erased records.
-- No content/hash/credentials; retained until account deletion, orphan batches purged.
create table private.privacy_requests (
 owner_id uuid not null,request_id uuid not null,retired_at timestamptz not null default now(),primary key(owner_id,request_id)
);
-- Unlinked cost totals preserve existing spending ceilings across account erasure.
-- Monthly totals: 13 months. Initial-evaluation carry: until that policy is retired.
create table private.privacy_budget_totals (
 scope_id text not null,budget_month date not null,charged_paise bigint not null default 0,evaluation_paise bigint not null default 0,
 primary key(scope_id,budget_month)
);
alter table public.privacy_preferences enable row level security;
revoke all on public.privacy_preferences from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select on public.privacy_preferences to authenticated;
grant select,insert,update,delete on public.privacy_preferences to jarvis_auth_guard;
create policy privacy_owned_read on public.privacy_preferences for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()));
create policy privacy_guard on public.privacy_preferences to jarvis_auth_guard using(true) with check(true);
do $$ declare n text;begin foreach n in array array['privacy_jobs','privacy_events','privacy_budget_totals','privacy_requests'] loop
 execute format('alter table private.%I enable row level security',n);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role,jarvis_reminder_worker',n);
 execute format('grant select,insert,update,delete on private.%I to jarvis_auth_guard',n);
 execute format('create policy privacy_guard on private.%I to jarvis_auth_guard using(true) with check(true)',n);
end loop;end $$;
insert into public.privacy_preferences(owner_id,text_cloud,notifications)
 select p.owner_id,coalesce(c.ai_enabled or c.ai_evaluation_enabled,false),coalesce(c.pushover_enabled,false)
 from public.profiles p left join private.personal_integrations c on c.owner_id=p.owner_id;
alter table public.messages add column privacy_epoch bigint not null default 0;
alter table public.messages add column memory_suppressed boolean not null default false;

-- Global SQL gate orders bounded maintenance before owner/series/task/reminder locks.
-- No lock is held across provider requests or filesystem/Auth API calls.
grant create on schema public,private to jarvis_auth_guard;
set local role jarvis_auth_guard;
create or replace function private.has_access() returns boolean language sql stable security definer set search_path='' as $$
 select private.auth_session_is_active()
 and exists(select 1 from private.admissions a where a.owner_id::text=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub') and a.enabled)
 and not exists(select 1 from private.revoked_sessions r where r.session_id::text=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id'))
 and not exists(select 1 from private.privacy_jobs j where j.owner_id::text=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub') and j.scope='account');
$$;
create or replace function private.m2a_owner_v1() returns uuid language plpgsql set search_path='' as $$
declare o uuid;
begin
 perform pg_advisory_xact_lock_shared(735194002::bigint);
 if private.has_access() is not true then raise exception 'Account unavailable' using errcode='42501';end if;
 o:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
 perform 1 from public.privacy_preferences where owner_id=o for share;
 if not found or exists(select 1 from private.privacy_jobs where owner_id=o and state<>'complete') then raise exception 'Privacy operation pending' using errcode='42501';end if;
 return o;
end $$;
create function private.privacy_recent_v1() returns boolean language plpgsql stable set search_path='' as $$
declare claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;a jsonb;stamp numeric;
begin
 if private.has_access() is not true or jsonb_typeof(claims->'amr') is distinct from 'array' then return false;end if;
 for a in select value from jsonb_array_elements(claims->'amr') loop
  if a->>'method'='password' and coalesce(a->>'timestamp','') ~ '^\d{1,12}$' then
   stamp:=(a->>'timestamp')::numeric;if stamp between extract(epoch from now())-300 and extract(epoch from now())+30 then return true;end if;
  end if;
 end loop;return false;
end $$;
create function private.privacy_profile_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.privacy_preferences(owner_id) values(new.owner_id) on conflict do nothing;return new;end $$;
create function private.privacy_conversation_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare days integer;
begin
 select retention_days into days from public.privacy_preferences where owner_id=new.owner_id;
 new.expires_at:=new.created_at+make_interval(secs=>coalesce(days,30)*86400);return new;
end $$;
create function private.privacy_message_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare e bigint;
begin
 select epoch into e from public.privacy_preferences where owner_id=new.owner_id;
 if tg_op='INSERT' then
  if exists(select 1 from private.privacy_requests where owner_id=new.owner_id and request_id=new.request_id) then raise exception 'Retired request cannot be replayed' using errcode='40001';end if;
  new.privacy_epoch:=coalesce(e,0);
 elsif new.privacy_epoch<>e and (new.user_text is distinct from old.user_text or new.assistant_text is distinct from old.assistant_text or new.state is distinct from old.state) and (new.state='running' or (old.state='running' and new.state='complete')) then raise exception 'Stale privacy context' using errcode='40001';end if;
 return new;
end $$;
create function private.privacy_proposal_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.messages;
begin
 if new.state in ('pending','approved') then
  select m.* into s from public.messages m join public.conversations c on c.id=m.conversation_id and c.owner_id=m.owner_id where m.id=new.source_message_id and m.owner_id=new.owner_id and c.expires_at>now();
  if s.id is null or s.memory_suppressed then raise exception 'Source unavailable for memory approval' using errcode='40001';end if;
  if tg_op='INSERT' and s.privacy_epoch<>(select epoch from public.privacy_preferences where owner_id=new.owner_id) then raise exception 'Stale extraction context' using errcode='40001';end if;
 else update public.messages set memory_suppressed=true where id=new.source_message_id and owner_id=new.owner_id;end if;
 return new;
end $$;
create function private.privacy_request_v1(o uuid,r uuid) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.privacy_requests where owner_id=o and request_id=r) then raise exception 'Erased operation cannot be replayed' using errcode='40001';end if;
 if exists(select 1 from public.messages m join public.privacy_preferences p on p.owner_id=m.owner_id where m.owner_id=o and m.request_id=r and m.privacy_epoch<>p.epoch) then raise exception 'Stale action context' using errcode='40001';end if;
end $$;
create function private.privacy_cloud_v1(o uuid,k text) returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from private.privacy_jobs where owner_id=o and state<>'complete' and (scope='account' or k<>'notifications')) and coalesce((select case k when 'text' then text_cloud when 'notifications' then notifications else true end from public.privacy_preferences where owner_id=o),false);
$$;
-- Preserve all existing server configuration gates; consent adds another boundary.
alter function private.m2c_ai_policy_v1(uuid) rename to m2c_ai_policy_before_privacy_v1;
create function private.m2c_ai_policy_v1(p_owner uuid) returns jsonb language sql stable set search_path='' as $$
 select c||jsonb_build_object('ai_enabled',coalesce((c->>'ai_enabled')::boolean,false) and private.privacy_cloud_v1(p_owner,'text'),'ai_evaluation_enabled',coalesce((c->>'ai_evaluation_enabled')::boolean,false) and private.privacy_cloud_v1(p_owner,'text')) from (select private.m2c_ai_policy_before_privacy_v1(p_owner) c) x;
$$;
create or replace function private.voice_allowed_v1(o uuid) returns boolean language sql stable set search_path='' as $$
 select private.privacy_cloud_v1(o,'audio') and exists(select 1 from public.voice_preferences where owner_id=o and cloud_transcription and consent_version='openai-audio-2026-10-31-v1') and coalesce((select transcription_enabled from private.personal_integrations where owner_id=o),(select transcription_enabled from private.ai_test_policies where owner_id=o),false);
$$;
alter function private.m2c_authorize_push_v1(public.reminders,text) rename to m2c_authorize_push_before_privacy_v1;
create function private.m2c_authorize_push_v1(p_reminder public.reminders,p_binding text) returns boolean language plpgsql set search_path='' as $$
begin return private.privacy_cloud_v1(p_reminder.owner_id,'notifications') and private.m2c_authorize_push_before_privacy_v1(p_reminder,p_binding);end $$;
alter function private.m2c_push_allowed_v1(uuid) rename to m2c_push_allowed_before_privacy_v1;
create function private.m2c_push_allowed_v1(p_owner uuid) returns boolean language sql stable set search_path='' as $$
 select private.privacy_cloud_v1(p_owner,'notifications') and private.m2c_push_allowed_before_privacy_v1(p_owner);
$$;
create or replace function public.m2c_capabilities_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();c private.personal_integrations;
begin select * into c from private.personal_integrations where owner_id=o;
 return jsonb_build_object('ai_enabled',coalesce(c.ai_enabled,false) and private.privacy_cloud_v1(o,'text'),'pushover_enabled',coalesce(c.pushover_enabled,false) and private.privacy_cloud_v1(o,'notifications'),'privacy_epoch',(select epoch from public.privacy_preferences where owner_id=o));end $$;
create function public.privacy_get_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 if private.has_access() is not true then raise exception 'Account unavailable' using errcode='42501';end if;o:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
 return jsonb_build_object('preferences',(select to_jsonb(p) from public.privacy_preferences p where owner_id=o),'recent_authentication',private.privacy_recent_v1(),'jobs',coalesce((select jsonb_agg(x) from (select id,scope,state,phase,counts,last_code,created_at,updated_at,completed_at from private.privacy_jobs where owner_id=o order by created_at desc limit 10) x),'[]'));
end $$;
create function public.privacy_reauth_check_v1() returns void language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 perform pg_advisory_xact_lock_shared(735194002::bigint);
 if private.has_access() is not true then raise exception 'Account unavailable' using errcode='42501';end if;
 o:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;perform pg_advisory_xact_lock(hashtextextended(o::text,7));
 if (select count(*) from private.privacy_events where owner_id=o and event='reauth_attempt' and created_at>now()-interval '1 minute')>=5 then raise exception 'Reauthentication rate limit' using errcode='54000';end if;
 insert into private.privacy_events(owner_id,event) values(o,'reauth_attempt');
end $$;
create function public.privacy_command_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;v public.privacy_preferences;j private.privacy_jobs;shorter boolean;n integer;
begin
 perform pg_advisory_xact_lock_shared(735194002::bigint);
 if private.has_access() is not true then raise exception 'Account unavailable' using errcode='42501';end if;
 o:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;perform pg_advisory_xact_lock(hashtextextended(o::text,7));
 select * into v from public.privacy_preferences where owner_id=o for update;
 if p_request is null or p_action not in ('consent','retention','delete','retry') or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>2048 then raise exception 'Invalid privacy operation' using errcode='22023';end if;
 if p_action='consent' then
  if not(p_data ?& array['text_cloud','notifications','version']) or (p_data-'text_cloud'-'notifications'-'version')<>'{}' or jsonb_typeof(p_data->'text_cloud')<>'boolean' or jsonb_typeof(p_data->'notifications')<>'boolean' then raise exception 'Invalid consent' using errcode='22023';end if;
  if v.version is distinct from (p_data->>'version')::integer then raise exception 'Settings changed' using errcode='40001';end if;
  update public.privacy_preferences set text_cloud=(p_data->>'text_cloud')::boolean,notifications=(p_data->>'notifications')::boolean,version=version+1,updated_at=now() where owner_id=o;
  insert into private.privacy_events(owner_id,event) values(o,'consent_changed');
 elsif p_action='retention' then
  if (p_data-'days'-'version'-'confirm_shorter')<>'{}' or (p_data->>'days')::integer not in (7,30,90,365) or p_data->>'days' is null then raise exception 'Invalid retention' using errcode='22023';end if;
  if v.version is distinct from (p_data->>'version')::integer then raise exception 'Settings changed' using errcode='40001';end if;
  shorter:=(p_data->>'days')::integer<v.retention_days;
  if shorter and (p_data->>'confirm_shorter') is distinct from 'true' then raise exception 'Confirm shorter retention' using errcode='22023';end if;
  update public.privacy_preferences set retention_days=(p_data->>'days')::integer,epoch=epoch+case when shorter then 1 else 0 end,version=version+1,updated_at=now() where owner_id=o;
  -- At most 50 conversations/account. Expired rows never become visible again.
  update public.conversations set expires_at=created_at+make_interval(secs=>(p_data->>'days')::integer*86400) where owner_id=o and expires_at>now();
  insert into private.privacy_events(owner_id,event) values(o,'retention_changed');
 elsif p_action='retry' then
  if not private.privacy_recent_v1() then raise exception 'Recent authentication required' using errcode='42501';end if;
  if (p_data-'id')<>'{}' or p_data->>'id' is null then raise exception 'Invalid retry' using errcode='22023';end if;
  select * into j from private.privacy_jobs where id=(p_data->>'id')::uuid and owner_id=o and scope<>'account' for update;
  if not found then raise exception 'Job unavailable' using errcode='42501';end if;
  if j.state='failed' and j.updated_at<now()-interval '1 minute' then update private.privacy_jobs set state='queued',attempts=0,next_attempt_at=now(),last_code=null,updated_at=now() where id=j.id;end if;
 else
  if not private.privacy_recent_v1() then raise exception 'Recent password authentication required' using errcode='42501';end if;
  if (p_data-'scope'-'confirmation'-'receipt_hash')<>'{}' or p_data->>'scope' not in ('history','memories','tasks_reminders','account') or p_data->>'scope' is null or p_data->>'confirmation' is distinct from case p_data->>'scope' when 'account' then 'DELETE MY ACCOUNT' when 'history' then 'DELETE HISTORY' when 'memories' then 'DELETE MEMORIES' else 'DELETE TASKS AND REMINDERS' end then raise exception 'Exact confirmation required' using errcode='22023';end if;
  select * into j from private.privacy_jobs where owner_id=o and request_id=p_request;
  if found then if j.scope<>p_data->>'scope' then raise exception 'Request conflict' using errcode='40001';end if;return jsonb_build_object('job',jsonb_build_object('id',j.id,'state',j.state,'scope',j.scope),'replay',true);end if;
  if exists(select 1 from private.privacy_jobs where owner_id=o and state<>'complete') then raise exception 'Deletion already pending' using errcode='40001';end if;
  if (select count(*) from private.privacy_jobs where owner_id=o and created_at>now()-interval '1 day')>=20 then raise exception 'Privacy operation limit' using errcode='54000';end if;
  if p_data->>'scope'='account' and coalesce(p_data->>'receipt_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Receipt required' using errcode='22023';end if;
  insert into private.privacy_jobs(owner_id,request_id,scope,receipt_hash) values(o,p_request,p_data->>'scope',p_data->>'receipt_hash') returning * into j;
  update public.privacy_preferences set epoch=epoch+1,version=version+1,updated_at=now(),text_cloud=case when j.scope='account' then false else text_cloud end,notifications=case when j.scope='account' then false else notifications end where owner_id=o;
  if j.scope='account' then
   update private.admissions set enabled=false where owner_id=o;
   update private.personal_integrations set ai_enabled=false,ai_evaluation_enabled=false,pushover_enabled=false,transcription_enabled=false,channel_test_id=null where owner_id=o;
   update public.voice_preferences set cloud_transcription=false,consent_version=null,updated_at=now() where owner_id=o;
  end if;
  -- Immediate retrieval/proposal suppression; active sets are capped at 50 each.
  if j.scope in ('memories','account') then
   update public.messages set memory_suppressed=true where owner_id=o and id in(select source_message_id from public.memory_proposals where owner_id=o and state in ('pending','approved') order by created_at desc limit 100);get diagnostics n=row_count;j.counts:=jsonb_set(j.counts,'{sources_suppressed}',to_jsonb(n));
   update public.memory_proposals set state='deleted',content='',version=version+1 where id in(select id from public.memory_proposals where owner_id=o and state in ('pending','approved') order by created_at desc limit 100);get diagnostics n=row_count;j.counts:=jsonb_set(j.counts,'{proposals_cleared}',to_jsonb(n));
   update public.memories set state='deleted',content='',version=version+1,updated_at=now() where owner_id=o and state='active';get diagnostics n=row_count;j.counts:=jsonb_set(j.counts,'{memories_cleared}',to_jsonb(n));
   update private.privacy_jobs set counts=j.counts where id=j.id;
  end if;
  return jsonb_build_object('job',jsonb_build_object('id',j.id,'scope',j.scope,'state',j.state),'replay',false);
 end if;
 return public.privacy_get_v1();
end $$;
reset role;
create trigger privacy_profile after insert on public.profiles for each row execute function private.privacy_profile_v1();
create trigger privacy_conversation before insert on public.conversations for each row execute function private.privacy_conversation_v1();
create trigger privacy_message before insert or update on public.messages for each row execute function private.privacy_message_v1();
create trigger privacy_proposal before insert or update on public.memory_proposals for each row execute function private.privacy_proposal_v1();
-- Sources with delayed physical retention cleanup cannot be approved or exported.
drop policy owned_read on public.memory_proposals;
create policy owned_read on public.memory_proposals for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()) and exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id and c.owner_id=m.owner_id where m.id=source_message_id and m.owner_id=memory_proposals.owner_id and c.expires_at>now()));
set local role jarvis_auth_guard;
create function private.privacy_retire_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if exists(select 1 from private.privacy_jobs where owner_id=old.owner_id and scope='account') then return old;end if;
 if tg_table_name in ('messages','task_operations') then r:=old.request_id;else r:=old.idempotency_key;end if;
 insert into private.privacy_requests(owner_id,request_id) values(old.owner_id,r) on conflict do nothing;return old;
end $$;
create function private.privacy_insert_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.privacy_jobs where owner_id=new.owner_id and state<>'complete') then raise exception 'Deletion prevents content recreation' using errcode='42501';end if;return new;
end $$;
create function public.privacy_context_v1(p_conversation uuid default null,p_epoch bigint default null) returns void language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();
begin
 if p_epoch is not null and p_epoch<>(select epoch from public.privacy_preferences where owner_id=o) then raise exception 'Stale provider context' using errcode='40001';end if;
 if p_conversation is not null and not exists(select 1 from public.conversations where id=p_conversation and owner_id=o and expires_at>now()) then raise exception 'Source unavailable' using errcode='42501';end if;
end $$;
-- Same command contracts; private delegates are never API/worker capabilities.
alter function public.task_command_v1(text,uuid,jsonb) rename to task_command_before_privacy_v1;
alter function public.task_command_before_privacy_v1(text,uuid,jsonb) set schema private;
alter function public.m2b_reminder_v1(text,uuid,jsonb) rename to m2b_reminder_before_privacy_v1;
alter function public.m2b_reminder_before_privacy_v1(text,uuid,jsonb) set schema private;
alter function public.reminder_series_v1(text,uuid,jsonb) rename to reminder_series_before_privacy_v1;
alter function public.reminder_series_before_privacy_v1(text,uuid,jsonb) set schema private;
create function public.task_command_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.privacy_request_v1(private.m2a_owner_v1(),p_request);return private.task_command_before_privacy_v1(p_action,p_request,p_data);end $$;
create function public.m2b_reminder_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.privacy_request_v1(private.m2a_owner_v1(),p_request);return private.m2b_reminder_before_privacy_v1(p_action,p_request,p_data);end $$;
create function public.reminder_series_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.privacy_request_v1(private.m2a_owner_v1(),p_request);return private.reminder_series_before_privacy_v1(p_action,p_request,p_data);end $$;
create function private.privacy_budget_check_v1(o uuid) returns void language plpgsql set search_path='' as $$
declare s text:=private.m2c_ai_policy_v1(o)->>'scope';m date:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;spent bigint;ev bigint;
begin
 select coalesce(sum(charged_paise),0) into spent from public.ai_requests where scope_id=s and budget_month=m;
 select coalesce(sum(charged_paise),0) into ev from public.ai_requests where scope_id=s and purpose='evaluation';
 spent:=spent+coalesce((select charged_paise from private.privacy_budget_totals where scope_id=s and budget_month=m),0);
 ev:=ev+coalesce((select evaluation_paise from private.privacy_budget_totals where scope_id=s and budget_month='1970-01-01'),0);
 if spent>100000 or ev>20000 then raise exception 'Allowance includes deleted-account usage' using errcode='54000';end if;
end $$;
alter function public.m2c_ai_reserve_v1(uuid,uuid,text,text,integer,integer,text) rename to m2c_ai_reserve_before_privacy_v1;
alter function public.m2c_ai_reserve_before_privacy_v1(uuid,uuid,text,text,integer,integer,text) set schema private;
alter function public.voice_reserve_v1(uuid,integer,text) rename to voice_reserve_before_privacy_v1;
alter function public.voice_reserve_before_privacy_v1(uuid,integer,text) set schema private;
alter function public.m2c_ai_account_v1(text,uuid,text,jsonb) rename to m2c_ai_account_before_privacy_v1;
alter function public.m2c_ai_account_before_privacy_v1(text,uuid,text,jsonb) set schema private;
reset role;
alter table public.ai_requests add column privacy_epoch bigint not null default 0,add column context_conversation uuid;
set local role jarvis_auth_guard;
create function public.m2c_ai_reserve_v1(p_request uuid,p_attempt uuid,p_purpose text,p_model text,p_input integer,p_output integer,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();r jsonb;
begin
 perform private.privacy_request_v1(o,p_request);
 if not private.privacy_cloud_v1(o,'text') then raise exception 'Cloud text disabled' using errcode='42501';end if;
 r:=private.m2c_ai_reserve_before_privacy_v1(p_request,p_attempt,p_purpose,p_model,p_input,p_output,p_hash);
 if (r->>'acquired')::boolean then
  perform private.privacy_budget_check_v1(o);
  update public.ai_requests set privacy_epoch=(select epoch from public.privacy_preferences where owner_id=o),context_conversation=(select conversation_id from public.messages where owner_id=o and request_id=p_request) where id=(r->>'id')::uuid and owner_id=o;
 end if;return r;
end $$;
create function public.voice_reserve_v1(p_request uuid,p_milliseconds integer,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();r jsonb;
begin r:=private.voice_reserve_before_privacy_v1(p_request,p_milliseconds,p_hash);perform private.privacy_budget_check_v1(o);return r;end $$;
create function public.m2c_ai_account_v1(p_action text,p_id uuid,p_token text,p_usage jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();r public.ai_requests;
begin
 if p_action='dispatch' then
  select * into r from public.ai_requests where id=p_id and owner_id=o;
  if not private.privacy_cloud_v1(o,'text') or r.privacy_epoch<>(select epoch from public.privacy_preferences where owner_id=o) then raise exception 'Cloud consent/context changed' using errcode='42501';end if;
  perform public.privacy_context_v1(r.context_conversation,r.privacy_epoch);perform private.privacy_request_v1(o,r.request_id);
 end if;
 return private.m2c_ai_account_before_privacy_v1(p_action,p_id,p_token,p_usage);
end $$;
create or replace function public.m2c_ai_budget_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();s text:=private.m2c_ai_policy_v1(o)->>'scope';m date:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;spent bigint;ev bigint;
begin
 select coalesce(sum(charged_paise),0) into spent from public.ai_requests where owner_id=o and budget_month=m;
 select coalesce(sum(charged_paise),0) into ev from public.ai_requests where owner_id=o and purpose='evaluation';
 spent:=spent+coalesce((select charged_paise from private.privacy_budget_totals where scope_id=s and budget_month=m),0);ev:=ev+coalesce((select evaluation_paise from private.privacy_budget_totals where scope_id=s and budget_month='1970-01-01'),0);
 return jsonb_build_object('period',m,'timezone','Asia/Kolkata','estimated_committed_or_reserved_paise',spent,'remaining_paise',greatest(0,100000-spent),'evaluation_paise',ev,'evaluation_remaining_paise',greatest(0,20000-ev),'alert80',spent>=80000,'invoice_total_verified',false,'includes_unlinked_deleted_account_totals',true);
end $$;
-- A model action and its live source/version check share one transaction.
create function public.privacy_action_v1(p_kind text,p_action text,p_request uuid,p_conversation uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();
begin
 if not exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id and c.owner_id=m.owner_id join public.privacy_preferences p on p.owner_id=m.owner_id where m.owner_id=o and m.request_id=p_request and m.conversation_id=p_conversation and c.expires_at>now() and m.privacy_epoch=p.epoch and m.state='running') then raise exception 'Action source deleted or changed' using errcode='40001';end if;
 if p_kind='task' and p_action in ('review','review_reminder') then return public.task_command_v1(p_action,p_request,p_data);
 elsif p_kind='reminder' and p_action='review' then return public.m2b_reminder_v1(p_action,p_request,p_data);
 elsif p_kind='series' and p_action='review' then return public.reminder_series_v1(p_action,p_request,p_data);
 end if;raise exception 'Only review proposals are permitted' using errcode='22023';
end $$;
-- Status capability exposes no owner, email, content, keys or diagnostic details.
create function public.privacy_receipt_v1(p_request uuid,p_token text,p_retry boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.privacy_jobs;
begin
 if coalesce(p_token,'') !~ '^[a-f0-9]{64}$' then raise exception 'Receipt unavailable' using errcode='42501';end if;
 select * into j from private.privacy_jobs where request_id=p_request and scope='account' and receipt_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found then raise exception 'Receipt unavailable' using errcode='42501';end if;
 if p_retry and j.state='failed' and j.updated_at<now()-interval '1 minute' then update private.privacy_jobs set state=case when phase='external' then 'waiting_external' else 'queued' end,attempts=0,next_attempt_at=now(),updated_at=now(),last_code=null where id=j.id returning * into j;end if;
 return jsonb_build_object('id',j.id,'scope',j.scope,'state',j.state,'phase',j.phase,'counts',j.counts,'last_code',j.last_code,'created_at',j.created_at,'updated_at',j.updated_at,'completed_at',j.completed_at);
end $$;
create function public.privacy_own_deletion_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 if not private.auth_session_is_active() then raise exception 'Session unavailable' using errcode='42501';end if;o:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
 return (select jsonb_build_object('id',id,'scope',scope,'state',state,'phase',phase,'counts',counts,'last_code',last_code,'created_at',created_at,'updated_at',updated_at,'completed_at',completed_at) from private.privacy_jobs where owner_id=o and scope='account' order by created_at desc limit 1);
end $$;
-- Bounded durable work, invoked by the existing worker, not a browser timer.
create function private.privacy_work_v1(p_action text,p_job uuid default null,p_lease uuid default null,p_count integer default 0,p_code text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.privacy_jobs;o uuid;n integer:=0;remaining boolean:=false;total integer:=0;t public.tasks;x integer;
begin
 perform pg_advisory_xact_lock(735194002::bigint);
 if p_action='claim' then
  -- Re-select only eligible work; completed jobs must never starve pending work.
  select * into j from private.privacy_jobs where (p_job is null or id=p_job) and state in ('queued','running','failed') and phase<>'external' and attempts<8 and next_attempt_at<=now() and (lease_until is null or lease_until<=now()) order by next_attempt_at,id for update skip locked limit 1;
  if not found then return 'null';end if;
  update private.privacy_jobs set state='running',lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now() where id=j.id returning * into j;return jsonb_build_object('id',j.id,'owner_id',j.owner_id,'scope',j.scope,'lease',j.lease,'phase',j.phase);
 end if;
 select * into j from private.privacy_jobs where id=p_job and lease=p_lease and lease_until>now() and state='running' for update;
 if not found then raise exception 'Privacy lease unavailable' using errcode='40001';end if;o:=j.owner_id;
 perform 1 from public.privacy_preferences where owner_id=o for update;
 if p_action='failed' then
  update private.privacy_jobs set attempts=attempts+1,state=case when attempts+1>=8 then 'failed' else 'queued' end,last_code=case when p_code='queue_unavailable' then p_code else 'cleanup_unavailable' end,next_attempt_at=now()+make_interval(secs=>least(3600,10*power(2,attempts)::integer)),lease=null,lease_until=null,updated_at=now() where id=j.id;return '{}';
 elsif p_action='queue_done' then
  update private.privacy_jobs set counts=jsonb_set(counts,'{queue_jobs}',to_jsonb(coalesce((counts->>'queue_jobs')::integer,0)+greatest(0,least(p_count,100)))),phase=case when p_count=0 then 'finish' else 'queue' end,lease=null,lease_until=null,next_attempt_at=now(),updated_at=now() where id=j.id;return '{}';
 elsif p_action<>'purge' then raise exception 'Unsupported privacy work' using errcode='22023';end if;
 if j.scope in ('tasks_reminders','account') and exists(select 1 from public.delivery_attempts where owner_id=o and state='sending' and lease_until>now()) then
  update private.privacy_jobs set next_attempt_at=now()+interval '10 seconds',lease=null,lease_until=null,updated_at=now() where id=j.id;return jsonb_build_object('wait_inflight',true);
 end if;
 if j.phase='finish' then
  update private.privacy_jobs set state=case when scope='account' then 'waiting_external' else 'complete' end,phase=case when scope='account' then 'external' else 'complete' end,completed_at=case when scope='account' then null else now() end,last_code=null,lease=null,lease_until=null,updated_at=now() where id=j.id;
  insert into private.privacy_events(owner_id,event,counts) values(o,'bulk_content_cleanup',j.counts);return '{}';
 end if;
 if j.scope in ('history','account') then
  delete from public.conversations where id in(select id from public.conversations where owner_id=o order by id limit 1);get diagnostics n=row_count;total:=total+n;
  remaining:=exists(select 1 from public.conversations where owner_id=o);
  j.counts:=jsonb_set(j.counts,'{conversations}',to_jsonb(coalesce((j.counts->>'conversations')::integer,0)+n));
 end if;
 if j.scope in ('memories','account') then
  update public.messages set assistant_text='',state=case when state='complete' then 'redacted' when state='running' then 'cancelled' else state end,used_memories='[]' where id in(select id from public.messages where owner_id=o and used_memories<>'[]'::jsonb order by id limit 50);get diagnostics n=row_count;total:=total+n;
  remaining:=remaining or exists(select 1 from public.messages where owner_id=o and used_memories<>'[]'::jsonb);
  update public.memory_proposals set content='',state='deleted',version=version+1 where id in(select id from public.memory_proposals where owner_id=o and (content<>'' or state='pending') order by id limit 50);get diagnostics n=row_count;total:=total+n;
  remaining:=remaining or exists(select 1 from public.memory_proposals where owner_id=o and (content<>'' or state='pending'));
  update public.memories set content='',state='deleted',version=version+1,updated_at=now() where id in(select id from public.memories where owner_id=o and content<>'' order by id limit 50);get diagnostics n=row_count;total:=total+n;
  remaining:=remaining or exists(select 1 from public.memories where owner_id=o and content<>'');
 end if;
 if j.scope in ('tasks_reminders','account') then
  for t in select * from public.tasks where owner_id=o order by id for update limit 25 loop perform private.task_cancel_links_v1(t.id);delete from public.tasks where id=t.id;total:=total+1;end loop;
  update private.personal_integrations set channel_test_id=null where owner_id=o;
  delete from public.reminders where id in(select id from public.reminders where owner_id=o order by id limit 50);get diagnostics n=row_count;total:=total+n;
  -- Series FK is not cascading: remove only series with no remaining occurrences.
  delete from public.reminder_series where id in(select s.id from public.reminder_series s where s.owner_id=o and not exists(select 1 from public.reminders r where r.series_id=s.id) order by s.id limit 25);get diagnostics n=row_count;total:=total+n;
  delete from public.task_operations where id in(select id from public.task_operations where owner_id=o order by id limit 100);get diagnostics n=row_count;total:=total+n;
  remaining:=remaining or exists(select 1 from public.tasks where owner_id=o) or exists(select 1 from public.reminders where owner_id=o) or exists(select 1 from public.reminder_series where owner_id=o) or exists(select 1 from public.task_operations where owner_id=o);
 end if;
 j.counts:=jsonb_set(j.counts,'{content_rows}',to_jsonb(coalesce((j.counts->>'content_rows')::integer,0)+total));
 update private.privacy_jobs set counts=j.counts,phase=case when remaining then 'content' when scope in ('tasks_reminders','account') then 'queue' else 'finish' end,lease=null,lease_until=null,next_attempt_at=now(),updated_at=now() where id=j.id;
 return jsonb_build_object('rows',total);
end $$;
-- Keep retention on the established worker maintenance path; bounded counts only.
create or replace function private.m2c_cleanup_v1(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c integer;p integer;r integer;a integer;
begin
 perform pg_advisory_xact_lock(735194002::bigint);
 delete from public.conversations where id in(select id from public.conversations where expires_at<=now() and (p_owner is null or owner_id=p_owner) order by expires_at limit 1);get diagnostics c=row_count;
 update public.memory_proposals set content='',state='rejected',version=version+1 where id in(select id from public.memory_proposals where state='pending' and created_at<now()-interval '7 days' and (p_owner is null or owner_id=p_owner) order by created_at limit 50);get diagnostics p=row_count;
 delete from public.reminders where id in(select r.id from public.reminders r where r.state in ('cancelled','expired','failed','outcome_unknown','simulated_acceptance','provider_accepted','missed','skipped') and r.finished_at<now()-interval '30 days' and (p_owner is null or owner_id=p_owner) and not exists(select 1 from private.personal_integrations c where c.channel_test_id=r.id) order by r.finished_at limit 20);get diagnostics r=row_count;
 update public.ai_requests set state='unknown',settled_at=now() where id in(select id from public.ai_requests where state in ('reserved','inflight') and lease_until<=now() and (p_owner is null or owner_id=p_owner) order by lease_until limit 100);get diagnostics a=row_count;
 delete from private.privacy_requests where (owner_id,request_id) in(select r.owner_id,r.request_id from private.privacy_requests r where not exists(select 1 from public.privacy_preferences p where p.owner_id=r.owner_id) order by r.retired_at limit 100);
 delete from private.privacy_events where id in(select id from private.privacy_events where created_at<now()-interval '30 days' order by created_at limit 100);
 delete from private.privacy_jobs where id in(select id from private.privacy_jobs where state='complete' and completed_at<now()-interval '30 days' order by completed_at limit 10);
 delete from private.privacy_budget_totals where budget_month<date_trunc('month',now() at time zone 'Asia/Kolkata')::date-interval '13 months' and budget_month<>'1970-01-01';
 if c+p+r+a>0 then insert into private.privacy_events(owner_id,event,counts) values(p_owner,'retention_batch',jsonb_build_object('conversations',c,'proposals',p,'reminders',r,'usage_uncertain',a));end if;
 return jsonb_build_object('conversations_purged',c,'proposals_expired',p,'reminders_purged',r,'usage_uncertain',a);
end $$;
reset role;
-- Existing postgres bridge retains its owner/ACL; no new managed-Auth grant.
create or replace function private.m2b_account_eligible_v1(p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join private.admissions a on a.owner_id=u.id where u.id=p_owner and a.enabled and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<now())) and not exists(select 1 from private.privacy_jobs where owner_id=p_owner and state<>'complete' and scope in ('tasks_reminders','account'));
$$;
set local role jarvis_auth_guard;
create or replace function public.m2c_cleanup_self_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 if private.has_access() is not true then raise exception 'Account unavailable' using errcode='42501';end if;
 o:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;return private.m2c_cleanup_v1(o);
end $$;
alter function private.m2b_worker_v1(text,jsonb,text) rename to m2b_worker_before_privacy_v1;
create function private.m2b_worker_v1(p_action text,p_data jsonb default '{}',p_run text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 perform pg_advisory_xact_lock_shared(735194002::bigint);
 if p_action='claim' then select owner_id into o from public.reminders where id=(p_data->>'reminder_id')::uuid;
 elsif p_action='authorize' then select owner_id into o from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid;
 elsif p_action='series_advance' then select owner_id into o from public.reminder_series where id=(p_data->>'id')::uuid;end if;
 if o is not null then
  perform 1 from public.privacy_preferences where owner_id=o for share;
  if not private.m2b_account_eligible_v1(o) then return case when p_action='claim' then 'null'::jsonb else 'false'::jsonb end;end if;
  if p_action='authorize' and exists(select 1 from public.reminders r join public.delivery_attempts a on a.reminder_id=r.id where a.id=(p_data->>'attempt_id')::uuid and r.channel='pushover') and not private.privacy_cloud_v1(o,'notifications') then return 'false';end if;
 end if;
 return private.m2b_worker_before_privacy_v1(p_action,p_data,p_run);
end $$;
-- Reconcile late queue inserts after erasure; preserve newer legitimate reminders.
create function private.privacy_queue_v1(p_action text,p_job uuid default null,p_cursor uuid default null,p_rows jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.privacy_jobs;result jsonb;
begin
 perform pg_advisory_xact_lock_shared(735194002::bigint);
 if p_action='next' then
  select * into j from private.privacy_jobs where scope in ('account','tasks_reminders') and (state='complete' or phase='external') order by queue_checked_at nulls first,id for update skip locked limit 1;
  if not found then return 'null';end if;update private.privacy_jobs set queue_checked_at=now() where id=j.id;
  return jsonb_build_object('id',j.id,'owner_id',j.owner_id,'cursor',j.queue_cursor);
 end if;
 select * into j from private.privacy_jobs where id=p_job and scope in ('account','tasks_reminders') and (state='complete' or phase='external') for update;
 if not found then raise exception 'Queue receipt unavailable' using errcode='42501';end if;
 if p_action='checkpoint' then update private.privacy_jobs set queue_cursor=p_cursor where id=j.id;return '{}';end if;
 if p_action<>'filter' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'Queue page invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(x->>'job_id'),'[]') into result from jsonb_array_elements(p_rows) x where not exists(select 1 from public.reminders r where r.id=(x->>'reminder_id')::uuid and r.owner_id=j.owner_id);
 return result;
end $$;
-- Whitelisted export projection. No caller-supplied SQL, owner or column list.
create function public.privacy_export_v1(p_category text,p_after uuid default null,p_at timestamptz default now(),p_epoch bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();tab text;cols text;keycol text:='id';extra text:='';rows jsonb;
begin
 if not private.privacy_recent_v1() then raise exception 'Recent password authentication required' using errcode='42501';end if;
 if p_at is null or p_at>now()+interval '30 seconds' or p_at<now()-interval '5 minutes' then raise exception 'Export window expired' using errcode='22023';end if;
 if p_epoch is distinct from (select epoch from public.privacy_preferences where owner_id=o) then raise exception 'Privacy state changed during export' using errcode='40001';end if;
 if p_category='profile' and p_after is null then
  perform pg_advisory_xact_lock(hashtextextended(o::text,9));
  if (select count(*) from private.privacy_events where owner_id=o and event='export_started' and created_at>now()-interval '1 minute')>=3 then raise exception 'Export rate limit' using errcode='54000';end if;
  insert into private.privacy_events(owner_id,event) values(o,'export_started');
 end if;
 case p_category
 when 'profile' then return jsonb_build_object('rows','[]'::jsonb); -- Web uses the already verified ordinary-user profile, not a new guard SELECT grant.
 when 'privacy_settings' then tab:='privacy_preferences';keycol:='owner_id';cols:='owner_id as id,text_cloud,notifications,retention_days,version,updated_at';
 when 'voice_settings' then tab:='voice_preferences';keycol:='owner_id';cols:='owner_id as id,cloud_transcription,consent_version,updated_at';
 when 'conversations' then tab:='conversations';cols:='id,title,created_at,expires_at';extra:=' and expires_at>now() and created_at<=$3';
 when 'messages' then tab:='messages';cols:='id,conversation_id,user_text,assistant_text,state,created_at';extra:=' and created_at<=$3 and exists(select 1 from public.conversations c where c.id=x.conversation_id and c.owner_id=x.owner_id and c.expires_at>now())';
 when 'memory_proposals' then tab:='memory_proposals';cols:='id,source_message_id,content,state,version,created_at,origin,conflict_memory_id';extra:=' and created_at<=$3 and exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id and c.owner_id=m.owner_id where m.id=x.source_message_id and m.owner_id=x.owner_id and c.expires_at>now())';
 when 'memories' then tab:='memories';cols:='id,content,state,version,source_date,source_kind,approved_at,updated_at,supersedes_id,case when exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id and c.owner_id=m.owner_id where m.id=x.source_message_id and m.owner_id=x.owner_id and c.expires_at>now()) then source_message_id else null end as source_message_id';extra:=' and approved_at<=$3';
 when 'tasks' then tab:='tasks';cols:='id,title,notes,state,version,due_kind,due_date,due_local_datetime,due_timezone,due_at,due_resolution,review,review_version,linked_reminder_id,reminder_review_id,created_at,updated_at,completed_at,cancelled_at';extra:=' and created_at<=$3';
 when 'reminder_series' then tab:='reminder_series';cols:='id,state,schedule,review,version,review_version,cursor_date,cursor_due_at,created_at,updated_at';extra:=' and created_at<=$3';
 when 'reminders' then tab:='reminders';cols:='id,title,local_datetime,timezone,due_at,resolution,channel,state,version,task_id,series_id,series_version,occurrence_date,nominal_due_at,created_at,confirmed_at,scheduled_at,finished_at,cancel_requested_at';extra:=' and created_at<=$3';
 when 'delivery_history' then tab:='delivery_attempts';cols:='id,reminder_id,ordinal,state,started_at,send_started_at,finished_at,phone_observed,phone_observed_at';extra:=' and started_at<=$3';
 when 'usage' then tab:='ai_requests';cols:='id,purpose,model,budget_month,price_version,reserved_paise,charged_paise,state,created_at,dispatched_at,settled_at,input_tokens,output_tokens,cached_tokens,write30_tokens,write12_tokens,reasoning_tokens,audio_milliseconds,reported_audio_seconds';extra:=' and created_at<=$3';
 else raise exception 'Unknown export category' using errcode='22023';end case;
 execute format('select coalesce(jsonb_agg(to_jsonb(y)),''[]'') from (select %s from public.%I x where owner_id=$1 and ($2 is null or %I>$2) %s order by %I limit 100) y',cols,tab,keycol,extra,keycol) into rows using o,p_after,p_at;
 return jsonb_build_object('rows',rows);
end $$;
reset role;
-- Local finalizer only: fixed pending jobs, no arbitrary owner deletion argument.
-- Uses existing postgres operator rights; never granted to API or reminder worker.
create function private.privacy_finalize_v1(p_action text,p_job uuid default null,p_lease uuid default null,p_code text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.privacy_jobs;
begin
 perform pg_advisory_xact_lock(735194002::bigint);
 if p_action='retry' then
  update private.privacy_jobs set state=case when phase='external' then 'waiting_external' else 'queued' end,attempts=0,next_attempt_at=now(),last_code=null,lease=null,lease_until=null,updated_at=now() where id=p_job and scope='account' and state='failed';
  if not found then raise exception 'Incomplete account job unavailable' using errcode='22023';end if;return '{}';
 end if;
 if p_action='claim' then
  select * into j from private.privacy_jobs where (p_job is null or id=p_job) and scope='account' and phase='external' and state in ('waiting_external','failed') and attempts<8 and next_attempt_at<=now() and (lease_until is null or lease_until<=now()) order by created_at for update skip locked limit 1;
  if not found then return 'null';end if;
  update private.privacy_jobs set state='waiting_external',lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id returning * into j;return jsonb_build_object('id',j.id,'owner_id',j.owner_id,'lease',j.lease);
 end if;
 select * into j from private.privacy_jobs where id=p_job and lease=p_lease and lease_until>now() and phase='external' for update;
 if not found then raise exception 'Finalizer lease unavailable' using errcode='40001';end if;
 if p_action='prepare' then
  if exists(select 1 from public.conversations where owner_id=j.owner_id) or exists(select 1 from public.tasks where owner_id=j.owner_id) or exists(select 1 from public.reminders where owner_id=j.owner_id) or exists(select 1 from public.reminder_series where owner_id=j.owner_id) then raise exception 'Content cleanup incomplete' using errcode='40001';end if;
  perform pg_advisory_xact_lock(908410237451::bigint);
  if j.budget_moved_at is null then
   insert into private.privacy_budget_totals(scope_id,budget_month,charged_paise)
    select scope_id,budget_month,sum(charged_paise) from public.ai_requests where owner_id=j.owner_id group by scope_id,budget_month
    on conflict(scope_id,budget_month) do update set charged_paise=private.privacy_budget_totals.charged_paise+excluded.charged_paise;
   insert into private.privacy_budget_totals(scope_id,budget_month,evaluation_paise)
    select scope_id,'1970-01-01'::date,sum(charged_paise) from public.ai_requests where owner_id=j.owner_id and purpose='evaluation' group by scope_id
    on conflict(scope_id,budget_month) do update set evaluation_paise=private.privacy_budget_totals.evaluation_paise+excluded.evaluation_paise;
   delete from public.ai_requests where owner_id=j.owner_id;
   update private.privacy_jobs set budget_moved_at=now() where id=j.id;
  end if;
  delete from private.privacy_requests where owner_id=j.owner_id;
  delete from private.personal_integrations where owner_id=j.owner_id;
  delete from public.voice_preferences where owner_id=j.owner_id;
  update public.profiles set display_name='',assistant_name='Assistant',tone='balanced',timezone='UTC',locale='en-IN' where owner_id=j.owner_id;
 elsif p_action='complete' then
  if exists(select 1 from auth.users where id=j.owner_id) then raise exception 'Auth identity still present' using errcode='40001';end if;
  delete from private.privacy_events where owner_id=j.owner_id;
  update private.privacy_jobs set state='complete',phase='complete',completed_at=now(),updated_at=now(),last_code=null,lease=null,lease_until=null where id=j.id;
 elsif p_action='failed' then
  update private.privacy_jobs set state='failed',attempts=attempts+1,last_code=case when p_code='credential_cleanup_failed' then p_code else 'auth_unavailable' end,next_attempt_at=now()+make_interval(secs=>least(3600,10*power(2,attempts)::integer)),updated_at=now(),lease=null,lease_until=null where id=j.id;
 else raise exception 'Unsupported finalizer action' using errcode='22023';end if;return '{}';
end $$;
revoke all on function private.privacy_finalize_v1(text,uuid,uuid,text) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker,jarvis_auth_guard;
grant execute on function private.privacy_finalize_v1(text,uuid,uuid,text) to postgres;
-- Explicitly revoke default PUBLIC and renamed-delegate privileges.
do $$ declare f record;n text;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and (p.proname like 'privacy_%_v1' or p.proname like '%_before_privacy_v1' or p.proname in ('m2b_worker_v1','m2c_ai_policy_v1','m2c_authorize_push_v1','m2c_push_allowed_v1'))) or
 (n.nspname='public' and (p.proname like 'privacy_%_v1' or p.proname in ('task_command_v1','m2b_reminder_v1','reminder_series_v1','m2c_ai_reserve_v1','m2c_ai_account_v1','voice_reserve_v1'))) loop
 if f.proname='privacy_finalize_v1' then continue;end if;
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',f.nspname,f.proname,f.args);
 if f.nspname='public' then execute format('grant execute on function %I.%I(%s) to authenticated',f.nspname,f.proname,f.args);end if;
 end loop;
end $$;
set local role jarvis_auth_guard;
grant execute on function private.m2b_worker_v1(text,jsonb,text),private.privacy_work_v1(text,uuid,uuid,integer,text),private.privacy_queue_v1(text,uuid,uuid,jsonb) to jarvis_reminder_worker;
grant execute on function public.privacy_receipt_v1(uuid,text,boolean) to anon;
reset role;
-- Triggers are not callable as regular RPCs; they preserve ownership on inserts.
do $$ declare n text;begin foreach n in array array['profiles','conversations','messages','memory_proposals','memories','tasks','reminders','reminder_series','ai_requests'] loop
 execute format('create trigger privacy_insert before insert on public.%I for each row execute function private.privacy_insert_v1()',n);
end loop;end $$;
do $$ declare n text;begin foreach n in array array['messages','task_operations','reminder_operations','series_operations'] loop
 execute format('create trigger privacy_retire after delete on public.%I for each row execute function private.privacy_retire_v1()',n);
end loop;end $$;
revoke create on schema public,private from jarvis_auth_guard;
notify pgrst,'reload schema';
