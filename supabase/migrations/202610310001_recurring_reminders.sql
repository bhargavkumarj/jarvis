-- Additive recurrence/snooze. Requires 202610290010; never rewrites applied migrations.
-- Existing reminders are occurrences; series retain calendar intent and history.
create table public.reminder_series (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 version integer not null default 1 check(version>0), state text not null default 'draft' check(state in ('draft','active','paused','cancelled','ended')),
 schedule jsonb not null, review jsonb, review_version integer not null default 1 check(review_version>0),
 cursor_date date, cursor_due_at timestamptz, channel_version uuid, review_channel_version uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),reconciled_at timestamptz,
 unique(id,owner_id),check(octet_length(schedule::text)<=2048),check(octet_length(review::text)<=8192)
);
create table public.series_operations (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 idempotency_key uuid not null,kind text not null check(kind in ('review','confirm','pause','resume','cancel','skip')),
 request_hash text not null,series_id uuid not null,result jsonb not null,created_at timestamptz not null default now(),
 unique(owner_id,idempotency_key),unique(id,owner_id),foreign key(series_id,owner_id) references public.reminder_series(id,owner_id) on delete cascade
);
-- Isolated local fixture scope, matching existing reminder_test_controls. No API setter.
create table private.series_test_controls (
 series_id uuid primary key,owner_id uuid not null,run_id text not null check(run_id ~ '^[a-f0-9]{24}$'),
 foreign key(series_id,owner_id) references public.reminder_series(id,owner_id) on delete cascade
);
alter table private.series_test_controls enable row level security;
revoke all on private.series_test_controls from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select,insert,update,delete on private.series_test_controls to jarvis_auth_guard;
create policy series_fixture_guard on private.series_test_controls to jarvis_auth_guard using(true) with check(true);
alter table public.reminders add column series_id uuid,add column series_version integer,add column occurrence_date date,
 add column nominal_due_at timestamptz,add column dst_adjustment text,add column late_minutes integer;
alter table public.reminders add constraint reminder_series_owner foreign key(series_id,owner_id) references public.reminder_series(id,owner_id);
alter table public.reminders add constraint reminder_occurrence_shape check(
 (series_id is null and series_version is null and occurrence_date is null and nominal_due_at is null and dst_adjustment is null and late_minutes is null)
 or (series_id is not null and series_version>0 and occurrence_date is not null and nominal_due_at is not null and dst_adjustment in ('none','gap_shifted_forward','fold_earlier') and late_minutes between 1 and 60));
