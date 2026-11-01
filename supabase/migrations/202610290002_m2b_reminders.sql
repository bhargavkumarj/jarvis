-- Additive M2B: domain state, never queue-owned scheduling truth.
create role jarvis_reminder_worker login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create table public.reminders (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 120 and title !~ '[[:cntrl:]]'),
 local_datetime text not null, timezone text not null check(length(timezone) between 1 and 100), due_at timestamptz not null,
 resolution text not null check(resolution in ('unique','earlier','later')), channel text not null default 'mock' check(channel='mock'),
 version integer not null default 1 check(version>0),
 state text not null default 'draft' check(state in ('draft','scheduling_pending','scheduled','attempt_started','retry_scheduled','simulated_acceptance','failed','outcome_unknown','cancelled','expired')),
 created_at timestamptz not null default now(), confirmed_at timestamptz, scheduled_at timestamptz, cancel_requested_at timestamptz, finished_at timestamptz,
 expires_at timestamptz not null, next_attempt_at timestamptz, queue_job_id uuid, enqueue_generation integer not null default 0,
 attempt_count integer not null default 0 check(attempt_count between 0 and 3), error_code text, confirm_operation_id uuid,
 unique(id,owner_id), check(expires_at=due_at+interval '24 hours')
);
create index reminder_pending on public.reminders(state,due_at);
create table public.reminder_operations (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 idempotency_key uuid not null, kind text not null check(kind in ('review','confirm','cancel')), request_hash text not null,
 reminder_id uuid not null, result jsonb not null, created_at timestamptz not null default now(),
 unique(id,owner_id), unique(owner_id,idempotency_key), foreign key(reminder_id,owner_id) references public.reminders(id,owner_id) on delete cascade
);
create unique index reminder_logical_operation on public.reminder_operations(reminder_id,kind) where kind in ('confirm','cancel');
alter table public.reminders add foreign key(confirm_operation_id,owner_id) references public.reminder_operations(id,owner_id) deferrable initially deferred;
create table private.reminder_outbox (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, reminder_id uuid not null, operation_id uuid not null,
 schedule_version integer not null, generation integer not null, kind text not null check(kind in ('schedule','cancel')),
 state text not null default 'pending' check(state in ('pending','enqueued','superseded','failed')), not_before timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, enqueue_count integer not null default 0, job_id uuid, created_at timestamptz not null default now(),
 unique(reminder_id,schedule_version,generation,kind), foreign key(reminder_id,owner_id) references public.reminders(id,owner_id) on delete cascade,
 foreign key(operation_id,owner_id) references public.reminder_operations(id,owner_id) on delete cascade
);
create index outbox_pending on private.reminder_outbox(state,not_before);
create table public.delivery_attempts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, reminder_id uuid not null,
 ordinal integer not null check(ordinal between 1 and 3), job_id uuid not null, schedule_version integer not null,
 state text not null check(state in ('prepared','sending','simulated_acceptance','retryable_rejection','permanent_rejection','outcome_unknown','cancelled','interrupted_before_send')),
 started_at timestamptz not null default now(), send_started_at timestamptz, finished_at timestamptz, lease_until timestamptz not null default now()+interval '20 seconds', error_code text,
 unique(id,owner_id), unique(reminder_id,ordinal), foreign key(reminder_id,owner_id) references public.reminders(id,owner_id) on delete cascade
);
create table private.mock_notification_receipts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, attempt_id uuid not null unique, reminder_id uuid not null,
 payload text not null check(payload='You have a reminder. Open the app to view it.'), accepted_at timestamptz not null default now(),
 foreign key(attempt_id,owner_id) references public.delivery_attempts(id,owner_id) on delete cascade,
 foreign key(reminder_id,owner_id) references public.reminders(id,owner_id) on delete cascade
);
-- Operator-only fault controls; no web/API setter. Normal workers exclude these rows.
create table private.reminder_test_controls (
 reminder_id uuid primary key, owner_id uuid not null, run_id text not null check(run_id ~ '^[a-f0-9]{24}$'),
 scenario text not null default 'accept' check(scenario in ('accept','retry_once','always_retry','permanent','timeout_unknown','pause_before_authorize','pause_after_accept')),
 enqueue_failures integer not null default 0 check(enqueue_failures between 0 and 5),
 foreign key(reminder_id,owner_id) references public.reminders(id,owner_id) on delete cascade
);
do $$ declare s text; t text; begin
 foreach s in array array['public','private'] loop
  foreach t in array case when s='public' then array['reminders','reminder_operations','delivery_attempts'] else array['reminder_outbox','mock_notification_receipts','reminder_test_controls'] end loop
   execute format('alter table %I.%I enable row level security',s,t);
   execute format('revoke all on %I.%I from public,anon,authenticated,service_role,jarvis_reminder_worker',s,t);
   execute format('grant select,insert,update,delete on %I.%I to jarvis_auth_guard',s,t);
   execute format('create policy reminder_guard on %I.%I for all to jarvis_auth_guard using(true) with check(true)',s,t);
   if s='public' then
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy reminder_owned_read on public.%I for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()))',t);
   end if;
  end loop;
 end loop;
