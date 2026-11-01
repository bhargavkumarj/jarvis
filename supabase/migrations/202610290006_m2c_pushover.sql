-- Additive M2C. Old mock reminders keep channel='mock', including queued jobs.
create table private.personal_integrations (
 singleton boolean primary key default true check(singleton),
 owner_id uuid not null unique references public.profiles(owner_id) on delete cascade,
 pushover_enabled boolean not null default false, ai_enabled boolean not null default false,
 push_binding_hash text, channel_version uuid not null default gen_random_uuid(),
 channel_test_id uuid, configured_at timestamptz not null default now(),
 foreign key(channel_test_id,owner_id) references public.reminders(id,owner_id) deferrable initially deferred
);
alter table private.personal_integrations enable row level security;
revoke all on private.personal_integrations from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select,insert,update on private.personal_integrations to jarvis_auth_guard;
create policy integrations_guard on private.personal_integrations to jarvis_auth_guard using(true) with check(true);
alter table public.reminders drop constraint reminders_channel_check;
alter table public.reminders add constraint reminders_channel_check check(channel in ('mock','pushover'));
alter table public.reminders add column channel_version uuid;
alter table public.reminders drop constraint reminders_state_check;
alter table public.reminders add constraint reminders_state_check check(state in ('draft','scheduling_pending','scheduled','attempt_started','retry_scheduled','simulated_acceptance','provider_accepted','failed','outcome_unknown','cancelled','expired'));
alter table public.delivery_attempts drop constraint delivery_attempts_state_check;
alter table public.delivery_attempts add constraint delivery_attempts_state_check check(state in ('prepared','sending','simulated_acceptance','provider_accepted','retryable_rejection','permanent_rejection','outcome_unknown','cancelled','interrupted_before_send'));
alter table public.delivery_attempts add column provider_reference text;
alter table public.delivery_attempts add column phone_observed boolean;
alter table public.delivery_attempts add column phone_observed_at timestamptz;
alter table public.delivery_attempts add column observation_recorded_at timestamptz;
create table private.notification_acceptances (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,attempt_id uuid not null unique,reminder_id uuid not null,
 provider text not null check(provider='pushover'),reference text not null check(reference ~ '^[A-Za-z0-9-]{1,100}$'),accepted_at timestamptz not null default now(),
 foreign key(attempt_id,owner_id) references public.delivery_attempts(id,owner_id) on delete cascade,
 foreign key(reminder_id,owner_id) references public.reminders(id,owner_id) on delete cascade
);
alter table private.notification_acceptances enable row level security;
revoke all on private.notification_acceptances from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select,insert on private.notification_acceptances to jarvis_auth_guard;
create policy acceptance_guard on private.notification_acceptances to jarvis_auth_guard using(true) with check(true);
create function private.m2c_push_allowed_v1(p_owner uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.personal_integrations where owner_id=p_owner and pushover_enabled);
$$;
create function private.m2c_authorize_push_v1(p_reminder public.reminders,p_binding text) returns boolean language plpgsql set search_path='' as $$
declare cfg private.personal_integrations; day_start timestamptz;
begin
 select * into cfg from private.personal_integrations where owner_id=p_reminder.owner_id for update;
 if not found or not cfg.pushover_enabled or cfg.push_binding_hash is distinct from p_binding or p_binding is null or cfg.channel_version is distinct from p_reminder.channel_version then return false; end if;
 day_start:=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
 -- Conservative local development send cap, shared across test + reminders.
 -- Authorization locks this one policy row, preventing concurrent bypass.
 if (select count(*) from public.delivery_attempts a join public.reminders r on r.id=a.reminder_id where r.owner_id=p_reminder.owner_id and r.channel='pushover' and a.send_started_at>=day_start)>=10 or
 exists(select 1 from public.delivery_attempts a join public.reminders r on r.id=a.reminder_id where r.owner_id=p_reminder.owner_id and r.channel='pushover' and a.send_started_at>now()-interval '10 seconds') then return false; end if;
 return true;