create unique index occurrence_identity on public.reminders(series_id,series_version,occurrence_date) where series_id is not null;
alter table public.reminders drop constraint reminders_state_check;
alter table public.reminders add constraint reminders_state_check check(state in ('draft','scheduling_pending','scheduled','attempt_started','retry_scheduled','simulated_acceptance','provider_accepted','failed','outcome_unknown','cancelled','expired','missed','skipped'));
alter table public.reminder_operations drop constraint reminder_operations_kind_check;
alter table public.reminder_operations add constraint reminder_operations_kind_check check(kind in ('review','confirm','cancel','snooze','occurrence'));
do $$ declare t text; begin foreach t in array array['reminder_series','series_operations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role,jarvis_reminder_worker',t);
 execute format('grant select,insert,update,delete on public.%I to jarvis_auth_guard',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy series_guard on public.%I to jarvis_auth_guard using(true) with check(true)',t);
 execute format('create policy series_owned_read on public.%I for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()))',t);
 end loop; end $$;

-- SQL independently checks Temporal results. Unknown tzdb disagreement fails closed.
-- Existing one-time gap rejection remains unchanged.
create function private.rs_occurrence_v1(s jsonb,d date) returns jsonb language plpgsql set search_path='' as $$
declare l timestamp; b timestamptz; f timestamptz; last_t timestamptz; n integer; actual timestamp; off integer; adj text; res text;
begin
 l:=(d::text||'T'||(s->>'local_time')||':00')::timestamp;b:=l at time zone (s->>'timezone');
 select min(t),max(t),count(*) into f,last_t,n from generate_series(b-interval '26 hours',b+interval '26 hours',interval '1 second') t where t at time zone (s->>'timezone')=l;
 if n=0 then f:=b;adj:='gap_shifted_forward';res:='unique';
  if f at time zone (s->>'timezone')<=l then raise exception 'Unsupported timezone transition' using errcode='22023';end if;
 elsif n=1 then adj:='none';res:='unique';
 elsif n=2 then adj:='fold_earlier';res:='earlier';
 else raise exception 'Unsupported timezone transition' using errcode='22023';end if;
 actual:=f at time zone (s->>'timezone');off:=extract(epoch from (actual-(f at time zone 'UTC')))::integer;
 return jsonb_build_object('date',d::text,'local_datetime',to_char(actual,'YYYY-MM-DD"T"HH24:MI:SS'),'due_at',to_char(f at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'offset',(case when off<0 then '-' else '+' end)||lpad((abs(off)/3600)::text,2,'0')||':'||lpad(((abs(off)%3600)/60)::text,2,'0'),'adjustment',adj,'resolution',res);
end $$;
create function private.rs_next_v1(s jsonb,from_date date,after_time timestamptz default null) returns jsonb language plpgsql set search_path='' as $$
declare d date:=greatest(from_date,(s->>'start_date')::date);c jsonb;i integer;
begin
 for i in 1..400 loop
  if s->>'end_date' is not null and d>(s->>'end_date')::date then return null;end if;
  if s->>'frequency'='daily' or (s->'weekdays') @> jsonb_build_array(extract(isodow from d)::integer) then
   c:=private.rs_occurrence_v1(s,d);if after_time is null or (c->>'due_at')::timestamptz>after_time then return c;end if;
  end if;d:=d+1;
 end loop;raise exception 'Calendar bound exceeded' using errcode='22023';
end $$;
create function private.rs_validate_v1(s jsonb) returns void language plpgsql set search_path='' as $$
declare st date;en date;wd integer[];today date;
begin
 if s is null or jsonb_typeof(s)<>'object' or (s-'title'-'frequency'-'weekdays'-'start_date'-'end_date'-'local_time'-'timezone'-'channel'-'dst_policy'-'late_minutes')<>'{}' or
 (jsonb_typeof(s->'title')<>'string' or jsonb_typeof(s->'frequency')<>'string' or jsonb_typeof(s->'start_date')<>'string' or jsonb_typeof(s->'local_time')<>'string' or jsonb_typeof(s->'timezone')<>'string' or jsonb_typeof(s->'channel')<>'string' or jsonb_typeof(s->'late_minutes')<>'number' or jsonb_typeof(s->'end_date') not in ('string','null')) or
 (s->>'title' is null or s->>'frequency' is null or s->>'start_date' is null or s->>'local_time' is null or s->>'timezone' is null or s->>'channel' is null or s->>'dst_policy' is null or s->>'late_minutes' is null) or
 not(s ?& array['title','frequency','weekdays','start_date','end_date','local_time','timezone','channel','dst_policy','late_minutes']) or
 length(btrim(s->>'title')) not between 1 and 120 or (s->>'title') ~ '[[:cntrl:]]' or s->>'frequency' not in ('daily','weekly') or
 s->>'channel' not in ('mock','pushover') or s->>'dst_policy'<>'shift_gap_forward_fold_earlier_v1' or
 (s->>'local_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (s->>'late_minutes')::integer not between 1 and 60 or
 (s->>'start_date') !~ '^\d{4}-\d{2}-\d{2}$' or (s->>'end_date' is not null and (s->>'end_date') !~ '^\d{4}-\d{2}-\d{2}$') or
 (s->>'timezone'<>'UTC' and (position('/' in (s->>'timezone'))=0 or s->>'timezone' ~ '^(posix|right)/')) or
 not exists(select 1 from pg_catalog.pg_timezone_names where name=s->>'timezone') or jsonb_typeof(s->'weekdays')<>'array' then raise exception 'Invalid recurrence' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(s->'weekdays') x where jsonb_typeof(x)<>'number' or x::text !~ '^[1-7]$') then raise exception 'Invalid weekday values' using errcode='22023';end if;
 select array_agg(v::integer order by v::integer) into wd from jsonb_array_elements_text(s->'weekdays') v;
 if cardinality(wd)>7 or exists(select 1 from unnest(wd) x where x not between 1 and 7) or cardinality(wd)<>(select count(distinct x) from unnest(wd) x) or
 (s->>'frequency'='daily' and coalesce(cardinality(wd),0)<>0) or (s->>'frequency'='weekly' and coalesce(cardinality(wd),0)=0) then raise exception 'Invalid weekdays' using errcode='22023';end if;
 st:=(s->>'start_date')::date;en:=(s->>'end_date')::date;today:=(now() at time zone (s->>'timezone'))::date;
 if st<today or st>today+365 or (en is not null and (en<st or en>st+interval '10 years')) then raise exception 'Invalid date horizon' using errcode='22023';end if;
end $$;
-- Outbox rows are fenced when read, without locking existing outbox rows after
-- reminder rows (the enqueuer locks outbox then reminder). Avoid a lock-order cycle.
-- Cancel only unsent work. Already sending is not recalled; its historical outcome survives.
create function private.rs_invalidate_v1(p_series uuid,p_reason text) returns void language plpgsql set search_path='' as $$
declare r public.reminders;
begin
 for r in select * from public.reminders where series_id=p_series and state in ('scheduling_pending','scheduled','retry_scheduled','attempt_started') order by id for update loop
  if exists(select 1 from public.delivery_attempts where reminder_id=r.id and state='sending') then
   update public.reminders set cancel_requested_at=coalesce(cancel_requested_at,now()) where id=r.id;
  else
   update public.reminders set state='cancelled',version=version+1,cancel_requested_at=now(),finished_at=now(),error_code=p_reason where id=r.id;
   update public.delivery_attempts set state='cancelled',finished_at=now() where reminder_id=r.id and state='prepared';
   if r.queue_job_id is not null then insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind,job_id) values(r.owner_id,r.id,r.confirm_operation_id,r.version+1,r.enqueue_generation,'cancel',r.queue_job_id) on conflict do nothing;end if;
  end if;
 end loop;
end $$;
create function private.rs_materialize_v1(s public.reminder_series,c jsonb) returns uuid language plpgsql set search_path='' as $$
declare r public.reminders;op uuid;due timestamptz:=(c->>'due_at')::timestamptz;missed boolean;
begin
 missed:=due+make_interval(mins=>(s.schedule->>'late_minutes')::integer)<=now();
 insert into public.reminders(owner_id,title,local_datetime,timezone,due_at,expires_at,resolution,channel,channel_version,state,confirmed_at,enqueue_generation,
 series_id,series_version,occurrence_date,nominal_due_at,dst_adjustment,late_minutes,error_code,finished_at)
 values(s.owner_id,s.schedule->>'title',c->>'local_datetime',s.schedule->>'timezone',due,due+interval '24 hours',c->>'resolution',s.schedule->>'channel',s.channel_version,
 case when missed then 'missed' else 'scheduling_pending' end,now(),1,s.id,s.version,(c->>'date')::date,due,c->>'adjustment',(s.schedule->>'late_minutes')::integer,
 case when missed then 'recurrence_lateness_elapsed' else null end,case when missed then now() else null end)
 on conflict(series_id,series_version,occurrence_date) where series_id is not null do nothing returning * into r;
 if not found then select id into op from public.reminders where series_id=s.id and series_version=s.version and occurrence_date=(c->>'date')::date;return op;end if;
 insert into public.reminder_operations(owner_id,idempotency_key,kind,request_hash,reminder_id,result)
 values(s.owner_id,gen_random_uuid(),'occurrence',encode(sha256(convert_to(c::text,'UTF8')),'hex'),r.id,jsonb_build_object('series_id',s.id,'series_version',s.version,'date',c->>'date')) returning id into op;
 update public.reminders set confirm_operation_id=op where id=r.id;
 insert into private.reminder_test_controls(reminder_id,owner_id,run_id) select r.id,s.owner_id,t.run_id from private.series_test_controls t where t.series_id=s.id;
 if not missed then insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind) values(s.owner_id,r.id,op,1,1,'schedule');end if;
 return r.id;
