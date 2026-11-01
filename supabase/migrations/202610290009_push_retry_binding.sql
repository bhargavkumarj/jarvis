-- Keep the development burst guard, without suppressing a proven rejected
-- attempt's bounded pg-boss retry. One generic test per credential binding.
grant create on schema private to jarvis_auth_guard;
set local role jarvis_auth_guard;
create or replace function private.m2c_authorize_push_v1(p_reminder public.reminders,p_binding text) returns boolean language plpgsql set search_path='' as $$
declare cfg private.personal_integrations; day_start timestamptz;
begin
 select * into cfg from private.personal_integrations where owner_id=p_reminder.owner_id for update;
 if not found or not cfg.pushover_enabled or cfg.push_binding_hash is distinct from p_binding or p_binding is null or cfg.channel_version is distinct from p_reminder.channel_version then return false; end if;
 day_start:=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
 -- Conservative local development send cap, shared across test + reminders.
 -- Authorization locks this one policy row, preventing concurrent bypass.
 if (select count(*) from public.delivery_attempts a join public.reminders r on r.id=a.reminder_id where r.owner_id=p_reminder.owner_id and r.channel='pushover' and a.send_started_at>=day_start)>=10 or
 exists(select 1 from public.delivery_attempts a join public.reminders r on r.id=a.reminder_id where r.owner_id=p_reminder.owner_id and r.channel='pushover' and a.reminder_id<>p_reminder.id and a.send_started_at>now()-interval '10 seconds') then return false; end if;
 return true;
end $$;
create or replace function private.m2c_channel_test_v1(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.personal_integrations; r public.reminders; op uuid;
begin
 select * into c from private.personal_integrations where owner_id=p_owner for update;
 if not found or not c.pushover_enabled or not private.m2b_account_eligible_v1(p_owner) then raise exception 'Not configured/eligible' using errcode='42501'; end if;
 if c.channel_test_id is not null then select * into r from public.reminders where id=c.channel_test_id and owner_id=p_owner; if r.channel_version=c.channel_version then return to_jsonb(r); end if; end if;
 insert into public.reminders(owner_id,title,local_datetime,timezone,due_at,expires_at,resolution,channel,channel_version,state,confirmed_at,enqueue_generation)
 values(p_owner,'Generic notification channel test',to_char((now()+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),'UTC',now()+interval '1 second',now()+interval '24 hours 1 second','unique','pushover',c.channel_version,'scheduling_pending',now(),1) returning * into r;
 insert into public.reminder_operations(owner_id,idempotency_key,kind,request_hash,reminder_id,result) values(p_owner,gen_random_uuid(),'confirm','operator_generic_channel_test_v1',r.id,jsonb_build_object('state',r.state,'version',1,'in_flight',false,'saved',true)) returning id into op;
 update public.reminders set confirm_operation_id=op where id=r.id returning * into r;
 insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind) values(p_owner,r.id,op,1,1,'schedule');
 update private.personal_integrations set channel_test_id=r.id where owner_id=p_owner;
 return to_jsonb(r);
end $$;


reset role;
revoke create on schema private from jarvis_auth_guard;