end $$;
create function public.m2c_capabilities_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); c private.personal_integrations;
begin
 select * into c from private.personal_integrations where owner_id=o;
 return jsonb_build_object('pushover_enabled',coalesce(c.pushover_enabled,false),'ai_enabled',coalesce(c.ai_enabled,false));
end $$;
create function public.m2c_observe_phone_v1(p_attempt uuid,p_observed boolean,p_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); a public.delivery_attempts;
begin
 select d.* into a from public.delivery_attempts d join public.reminders r on r.id=d.reminder_id and r.owner_id=d.owner_id
 where d.id=p_attempt and d.owner_id=o and r.channel='pushover' for update of d;
 if not found then raise exception 'Not available' using errcode='42501'; end if;
 if a.state not in ('provider_accepted','outcome_unknown') or p_observed is null or p_at is null or p_at<a.started_at-interval '5 minutes' or p_at>now()+interval '5 minutes' then raise exception 'Invalid observation' using errcode='22023'; end if;
 update public.delivery_attempts set phone_observed=p_observed,phone_observed_at=case when p_observed then p_at else null end,observation_recorded_at=now() where id=a.id;
end $$;
-- Operator-only: one generic channel test for this binding, never a web bypass.
create function private.m2c_channel_test_v1(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.personal_integrations; r public.reminders; op uuid;
begin
 select * into c from private.personal_integrations where owner_id=p_owner for update;
 if not found or not c.pushover_enabled or not private.m2b_account_eligible_v1(p_owner) then raise exception 'Not configured/eligible' using errcode='42501'; end if;
 if c.channel_test_id is not null then select * into r from public.reminders where id=c.channel_test_id and owner_id=p_owner; return to_jsonb(r); end if;
 insert into public.reminders(owner_id,title,local_datetime,timezone,due_at,expires_at,resolution,channel,channel_version,state,confirmed_at,enqueue_generation)
 values(p_owner,'Generic notification channel test',to_char((now()+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),'UTC',now()+interval '1 second',now()+interval '24 hours 1 second','unique','pushover',c.channel_version,'scheduling_pending',now(),1) returning * into r;
 insert into public.reminder_operations(owner_id,idempotency_key,kind,request_hash,reminder_id,result) values(p_owner,gen_random_uuid(),'confirm','operator_generic_channel_test_v1',r.id,jsonb_build_object('state',r.state,'version',1,'in_flight',false,'saved',true)) returning id into op;
 update public.reminders set confirm_operation_id=op where id=r.id returning * into r;
 insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind) values(p_owner,r.id,op,1,1,'schedule');
 update private.personal_integrations set channel_test_id=r.id where owner_id=p_owner;
 return to_jsonb(r);
end $$;

grant create on schema public,private to jarvis_auth_guard;
do $$ declare f record; begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'm2c_%_v1' loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',f.nspname,f.proname,f.args);
  if f.nspname='public' then execute format('grant execute on function %I.%I(%s) to authenticated',f.nspname,f.proname,f.args); end if;
  if f.proname='m2c_channel_test_v1' then execute format('grant execute on function %I.%I(%s) to postgres',f.nspname,f.proname,f.args); end if;
  execute format('alter function %I.%I(%s) owner to jarvis_auth_guard',f.nspname,f.proname,f.args);
 end loop;
end $$;
set local role jarvis_auth_guard;
create or replace function public.m2b_reminder_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); r public.reminders; op public.reminder_operations; h text; d timestamptz; snap jsonb; flight boolean:=false;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,3));
 if p_request is null or p_action is null or p_action not in ('review','confirm','cancel') or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>4096 then raise exception 'Invalid operation' using errcode='22023'; end if;
 h:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
 select * into op from public.reminder_operations where owner_id=o and idempotency_key=p_request;
 if found then
  if op.kind<>p_action or op.request_hash<>h then raise exception 'Idempotency conflict' using errcode='40001'; end if;
  select * into r from public.reminders where id=op.reminder_id and owner_id=o;
  return jsonb_build_object('reminder',to_jsonb(r),'operation',to_jsonb(op),'replay',true);
 end if;
 if (select count(*) from public.reminder_operations where owner_id=o and created_at>now()-interval '1 minute')>=30 then raise exception 'Operation rate limit' using errcode='54000'; end if;
 if p_action='review' then
  if (p_data-'title'-'local_datetime'-'timezone'-'due_at'-'resolution'-'id'-'version'-'channel')<>'{}'::jsonb or
   length(btrim(coalesce(p_data->>'title',''))) not between 1 and 120 then raise exception 'Invalid review' using errcode='22023'; end if;
  if coalesce(p_data->>'channel','mock') not in ('mock','pushover') or (p_data->>'channel'='pushover' and not private.m2c_push_allowed_v1(o)) then raise exception 'Channel not available' using errcode='42501'; end if;
  d:=(p_data->>'due_at')::timestamptz;
  perform private.m2b_check_time_v1(p_data->>'local_datetime',p_data->>'timezone',d,p_data->>'resolution');
  if d<now()+interval '5 seconds' or d>now()+interval '365 days' then raise exception 'Schedule outside horizon' using errcode='22023'; end if;
  if p_data->>'id' is not null then
   select * into r from public.reminders where id=(p_data->>'id')::uuid and owner_id=o for update;
   if not found then raise exception 'Not available' using errcode='42501'; end if;
   if r.state<>'draft' or r.version is distinct from (p_data->>'version')::integer then raise exception 'Review changed' using errcode='40001'; end if;
   update public.reminders set title=btrim(p_data->>'title'),local_datetime=p_data->>'local_datetime',timezone=p_data->>'timezone',due_at=d,expires_at=d+interval '24 hours',resolution=p_data->>'resolution',channel=coalesce(p_data->>'channel','mock'),channel_version=case when p_data->>'channel'='pushover' then (select channel_version from private.personal_integrations where owner_id=o) else null end,version=version+1 where id=r.id returning * into r;
  else
   if (select count(*) from public.reminders where owner_id=o and state not in ('cancelled','failed','expired','simulated_acceptance','provider_accepted','outcome_unknown'))>=50 or (select count(*) from public.reminders where owner_id=o)>=1000 then raise exception 'Reminder limit' using errcode='54000'; end if;
   insert into public.reminders(owner_id,title,local_datetime,timezone,due_at,expires_at,resolution,channel,channel_version) values(o,btrim(p_data->>'title'),p_data->>'local_datetime',p_data->>'timezone',d,d+interval '24 hours',p_data->>'resolution',coalesce(p_data->>'channel','mock'),case when p_data->>'channel'='pushover' then (select channel_version from private.personal_integrations where owner_id=o) else null end) returning * into r;
  end if;
 else
  if (p_data-'id'-'version'-'snapshot')<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
  select * into r from public.reminders where id=(p_data->>'id')::uuid and owner_id=o for update;
  if not found then raise exception 'Not available' using errcode='42501'; end if;
  if r.version is distinct from (p_data->>'version')::integer then raise exception 'Stale reminder' using errcode='40001'; end if;
  if p_action='confirm' then
   snap:=private.m2b_snapshot_v1(r);
   if r.state<>'draft' or p_data->'snapshot' is distinct from snap then raise exception 'Exact reviewed schedule required' using errcode='40001'; end if;
   if r.channel='pushover' and not exists(select 1 from private.personal_integrations where owner_id=o and pushover_enabled and channel_version=r.channel_version) then raise exception 'Channel changed; review again' using errcode='40001'; end if;
   if r.due_at<=now() then raise exception 'Reviewed time passed' using errcode='22023'; end if;
   update public.reminders set state='scheduling_pending',confirmed_at=now(),enqueue_generation=1 where id=r.id returning * into r;
  else
   if r.state in ('simulated_acceptance','provider_accepted','failed','expired','outcome_unknown','cancelled') or r.cancel_requested_at is not null then raise exception 'Already terminal or cancellation requested' using errcode='40001'; end if;
   flight:=exists(select 1 from public.delivery_attempts where reminder_id=r.id and state='sending');
   update public.reminders set cancel_requested_at=now(),state=case when flight then state else 'cancelled' end,
    version=case when flight then version else version+1 end,finished_at=case when flight then null else now() end where id=r.id returning * into r;
   if not flight then update public.delivery_attempts set state='cancelled',finished_at=now() where reminder_id=r.id and state='prepared'; end if;
  end if;
 end if;
 insert into public.reminder_operations(owner_id,idempotency_key,kind,request_hash,reminder_id,result)
 values(o,p_request,p_action,h,r.id,jsonb_build_object('state',r.state,'version',r.version,'in_flight',flight,'saved',r.confirmed_at is not null)) returning * into op;
 if p_action='confirm' then
  update public.reminders set confirm_operation_id=op.id where id=r.id returning * into r;
  insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind) values(o,r.id,op.id,r.version,r.enqueue_generation,'schedule');
 elsif p_action='cancel' and r.queue_job_id is not null then
  insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind,job_id) values(o,r.id,op.id,r.version,r.enqueue_generation,'cancel',r.queue_job_id);
 end if;
 return jsonb_build_object('reminder',to_jsonb(r),'operation',to_jsonb(op),'replay',false);