end $$;
-- Narrow boolean Auth bridge. It intentionally does not require a live browser session:
-- explicit reminders survive sign-out, while admission disablement/ban blocks dispatch.
create function private.m2b_account_eligible_v1(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join private.admissions a on a.owner_id=u.id
 where u.id=p_owner and a.enabled and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()));
$$;
revoke all on function private.m2b_account_eligible_v1(uuid) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker;
grant execute on function private.m2b_account_eligible_v1(uuid) to jarvis_auth_guard;

create function private.m2b_check_time_v1(p_local text,p_zone text,p_due timestamptz,p_resolution text) returns void
language plpgsql set search_path='' as $$
declare l timestamp; first_due timestamptz; last_due timestamptz; n integer;
begin
 if p_local is null or p_zone is null or p_due is null or p_resolution is null or
 p_local !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$' or
 (p_zone<>'UTC' and (position('/' in p_zone)=0 or p_zone ~ '^(posix|right)/')) or
 not exists(select 1 from pg_timezone_names where name=p_zone) or not isfinite(p_due) then
 raise exception 'Invalid local schedule' using errcode='22023'; end if;
 l:=p_local::timestamp;
 if to_char(l,'YYYY-MM-DD"T"HH24:MI:SS')<>p_local or p_due at time zone p_zone<>l then raise exception 'Schedule mismatch' using errcode='22023'; end if;
 -- Exhaustive bounded second-precision inverse, including non-hour clock changes.
 -- No server-zone default, guessed gap shift, or assumed one-hour overlap.
 select min(t),max(t),count(*) into first_due,last_due,n from generate_series((l at time zone p_zone)-interval '26 hours',(l at time zone p_zone)+interval '26 hours',interval '1 second') t where t at time zone p_zone=l;
 if n not between 1 and 2 or (n=1 and (p_resolution<>'unique' or p_due<>first_due)) or
 (n=2 and not ((p_resolution='earlier' and p_due=first_due) or (p_resolution='later' and p_due=last_due))) then
 raise exception 'Explicit valid DST resolution required' using errcode='22023'; end if;