end $$;

create function public.reminder_series_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();s public.reminder_series;op public.series_operations;h text;v jsonb;c jsonb;preview jsonb:='[]';d date;i integer;r public.reminders;sch jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,3));
 if p_action is null or p_action not in ('review','confirm','pause','resume','cancel','skip') or p_request is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8192 then raise exception 'Invalid series operation' using errcode='22023';end if;
 h:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
 select * into op from public.series_operations where owner_id=o and idempotency_key=p_request;
 if found then
  if op.kind<>p_action or op.request_hash<>h then raise exception 'Idempotency conflict' using errcode='40001';end if;
  select * into s from public.reminder_series where id=op.series_id and owner_id=o;return jsonb_build_object('series',to_jsonb(s),'operation',to_jsonb(op),'replay',true);
 end if;
 if (select count(*) from public.series_operations where owner_id=o and created_at>now()-interval '1 minute')>=30 then raise exception 'Series rate limit' using errcode='54000';end if;
 if p_data->>'id' is not null then
  select * into s from public.reminder_series where id=(p_data->>'id')::uuid and owner_id=o for update;
  if not found then raise exception 'Not available' using errcode='42501';end if;
  if s.version is distinct from (p_data->>'version')::integer or s.state='cancelled' then raise exception 'Stale series' using errcode='40001';end if;
 elsif p_action<>'review' then raise exception 'Series required' using errcode='22023';end if;
 if p_action='review' then
  if (p_data-'id'-'version'-'schedule'-'preview')<>'{}' then raise exception 'Invalid fields' using errcode='22023';end if;
  sch:=p_data->'schedule';perform private.rs_validate_v1(sch);
  if sch->>'channel'='pushover' and not private.m2c_push_allowed_v1(o) then raise exception 'Channel unavailable' using errcode='42501';end if;
  d:=(sch->>'start_date')::date;
  for i in 1..3 loop c:=private.rs_next_v1(sch,d,now()+interval '5 seconds');exit when c is null;preview:=preview||jsonb_build_array(c);d:=(c->>'date')::date+1;end loop;
  if preview='[]' or preview is distinct from p_data->'preview' then raise exception 'Preview mismatch' using errcode='40001';end if;
  v:=jsonb_build_object('schedule',sch,'preview',preview);
  if s.id is null then
   if (select count(*) from public.reminder_series where owner_id=o)>=50 then raise exception 'Series limit' using errcode='54000';end if;
   insert into public.reminder_series(owner_id,schedule,review,review_channel_version) values(o,sch,v,case when sch->>'channel'='pushover' then (select channel_version from private.personal_integrations where owner_id=o) else null end) returning * into s;
  else update public.reminder_series set review=v,review_channel_version=case when sch->>'channel'='pushover' then (select channel_version from private.personal_integrations where owner_id=o) else null end,review_version=review_version+1,updated_at=now() where id=s.id returning * into s;end if;
 elsif p_action='confirm' then
  if (p_data-'id'-'version'-'review_version'-'review')<>'{}' or s.review is null or (p_data->>'review_version')::integer is distinct from s.review_version or p_data->'review' is distinct from s.review then raise exception 'Exact current review required' using errcode='40001';end if;
  sch:=s.review->'schedule';perform private.rs_validate_v1(sch);
  c:=s.review->'preview'->0;if (c->>'due_at')::timestamptz<=now() then raise exception 'Review time passed' using errcode='40001';end if;
  if sch->>'channel'='pushover' and (not private.m2c_push_allowed_v1(o) or s.review_channel_version is distinct from (select channel_version from private.personal_integrations where owner_id=o)) then raise exception 'Channel changed; review again' using errcode='40001';end if;
  perform private.rs_invalidate_v1(s.id,'series_schedule_changed');
  update public.reminder_series set schedule=sch,state='active',version=version+1,review=null,cursor_date=(c->>'date')::date,cursor_due_at=(c->>'due_at')::timestamptz,
   channel_version=case when sch->>'channel'='pushover' then (select channel_version from private.personal_integrations where owner_id=o) else null end,updated_at=now() where id=s.id returning * into s;
  perform private.rs_materialize_v1(s,c);
 else
  if (p_data-'id'-'version'-'occurrence_id')<>'{}' then raise exception 'Invalid fields' using errcode='22023';end if;
  if p_action='skip' then
   if s.state<>'active' then raise exception 'Series is not active' using errcode='40001';end if;
   select * into r from public.reminders where series_id=s.id and series_version=s.version and state in ('scheduling_pending','scheduled','retry_scheduled','attempt_started') order by nominal_due_at limit 1 for update;
   if not found or r.id is distinct from (p_data->>'occurrence_id')::uuid or exists(select 1 from public.delivery_attempts where reminder_id=r.id and state='sending') then raise exception 'Occurrence changed or already in flight' using errcode='40001';end if;
   update public.reminders set state='skipped',version=version+1,finished_at=now(),cancel_requested_at=now() where id=r.id;
   update public.delivery_attempts set state='cancelled',finished_at=now() where reminder_id=r.id and state='prepared';
   if r.queue_job_id is not null then insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind,job_id) values(o,r.id,r.confirm_operation_id,r.version+1,r.enqueue_generation,'cancel',r.queue_job_id) on conflict do nothing;end if;
   -- Reconciliation immediately makes the next logical occurrence, even if skip was before due.
   update public.reminder_series set cursor_due_at=case when r.occurrence_date=cursor_date then now() else cursor_due_at end,review=null,review_version=review_version+1,updated_at=now() where id=s.id returning * into s;
  elsif p_action='resume' then
   if s.state<>'paused' then raise exception 'Not paused' using errcode='40001';end if;
   c:=private.rs_next_v1(s.schedule,(now() at time zone (s.schedule->>'timezone'))::date,now()+interval '5 seconds');
   update public.reminder_series set state=case when c is null then 'ended' else 'active' end,version=version+1,review=null,review_version=review_version+1,cursor_date=(c->>'date')::date,cursor_due_at=(c->>'due_at')::timestamptz,updated_at=now() where id=s.id returning * into s;
   if c is not null then perform private.rs_materialize_v1(s,c);end if;
  else
   if p_action='pause' and s.state<>'active' then raise exception 'Not active' using errcode='40001';end if;
   perform private.rs_invalidate_v1(s.id,case when p_action='pause' then 'series_paused' else 'series_cancelled' end);
   update public.reminder_series set state=case when p_action='pause' then 'paused' else 'cancelled' end,review=null,review_version=review_version+1,version=version+1,updated_at=now() where id=s.id returning * into s;
  end if;
 end if;
 insert into public.series_operations(owner_id,idempotency_key,kind,request_hash,series_id,result) values(o,p_request,p_action,h,s.id,jsonb_build_object('state',s.state,'version',s.version,'review_version',s.review_version,'schedule',s.schedule,'review',case when p_action='confirm' then p_data->'review' else s.review end)) returning * into op;
 return jsonb_build_object('series',to_jsonb(s),'operation',to_jsonb(op),'replay',false);