end $$;

create or replace function private.m2b_worker_v1(p_action text,p_data jsonb default '{}',p_run text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reminders; a public.delivery_attempts; e private.reminder_outbox; lease uuid; result jsonb:='[]'; scenario text; outcome text; delay_seconds integer;
begin
 if p_run is not null and p_run !~ '^[a-f0-9]{24}$' then raise exception 'Invalid worker scope' using errcode='22023'; end if;
 if p_action='recover' then
  for a in select x.* from public.delivery_attempts x join public.reminders rr on rr.id=x.reminder_id
   left join private.reminder_test_controls c on c.reminder_id=rr.id
   where x.state in ('prepared','sending') and x.lease_until<=now() and
    ((p_run is null and c.reminder_id is null) or c.run_id=p_run) order by x.lease_until limit 20 loop
   select * into r from public.reminders where id=a.reminder_id for update;
   select * into a from public.delivery_attempts where id=a.id for update;
   if a.state not in ('prepared','sending') or a.lease_until>now() then continue; end if;
   if a.state='sending' then
    outcome:=case when exists(select 1 from private.notification_acceptances where attempt_id=a.id) then 'provider_accepted' when exists(select 1 from private.mock_notification_receipts where attempt_id=a.id) then 'simulated_acceptance' else 'outcome_unknown' end;
    if outcome='provider_accepted' and not exists(select 1 from private.notification_acceptances where attempt_id=a.id) then raise exception 'No valid acceptance' using errcode='40001'; end if;
  update public.delivery_attempts set provider_reference=(select reference from private.notification_acceptances where attempt_id=a.id),state=outcome,finished_at=now(),error_code='process_interrupted_after_authorization' where id=a.id;
    update public.reminders set state=outcome,finished_at=now(),error_code='process_interrupted_after_authorization' where id=r.id;
   else
    update public.delivery_attempts set state='interrupted_before_send',finished_at=now(),error_code='process_interrupted_before_authorization' where id=a.id;
    update public.reminders set state=case when cancel_requested_at is not null then 'cancelled' when attempt_count>=3 then 'failed' else 'retry_scheduled' end,
     finished_at=case when cancel_requested_at is not null or attempt_count>=3 then now() else null end,
     next_attempt_at=now(),error_code='process_interrupted_before_authorization' where id=r.id;
   end if;
  end loop;
  -- Unsent reminders expire after a bounded 24-hour catch-up window.
  update public.reminders rr set state='expired',finished_at=now(),error_code='catch_up_window_elapsed'
   where rr.state in ('scheduling_pending','scheduled','retry_scheduled') and rr.expires_at<=now() and
   ((p_run is null and not exists(select 1 from private.reminder_test_controls c where c.reminder_id=rr.id)) or exists(select 1 from private.reminder_test_controls c where c.reminder_id=rr.id and c.run_id=p_run));
  return '{}'::jsonb;
 elsif p_action='outbox' then
  for e in select x.* from private.reminder_outbox x left join private.reminder_test_controls c on c.reminder_id=x.reminder_id
   where x.state='pending' and x.not_before<=now() and (x.lease_until is null or x.lease_until<now()) and
   ((p_run is null and c.reminder_id is null) or c.run_id=p_run) order by x.created_at limit 10 for update of x skip locked loop
   select * into r from public.reminders where id=e.reminder_id for update;
   if e.kind='schedule' and (r.version<>e.schedule_version or r.state not in ('scheduling_pending','scheduled','retry_scheduled') or r.cancel_requested_at is not null) then
    update private.reminder_outbox set state='superseded' where id=e.id; continue;
   end if;
   lease:=gen_random_uuid();
   update private.reminder_outbox set lease_id=lease,lease_until=now()+interval '20 seconds',enqueue_count=enqueue_count+1 where id=e.id;
   if e.kind='schedule' then update public.reminders set queue_job_id=e.id where id=r.id; end if;
   scenario:='accept';
   if p_run is not null then
    if exists(select 1 from private.reminder_test_controls where reminder_id=r.id and run_id=p_run and enqueue_failures>0) then
     update private.reminder_test_controls set enqueue_failures=enqueue_failures-1 where reminder_id=r.id;
     scenario:='enqueue_failure';
    end if;
   end if;
   result:=result||jsonb_build_array(jsonb_build_object('id',e.id,'lease',lease,'kind',e.kind,'reminder_id',r.id,'owner_id',r.owner_id,'version',e.schedule_version,'due_at',greatest(r.due_at,coalesce(r.next_attempt_at,r.due_at)),'job_id',e.job_id,'fault',scenario));
  end loop;
  return result;
 elsif p_action in ('enqueued','enqueue_failed') then
  select * into e from private.reminder_outbox where id=(p_data->>'id')::uuid and lease_id=(p_data->>'lease')::uuid and state='pending' for update;
  if not found then return '{}'::jsonb; end if;
  if p_action='enqueued' then
   update private.reminder_outbox set state='enqueued',lease_until=null where id=e.id;
   if e.kind='schedule' then update public.reminders set state=case when state='scheduling_pending' then 'scheduled' else state end,scheduled_at=coalesce(scheduled_at,now()) where id=e.reminder_id and version=e.schedule_version and queue_job_id=e.id; end if;
  else
   update private.reminder_outbox set state=case when enqueue_count>=8 then 'failed' else 'pending' end,lease_until=null,not_before=now()+make_interval(secs=>least(60,2^least(enqueue_count,5)::integer)) where id=e.id;
   if e.enqueue_count+1>=8 and e.kind='schedule' then update public.reminders set state='failed',finished_at=now(),error_code='enqueue_retry_limit' where id=e.reminder_id and state in ('scheduling_pending','scheduled','retry_scheduled'); end if;
  end if;
  return '{}'::jsonb;
 elsif p_action='jobs' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select rr.id,rr.queue_job_id,rr.version from public.reminders rr left join private.reminder_test_controls c on c.reminder_id=rr.id
   where rr.state in ('scheduled','retry_scheduled') and rr.queue_job_id is not null and
   ((p_run is null and c.reminder_id is null) or c.run_id=p_run) and not exists(select 1 from private.reminder_outbox ee where ee.reminder_id=rr.id and ee.state='pending')
   order by rr.reconciled_at nulls first,rr.created_at limit 50) x;
  update public.reminders set reconciled_at=now() where id in (select (v->>'id')::uuid from jsonb_array_elements(result) v);
  return result;
 elsif p_action='repair' then
  select * into r from public.reminders where id=(p_data->>'id')::uuid and queue_job_id=(p_data->>'job_id')::uuid for update;
  if not found or r.state not in ('scheduled','retry_scheduled') then return '{}'::jsonb; end if;
  if r.enqueue_generation>=3 then update public.reminders set state='failed',finished_at=now(),error_code='queue_repair_limit' where id=r.id;
  else
   update public.reminders set state='scheduling_pending',enqueue_generation=enqueue_generation+1 where id=r.id returning * into r;
   insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind) values(r.owner_id,r.id,r.confirm_operation_id,r.version,r.enqueue_generation,'schedule') on conflict do nothing;
  end if;
  return '{}'::jsonb;
 elsif p_action='claim' then
  select * into r from public.reminders where id=(p_data->>'reminder_id')::uuid and owner_id=(p_data->>'owner_id')::uuid for update;
  if not found or r.queue_job_id is distinct from (p_data->>'job_id')::uuid or r.version is distinct from (p_data->>'version')::integer then return 'null'; end if;
  if not ((p_run is null and not exists(select 1 from private.reminder_test_controls where reminder_id=r.id)) or exists(select 1 from private.reminder_test_controls where reminder_id=r.id and run_id=p_run)) then return 'null'; end if;
  if r.state not in ('scheduling_pending','scheduled','retry_scheduled') or r.cancel_requested_at is not null or r.due_at>now() or r.next_attempt_at>now() then return 'null'; end if;
  if not private.m2b_account_eligible_v1(r.owner_id) or r.expires_at<=now() or r.attempt_count>=3 then
   update public.reminders set state=case when expires_at<=now() then 'expired' else 'failed' end,finished_at=now(),error_code=case when expires_at<=now() then 'catch_up_window_elapsed' else 'account_or_attempt_limit' end where id=r.id;
   return 'null';
  end if;
  if exists(select 1 from public.delivery_attempts where reminder_id=r.id and state in ('prepared','sending')) then return 'null'; end if;
  insert into public.delivery_attempts(owner_id,reminder_id,ordinal,job_id,schedule_version,state) values(r.owner_id,r.id,r.attempt_count+1,r.queue_job_id,r.version,'prepared') returning * into a;
  update public.reminders set state='attempt_started',attempt_count=attempt_count+1 where id=r.id;
  select c.scenario into scenario from private.reminder_test_controls c where c.reminder_id=r.id and c.run_id=p_run;
  return jsonb_build_object('attempt_id',a.id,'ordinal',a.ordinal,'scenario',coalesce(scenario,'accept'),'channel',r.channel,'owner_id',r.owner_id);
 elsif p_action='authorize' then
  -- Reminder first everywhere to serialize cancellation/dispatch without deadlocks.
  select r0.* into r from public.reminders r0 join public.delivery_attempts a0 on a0.reminder_id=r0.id where a0.id=(p_data->>'attempt_id')::uuid for update of r0;
  select * into a from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid for update;
  if not found or a.state<>'prepared' or a.lease_until<=now() then return 'false'; end if;
  if (r.channel='pushover' and not private.m2c_authorize_push_v1(r,p_data->>'binding')) or r.version<>a.schedule_version or r.cancel_requested_at is not null or r.expires_at<=now() or not private.m2b_account_eligible_v1(r.owner_id) then
   update public.delivery_attempts set state='cancelled',finished_at=now() where id=a.id;
   update public.reminders set state=case when cancel_requested_at is not null then 'cancelled' else 'failed' end,finished_at=now(),error_code='dispatch_not_authorized' where id=r.id;
   return 'false';
  end if;
  update public.delivery_attempts set state='sending',send_started_at=now(),lease_until=now()+interval '20 seconds' where id=a.id;
  return 'true';
 elsif p_action='mock_accept' then
  select * into a from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid for update;
  if not found or a.state<>'sending' or a.lease_until<=now() then raise exception 'Attempt fenced' using errcode='40001'; end if;
  if not exists(select 1 from public.reminders where id=a.reminder_id and owner_id=a.owner_id and channel='mock') then raise exception 'Wrong adapter' using errcode='42501'; end if;
  insert into private.mock_notification_receipts(owner_id,attempt_id,reminder_id,payload) values(a.owner_id,a.id,a.reminder_id,'You have a reminder. Open the app to view it.') on conflict(attempt_id) do nothing;
  return '{}'::jsonb;
 elsif p_action='provider_accept' then
  select * into a from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid for update;
  if not found or a.state<>'sending' or a.lease_until<=now() or not exists(select 1 from public.reminders where id=a.reminder_id and owner_id=a.owner_id and channel='pushover') then raise exception 'Attempt fenced' using errcode='40001'; end if;
  insert into private.notification_acceptances(owner_id,attempt_id,reminder_id,provider,reference) values(a.owner_id,a.id,a.reminder_id,'pushover',p_data->>'reference') on conflict(attempt_id) do nothing;
  return '{}'::jsonb;
 elsif p_action='finish' then
  select r0.* into r from public.reminders r0 join public.delivery_attempts a0 on a0.reminder_id=r0.id where a0.id=(p_data->>'attempt_id')::uuid for update of r0;
  select * into a from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid for update;
  if not found or a.state<>'sending' then return 'false'; end if;
  outcome:=p_data->>'outcome';
  if p_data->>'code' is not null and p_data->>'code' !~ '^pushover_[a-z_]{1,60}$' then raise exception 'Invalid code' using errcode='22023'; end if;
  if outcome not in ('simulated_acceptance','provider_accepted','retryable_rejection','permanent_rejection','outcome_unknown') or outcome is null then raise exception 'Invalid outcome' using errcode='22023'; end if;
  if outcome='simulated_acceptance' and not exists(select 1 from private.mock_notification_receipts where attempt_id=a.id) then raise exception 'No valid receipt' using errcode='40001'; end if;
  if outcome='provider_accepted' and not exists(select 1 from private.notification_acceptances where attempt_id=a.id) then raise exception 'No valid acceptance' using errcode='40001'; end if;
  update public.delivery_attempts set provider_reference=(select reference from private.notification_acceptances where attempt_id=a.id),state=outcome,finished_at=now(),error_code=case when outcome in ('simulated_acceptance','provider_accepted') then null else coalesce(p_data->>'code',outcome) end where id=a.id;
  delay_seconds:=least(30,5*2^(a.ordinal-1)::integer);
  update public.reminders set state=case when outcome='retryable_rejection' and cancel_requested_at is not null then 'cancelled'
   when outcome='retryable_rejection' and attempt_count<3 then 'retry_scheduled' when outcome in ('retryable_rejection','permanent_rejection') then 'failed' else outcome end,
   next_attempt_at=case when outcome='retryable_rejection' then now()+make_interval(secs=>delay_seconds) else null end,
   finished_at=case when outcome='retryable_rejection' and attempt_count<3 and cancel_requested_at is null then null else now() end,
   error_code=case when outcome in ('simulated_acceptance','provider_accepted') then null else coalesce(p_data->>'code',outcome) end where id=r.id returning * into r;
  return jsonb_build_object('retry',r.state='retry_scheduled');
 end if;
 raise exception 'Unsupported worker capability' using errcode='22023';
end $$;

reset role;
revoke create on schema public,private from jarvis_auth_guard;
notify pgrst,'reload schema';