end $$;
create function private.m2b_snapshot_v1(r public.reminders) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('title',r.title,'local_datetime',r.local_datetime,'timezone',r.timezone,'due_at',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'resolution',r.resolution,'channel',r.channel,'version',r.version);
$$;
-- Single versioned user command boundary. Identity is never an argument.
create function public.m2b_reminder_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb
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
  if (p_data-'title'-'local_datetime'-'timezone'-'due_at'-'resolution'-'id'-'version')<>'{}'::jsonb or
   length(btrim(coalesce(p_data->>'title',''))) not between 1 and 120 then raise exception 'Invalid review' using errcode='22023'; end if;
  d:=(p_data->>'due_at')::timestamptz;
  perform private.m2b_check_time_v1(p_data->>'local_datetime',p_data->>'timezone',d,p_data->>'resolution');
  if d<now()+interval '5 seconds' or d>now()+interval '365 days' then raise exception 'Schedule outside horizon' using errcode='22023'; end if;
  if p_data->>'id' is not null then
   select * into r from public.reminders where id=(p_data->>'id')::uuid and owner_id=o for update;
   if not found then raise exception 'Not available' using errcode='42501'; end if;
   if r.state<>'draft' or r.version is distinct from (p_data->>'version')::integer then raise exception 'Review changed' using errcode='40001'; end if;
   update public.reminders set title=btrim(p_data->>'title'),local_datetime=p_data->>'local_datetime',timezone=p_data->>'timezone',due_at=d,expires_at=d+interval '24 hours',resolution=p_data->>'resolution',version=version+1 where id=r.id returning * into r;
  else
   if (select count(*) from public.reminders where owner_id=o and state not in ('cancelled','failed','expired','simulated_acceptance','outcome_unknown'))>=50 or (select count(*) from public.reminders where owner_id=o)>=1000 then raise exception 'Reminder limit' using errcode='54000'; end if;
   insert into public.reminders(owner_id,title,local_datetime,timezone,due_at,expires_at,resolution) values(o,btrim(p_data->>'title'),p_data->>'local_datetime',p_data->>'timezone',d,d+interval '24 hours',p_data->>'resolution') returning * into r;
  end if;
 else
  if (p_data-'id'-'version'-'snapshot')<>'{}'::jsonb then raise exception 'Invalid fields' using errcode='22023'; end if;
  select * into r from public.reminders where id=(p_data->>'id')::uuid and owner_id=o for update;
  if not found then raise exception 'Not available' using errcode='42501'; end if;
  if r.version is distinct from (p_data->>'version')::integer then raise exception 'Stale reminder' using errcode='40001'; end if;
  if p_action='confirm' then
   snap:=private.m2b_snapshot_v1(r);
   if r.state<>'draft' or p_data->'snapshot' is distinct from snap then raise exception 'Exact reviewed schedule required' using errcode='40001'; end if;
   if r.due_at<=now() then raise exception 'Reviewed time passed' using errcode='22023'; end if;
   update public.reminders set state='scheduling_pending',confirmed_at=now(),enqueue_generation=1 where id=r.id returning * into r;
  else
   if r.state in ('simulated_acceptance','failed','expired','outcome_unknown','cancelled') or r.cancel_requested_at is not null then raise exception 'Already terminal or cancellation requested' using errcode='40001'; end if;
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
-- Worker-only capability. No client JWT, content, arbitrary SQL, or owner setter.
-- Every transaction is short; no provider call occurs inside this function.
create function private.m2b_worker_v1(p_action text,p_data jsonb default '{}',p_run text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reminders; a public.delivery_attempts; e private.reminder_outbox; lease uuid; result jsonb:='[]'; scenario text; item record; outcome text; delay_seconds integer;
begin
 if p_run is not null and p_run !~ '^[a-f0-9]{24}$' then raise exception 'Invalid worker scope' using errcode='22023'; end if;
 if p_action='recover' then
  for a in select x.* from public.delivery_attempts x join public.reminders r on r.id=x.reminder_id
   left join private.reminder_test_controls c on c.reminder_id=r.id
   where x.state in ('prepared','sending') and x.lease_until<=now() and
    ((p_run is null and c.reminder_id is null) or c.run_id=p_run) order by x.lease_until limit 20 loop
   select * into r from public.reminders where id=a.reminder_id for update;
   select * into a from public.delivery_attempts where id=a.id for update;
   if a.state not in ('prepared','sending') or a.lease_until>now() then continue; end if;
   if a.state='sending' then
    outcome:=case when exists(select 1 from private.mock_notification_receipts where attempt_id=a.id) then 'simulated_acceptance' else 'outcome_unknown' end;
    update public.delivery_attempts set state=outcome,finished_at=now(),error_code='process_interrupted_after_authorization' where id=a.id;
    update public.reminders set state=outcome,finished_at=now(),error_code='process_interrupted_after_authorization' where id=r.id;
   else
    update public.delivery_attempts set state='interrupted_before_send',finished_at=now(),error_code='process_interrupted_before_authorization' where id=a.id;
    update public.reminders set state=case when cancel_requested_at is not null then 'cancelled' when attempt_count>=3 then 'failed' else 'retry_scheduled' end,
     next_attempt_at=now(),error_code='process_interrupted_before_authorization' where id=r.id;
   end if;
  end loop;
  -- Unsent reminders expire after a bounded 24-hour catch-up window.
  update public.reminders r set state='expired',finished_at=now(),error_code='catch_up_window_elapsed'
   where r.state in ('scheduling_pending','scheduled','retry_scheduled') and r.expires_at<=now() and
   ((p_run is null and not exists(select 1 from private.reminder_test_controls c where c.reminder_id=r.id)) or exists(select 1 from private.reminder_test_controls c where c.reminder_id=r.id and c.run_id=p_run));
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
   select r.id,r.queue_job_id,r.version from public.reminders r left join private.reminder_test_controls c on c.reminder_id=r.id
   where r.state in ('scheduled','retry_scheduled') and r.queue_job_id is not null and
   ((p_run is null and c.reminder_id is null) or c.run_id=p_run) and not exists(select 1 from private.reminder_outbox e where e.reminder_id=r.id and e.state='pending')
   order by r.due_at limit 50) x;
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
  return jsonb_build_object('attempt_id',a.id,'ordinal',a.ordinal,'scenario',coalesce(scenario,'accept'));
 elsif p_action='authorize' then
  -- Reminder first everywhere to serialize cancellation/dispatch without deadlocks.
  select r0.* into r from public.reminders r0 join public.delivery_attempts a0 on a0.reminder_id=r0.id where a0.id=(p_data->>'attempt_id')::uuid for update of r0;
  select * into a from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid for update;
  if not found or a.state<>'prepared' or a.lease_until<=now() then return 'false'; end if;
  if r.version<>a.schedule_version or r.cancel_requested_at is not null or r.expires_at<=now() or not private.m2b_account_eligible_v1(r.owner_id) then
   update public.delivery_attempts set state='cancelled',finished_at=now() where id=a.id;
   update public.reminders set state=case when cancel_requested_at is not null then 'cancelled' else 'failed' end,finished_at=now(),error_code='dispatch_not_authorized' where id=r.id;
   return 'false';
  end if;
  update public.delivery_attempts set state='sending',send_started_at=now(),lease_until=now()+interval '20 seconds' where id=a.id;
  return 'true';
 elsif p_action='mock_accept' then
  select * into a from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid for update;
  if not found or a.state<>'sending' or a.lease_until<=now() then raise exception 'Attempt fenced' using errcode='40001'; end if;
  insert into private.mock_notification_receipts(owner_id,attempt_id,reminder_id,payload) values(a.owner_id,a.id,a.reminder_id,'You have a reminder. Open the app to view it.') on conflict(attempt_id) do nothing;
  return '{}'::jsonb;
 elsif p_action='finish' then
  select r0.* into r from public.reminders r0 join public.delivery_attempts a0 on a0.reminder_id=r0.id where a0.id=(p_data->>'attempt_id')::uuid for update of r0;
  select * into a from public.delivery_attempts where id=(p_data->>'attempt_id')::uuid for update;
  if not found or a.state<>'sending' then return 'false'; end if;
  outcome:=p_data->>'outcome';
  if outcome not in ('simulated_acceptance','retryable_rejection','permanent_rejection','outcome_unknown') or outcome is null then raise exception 'Invalid outcome' using errcode='22023'; end if;
  if outcome='simulated_acceptance' and not exists(select 1 from private.mock_notification_receipts where attempt_id=a.id) then raise exception 'No valid receipt' using errcode='40001'; end if;
  update public.delivery_attempts set state=outcome,finished_at=now(),error_code=case when outcome='simulated_acceptance' then null else outcome end where id=a.id;
  delay_seconds:=least(30,5*2^(a.ordinal-1)::integer);
  update public.reminders set state=case when outcome='retryable_rejection' and cancel_requested_at is not null then 'cancelled'
   when outcome='retryable_rejection' and attempt_count<3 then 'retry_scheduled' when outcome in ('retryable_rejection','permanent_rejection') then 'failed' else outcome end,
   next_attempt_at=case when outcome='retryable_rejection' then now()+make_interval(secs=>delay_seconds) else null end,
   finished_at=case when outcome='retryable_rejection' and attempt_count<3 and cancel_requested_at is null then null else now() end,
   error_code=case when outcome='simulated_acceptance' then null else outcome end where id=r.id returning * into r;
  return jsonb_build_object('retry',r.state='retry_scheduled');
 end if;
 raise exception 'Unsupported worker capability' using errcode='22023';
end $$;
-- No table/schema creation or managed-Auth access for the runtime principal.
grant usage on schema private to jarvis_reminder_worker;
grant create on schema public,private to jarvis_auth_guard;
do $$ declare f record; begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname like 'm2b_%_v1' and p.proname<>'m2b_account_eligible_v1' loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',f.nspname,f.proname,f.args);
  if f.proname='m2b_reminder_v1' then execute format('grant execute on function %I.%I(%s) to authenticated',f.nspname,f.proname,f.args); end if;
  if f.proname='m2b_worker_v1' then execute format('grant execute on function %I.%I(%s) to jarvis_reminder_worker',f.nspname,f.proname,f.args); end if;
  execute format('alter function %I.%I(%s) owner to jarvis_auth_guard',f.nspname,f.proname,f.args);
 end loop;
end $$;
revoke create on schema public,private from jarvis_auth_guard;
notify pgrst,'reload schema';