end $$;

create function public.reminder_snooze_v1(p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();r public.reminders;s public.reminder_series;op public.reminder_operations;h text;d timestamptz;c jsonb;old_job uuid;previous_due timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,3));
 if p_request is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>2048 or (p_data-'id'-'version'-'due_at'-'local_datetime'-'resolution')<>'{}' then raise exception 'Invalid snooze' using errcode='22023';end if;
 h:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 select * into op from public.reminder_operations where owner_id=o and idempotency_key=p_request;
 if found then
  if op.kind<>'snooze' or op.request_hash<>h then raise exception 'Idempotency conflict' using errcode='40001';end if;
  select * into r from public.reminders where id=op.reminder_id and owner_id=o;return jsonb_build_object('reminder',to_jsonb(r),'operation',to_jsonb(op),'replay',true);
 end if;
 if (select count(*) from public.reminder_operations where owner_id=o and kind='snooze' and created_at>now()-interval '1 minute')>=30 then raise exception 'Snooze rate limit' using errcode='54000';end if;
 -- Series then reminder is the global lock order shared with editing/reconciliation/dispatch.
 select ss.* into s from public.reminder_series ss join public.reminders rr on rr.series_id=ss.id where rr.id=(p_data->>'id')::uuid and rr.owner_id=o for update of ss;
 select * into r from public.reminders where id=(p_data->>'id')::uuid and owner_id=o for update;
 if not found then raise exception 'Not available' using errcode='42501';end if;
 if r.version is distinct from (p_data->>'version')::integer or r.attempt_count>=3 or r.expires_at<=now() or (r.series_id is not null and r.due_at+make_interval(mins=>r.late_minutes)<=now()) or r.state not in ('scheduling_pending','scheduled','retry_scheduled','attempt_started') or r.cancel_requested_at is not null or
 exists(select 1 from public.delivery_attempts where reminder_id=r.id and (send_started_at is not null or state='sending')) then raise exception 'Too late or stale; no send can be recalled' using errcode='40001';end if;
 if r.series_id is not null and (s.state not in ('active','ended') or s.version<>r.series_version) then raise exception 'Inactive series occurrence' using errcode='40001';end if;
 d:=(p_data->>'due_at')::timestamptz;perform private.m2b_check_time_v1(p_data->>'local_datetime',r.timezone,d,p_data->>'resolution');
 if d<=r.due_at or d<now()+interval '5 seconds' or d>now()+interval '365 days' then raise exception 'Snooze must move later within horizon' using errcode='22023';end if;
 if r.series_id is not null then
  c:=private.rs_next_v1(s.schedule,r.occurrence_date+1);
  if c is not null and d>=(c->>'due_at')::timestamptz then raise exception 'Snooze overlaps next occurrence; skip instead' using errcode='22023';end if;
 end if;
 update public.delivery_attempts set state='cancelled',finished_at=now() where reminder_id=r.id and state='prepared';
 old_job:=r.queue_job_id;previous_due:=r.due_at;
 update public.reminders set due_at=d,expires_at=d+interval '24 hours',local_datetime=p_data->>'local_datetime',resolution=p_data->>'resolution',version=version+1,
 state='scheduling_pending',next_attempt_at=null,queue_job_id=null,enqueue_generation=1,scheduled_at=null,error_code=null where id=r.id returning * into r;
 insert into public.reminder_operations(owner_id,idempotency_key,kind,request_hash,reminder_id,result) values(o,p_request,'snooze',h,r.id,jsonb_build_object('state',r.state,'version',r.version,'from_due_at',previous_due,'to_due_at',r.due_at,'local_datetime',r.local_datetime,'timezone',r.timezone)) returning * into op;
 update public.reminders set confirm_operation_id=op.id where id=r.id returning * into r;
 insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind) values(o,r.id,op.id,r.version,1,'schedule');
 -- Old jobs remain harmless by version fencing, and a durable cancel event clears them.
 if old_job is not null then insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind,job_id) values(o,r.id,op.id,r.version,1,'cancel',old_job);end if;
 return jsonb_build_object('reminder',to_jsonb(r),'operation',to_jsonb(op),'replay',false);
