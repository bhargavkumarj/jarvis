-- Additive repair after 42702 during worker setup. No grant/Auth change.
grant create on schema private to jarvis_auth_guard;
set local role jarvis_auth_guard;
create or replace function private.m2b_worker_v1(p_action text,p_data jsonb default '{}',p_run text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reminders; a public.delivery_attempts; e private.reminder_outbox; lease uuid; result jsonb:='[]'; scenario text; item record; outcome text; delay_seconds integer;
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
   order by rr.due_at limit 50) x;
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

revoke all on function private.m2b_worker_v1(text,jsonb,text) from public,anon,authenticated,service_role,authenticator;
grant execute on function private.m2b_worker_v1(text,jsonb,text) to jarvis_reminder_worker;

reset role;
revoke create on schema private from jarvis_auth_guard;