end $$;

grant create on schema public,private to jarvis_auth_guard;
-- Retain the existing machinery and its post-send/unknown semantics behind a private delegate.
set local role jarvis_auth_guard;
alter function private.m2b_worker_v1(text,jsonb,text) rename to m2b_worker_before_recurrence_v1;
revoke all on function private.m2b_worker_before_recurrence_v1(text,jsonb,text) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker;
reset role;
create function private.m2b_worker_v1(p_action text,p_data jsonb default '{}',p_run text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.reminder_series;r public.reminders;c jsonb;expected jsonb;v jsonb;result jsonb:='[]';d date;i integer;
begin
 if p_run is not null and p_run !~ '^[a-f0-9]{24}$' then raise exception 'Invalid isolated scope' using errcode='22023';end if;
 if p_action='series_plans' then
  -- Test processes never sweep normal accounts; normal workers exclude fixtures.
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select ss.* from public.reminder_series ss where ss.state='active' and ss.cursor_due_at<=now() and ((p_run is null and not exists(select 1 from private.series_test_controls t where t.series_id=ss.id)) or exists(select 1 from private.series_test_controls t where t.series_id=ss.id and t.run_id=p_run)) order by ss.reconciled_at nulls first,ss.id limit 10) x;
  update public.reminder_series set reconciled_at=now() where id in (select (x->>'id')::uuid from jsonb_array_elements(result) x);return result;
 elsif p_action='series_advance' then
  select * into s from public.reminder_series where id=(p_data->>'id')::uuid for update;
  if not found then return 'false';end if;
  if not ((p_run is null and not exists(select 1 from private.series_test_controls t where t.series_id=s.id)) or exists(select 1 from private.series_test_controls t where t.series_id=s.id and t.run_id=p_run)) then raise exception 'Wrong fixture scope' using errcode='42501';end if;
  if s.state<>'active' or s.version is distinct from (p_data->>'version')::integer or s.cursor_date::text is distinct from p_data->>'cursor_date' or s.cursor_due_at>now() then return 'false';end if;
  if jsonb_typeof(p_data->'candidates')<>'array' or jsonb_array_length(p_data->'candidates') not between 0 and 32 then raise exception 'Bounded calendar batch required' using errcode='22023';end if;
  d:=s.cursor_date+1;i:=0;
  for c in select value from jsonb_array_elements(p_data->'candidates') loop
   expected:=private.rs_next_v1(s.schedule,d);
   if expected is distinct from c then raise exception 'Calendar mismatch' using errcode='22023';end if;
   perform private.rs_materialize_v1(s,c);d:=(c->>'date')::date+1;i:=i+1;
   update public.reminder_series set cursor_date=(c->>'date')::date,cursor_due_at=(c->>'due_at')::timestamptz,updated_at=now() where id=s.id;
   if (c->>'due_at')::timestamptz>now() and i<>jsonb_array_length(p_data->'candidates') then raise exception 'Only one future occurrence' using errcode='22023';end if;
  end loop;
  if i=0 then
   if private.rs_next_v1(s.schedule,d) is not null then raise exception 'Incomplete calendar batch' using errcode='22023';end if;
   update public.reminder_series set state='ended',updated_at=now() where id=s.id;
  end if;return 'true';
 end if;
 if p_action in ('claim','authorize') then
  if p_action='claim' then select ss.* into s from public.reminder_series ss join public.reminders rr on rr.series_id=ss.id where rr.id=(p_data->>'reminder_id')::uuid for update of ss;
  else select ss.* into s from public.reminder_series ss join public.reminders rr on rr.series_id=ss.id join public.delivery_attempts aa on aa.reminder_id=rr.id where aa.id=(p_data->>'attempt_id')::uuid for update of ss;end if;
  if p_action='claim' then select * into r from public.reminders where id=(p_data->>'reminder_id')::uuid for update;
  else select rr.* into r from public.reminders rr join public.delivery_attempts aa on aa.reminder_id=rr.id where aa.id=(p_data->>'attempt_id')::uuid for update of rr;end if;
  if r.series_id is not null and (s.state not in ('active','ended') or s.version<>r.series_version or r.due_at+make_interval(mins=>r.late_minutes)<=now()) then
   if r.state in ('scheduling_pending','scheduled','retry_scheduled','attempt_started') and not exists(select 1 from public.delivery_attempts where reminder_id=r.id and state='sending') then
    update public.reminders set state=case when s.state in ('active','ended') and s.version=r.series_version then 'missed' else 'cancelled' end,version=version+1,finished_at=now(),error_code='series_fence_or_lateness' where id=r.id;
    update public.delivery_attempts set state='cancelled',finished_at=now() where reminder_id=r.id and state='prepared';
   end if;
   return case when p_action='claim' then 'null'::jsonb else 'false'::jsonb end;
  end if;
 end if;
 if p_action='recover' then
  -- Expire unsent occurrences promptly even if their queue entry was lost.
  update public.reminders set state='missed',finished_at=now(),error_code='recurrence_lateness_elapsed' where series_id is not null and state in ('scheduling_pending','scheduled','retry_scheduled') and due_at+make_interval(mins=>late_minutes)<=now() and ((p_run is null and not exists(select 1 from private.reminder_test_controls t where t.reminder_id=public.reminders.id)) or exists(select 1 from private.reminder_test_controls t where t.reminder_id=public.reminders.id and t.run_id=p_run));
 end if;
 v:=private.m2b_worker_before_recurrence_v1(p_action,p_data,p_run);return v;
end $$;

-- A series occurrence cannot be mutated through the older one-time draft boundary.
set local role jarvis_auth_guard;
alter function public.m2b_reminder_v1(text,uuid,jsonb) rename to m2b_reminder_before_recurrence_v1;
revoke all on function public.m2b_reminder_before_recurrence_v1(text,uuid,jsonb) from public,anon,authenticated,service_role,authenticator;
alter function public.m2b_reminder_before_recurrence_v1(text,uuid,jsonb) set schema private;
reset role;
create function public.m2b_reminder_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.reminders where id=(p_data->>'id')::uuid and series_id is not null) then
  perform private.m2a_owner_v1();raise exception 'Use the series or occurrence command' using errcode='42501';end if;
 return private.m2b_reminder_before_recurrence_v1(p_action,p_request,p_data);
end $$;

-- Derived occurrence history must not consume the existing manual one-time quotas.
set local role jarvis_auth_guard;
create or replace function private.m2b_reminder_before_recurrence_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb
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
 if (select count(*) from public.reminder_operations where owner_id=o and kind<>'occurrence' and created_at>now()-interval '1 minute')>=30 then raise exception 'Operation rate limit' using errcode='54000'; end if;
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
   if (select count(*) from public.reminders where owner_id=o and series_id is null and state not in ('cancelled','failed','expired','simulated_acceptance','provider_accepted','outcome_unknown'))>=50 or (select count(*) from public.reminders where owner_id=o and series_id is null)>=1000 then raise exception 'Reminder limit' using errcode='54000'; end if;
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
reset role;

-- Transfer ownership with temporary setup CREATE only. Runtime roles gain no DDL.
grant create on schema public,private to jarvis_auth_guard;
do $$ declare x record;begin
 for x in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname like 'rs_%_v1') or (n.nspname='private' and p.proname='m2b_worker_v1') or
 (n.nspname='public' and p.proname in ('reminder_series_v1','reminder_snooze_v1','m2b_reminder_v1')) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',x.nspname,x.proname,x.args);
 execute format('grant execute on function %I.%I(%s) to jarvis_auth_guard',x.nspname,x.proname,x.args);
 execute format('alter function %I.%I(%s) owner to jarvis_auth_guard',x.nspname,x.proname,x.args);
 end loop;
end $$;
set local role jarvis_auth_guard;
grant execute on function public.reminder_series_v1(text,uuid,jsonb),public.reminder_snooze_v1(uuid,jsonb),public.m2b_reminder_v1(text,uuid,jsonb) to authenticated;
grant execute on function private.m2b_worker_v1(text,jsonb,text) to jarvis_reminder_worker;
reset role;
revoke create on schema public,private from jarvis_auth_guard;
