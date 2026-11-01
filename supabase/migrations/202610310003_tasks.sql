-- Focused tasks. Depends on the entire prior chain, including pending 010,
-- 202610310001 recurrence and 202610310002 voice. No prior file is edited.
create table public.tasks (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 120 and title !~ '[[:cntrl:]]'),notes text not null default '' check(length(notes)<=2000),
 state text not null default 'draft' check(state in ('draft','open','completed','cancelled')),version integer not null default 1 check(version>0),
 due_kind text not null default 'none' check(due_kind in ('none','date','instant')),due_date date,due_local_datetime text,due_timezone text,due_at timestamptz,due_resolution text,
 review jsonb,review_version integer not null default 1 check(review_version>0),linked_reminder_id uuid,reminder_review_id uuid,reminder_review jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,cancelled_at timestamptz,
 unique(id,owner_id),check(octet_length(review::text)<=8192),check(octet_length(reminder_review::text)<=2048),
 check((due_kind='none' and due_date is null and due_local_datetime is null and due_timezone is null and due_at is null and due_resolution is null) or
 (due_kind='date' and due_date is not null and due_timezone is not null and due_local_datetime is null and due_at is null and due_resolution is null) or
 (due_kind='instant' and due_date is null and due_local_datetime is not null and due_timezone is not null and due_at is not null and due_resolution is not null and due_resolution in ('unique','earlier','later')))
);
create index tasks_owner_state_date on public.tasks(owner_id,state,due_date);
create index tasks_owner_state_instant on public.tasks(owner_id,state,due_at);
create table public.task_operations (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 request_id uuid not null,kind text not null,request_hash text not null,task_id uuid,task_ref uuid not null,result jsonb not null,created_at timestamptz not null default now(),
 unique(owner_id,request_id),foreign key(task_id,owner_id) references public.tasks(id,owner_id) on delete set null (task_id)
);
alter table public.reminders add column task_id uuid;
alter table public.reminders add constraint reminder_task_owner foreign key(task_id,owner_id) references public.tasks(id,owner_id) on delete set null (task_id);
alter table public.reminders add constraint task_only_one_time check(task_id is null or series_id is null);
alter table public.reminders add unique(id,owner_id,task_id);
alter table public.tasks add foreign key(linked_reminder_id,owner_id,id) references public.reminders(id,owner_id,task_id) on delete set null (linked_reminder_id);
alter table public.tasks add foreign key(reminder_review_id,owner_id,id) references public.reminders(id,owner_id,task_id) on delete set null (reminder_review_id);
alter table public.conversations add column task_focus_id uuid;
alter table public.conversations add foreign key(task_focus_id,owner_id) references public.tasks(id,owner_id) on delete set null (task_focus_id);
create index task_link_history on public.reminders(owner_id,task_id,created_at);
do $$ declare n text;begin foreach n in array array['tasks','task_operations'] loop
 execute format('alter table public.%I enable row level security',n);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role,jarvis_reminder_worker',n);
 execute format('grant select on public.%I to authenticated',n);
 execute format('grant select,insert,update,delete on public.%I to jarvis_auth_guard',n);
 execute format('create policy task_owned_read on public.%I for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()))',n);
 execute format('create policy task_guard on public.%I to jarvis_auth_guard using(true) with check(true)',n);
 end loop;end $$;
create function private.task_check_v1(v jsonb) returns void language plpgsql set search_path='' as $$
declare d date;zone text:=v->>'due_timezone';k text:=v->>'due_kind';
begin
 if v is null or jsonb_typeof(v)<>'object' or (v-'title'-'notes'-'due_kind'-'due_date'-'due_local_datetime'-'due_timezone'-'due_at'-'due_resolution')<>'{}' or not(v ?& array['title','notes','due_kind','due_date','due_local_datetime','due_timezone','due_at','due_resolution']) or
 coalesce(length(btrim(v->>'title')),0) not between 1 and 120 or v->>'title' ~ '[[:cntrl:]]' or jsonb_typeof(v->'title')<>'string' or jsonb_typeof(v->'notes')<>'string' or length(v->>'notes')>2000 or k is null or k not in ('none','date','instant') then raise exception 'Invalid task values' using errcode='22023';end if;
 if k='none' then
  if (v->'due_date')<>'null' or (v->'due_local_datetime')<>'null' or (v->'due_timezone')<>'null' or (v->'due_at')<>'null' or (v->'due_resolution')<>'null' then raise exception 'No-due task has date fields' using errcode='22023';end if;return;
 end if;
 if zone is null or (zone<>'UTC' and (position('/' in zone)=0 or zone ~ '^(posix|right)/')) or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'IANA zone required' using errcode='22023';end if;
 if k='date' then
  if coalesce(v->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$' or (v->'due_at')<>'null' or (v->'due_local_datetime')<>'null' or (v->'due_resolution')<>'null' then raise exception 'Date-only deadline required' using errcode='22023';end if;
  d:=(v->>'due_date')::date;
 else
  if (v->'due_date')<>'null' then raise exception 'Exact deadline has date-only value' using errcode='22023';end if;
  perform private.m2b_check_time_v1(v->>'due_local_datetime',zone,(v->>'due_at')::timestamptz,v->>'due_resolution');d:=(v->>'due_local_datetime')::timestamp::date;
 end if;
 if d<((now() at time zone zone)::date-interval '10 years')::date or d>((now() at time zone zone)::date+interval '10 years')::date then raise exception 'Task date horizon' using errcode='22023';end if;
end $$;
create function private.task_cancel_links_v1(p_task uuid) returns boolean language plpgsql set search_path='' as $$
declare r public.reminders;flight boolean:=false;one_flight boolean;
begin
 -- Caller locks task first; no outbox-row locks after reminder locks.
 for r in select * from public.reminders where task_id=p_task order by id for update loop
  one_flight:=exists(select 1 from public.delivery_attempts where reminder_id=r.id and state='sending');flight:=flight or one_flight;
  if r.state in ('draft','scheduling_pending','scheduled','retry_scheduled','attempt_started') and r.cancel_requested_at is null then
   if one_flight then update public.reminders set cancel_requested_at=now() where id=r.id;
   else
    update public.reminders set state='cancelled',version=version+1,cancel_requested_at=now(),finished_at=now(),error_code='linked_task_closed' where id=r.id;
    update public.delivery_attempts set state='cancelled',finished_at=now() where reminder_id=r.id and state='prepared';
    if r.queue_job_id is not null then insert into private.reminder_outbox(owner_id,reminder_id,operation_id,schedule_version,generation,kind,job_id) values(r.owner_id,r.id,r.confirm_operation_id,r.version+1,r.enqueue_generation,'cancel',r.queue_job_id) on conflict do nothing;end if;
   end if;
  end if;
 end loop;return flight;
end $$;
create function public.task_context_v1(p_query text default null,p_overdue boolean default false,p_focus uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();result jsonb;words text[];
begin
 if length(coalesce(p_query,''))>2000 then raise exception 'Task query limit' using errcode='22023';end if;
 select array_agg(w) into words from regexp_split_to_table(lower(coalesce(p_query,'')),'[^[:alnum:]]+') w where length(w)>=2 and w not in ('add','task','tasks','due','make','mark','complete','completed','reopen','cancel','delete','edit','show','my','overdue','the','this','that','about','it','me','to','remind','tomorrow','today','at','am','pm','please','finish','due');
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
  select t.id,t.title,t.state,t.version,t.due_kind,t.due_date,t.due_local_datetime,t.due_timezone,t.due_at,t.due_resolution
  from public.tasks t where t.owner_id=o and (not p_overdue or (t.state='open' and ((t.due_kind='date' and t.due_date<(now() at time zone t.due_timezone)::date) or (t.due_kind='instant' and t.due_at<=now()))))
  and (p_overdue or t.id=p_focus or lower(t.title)=lower(btrim(p_query)) or (coalesce(cardinality(words),0)>0 and not exists(select 1 from unnest(words) w where position(w in lower(t.title))=0)))
  order by (t.id=p_focus) desc nulls last,t.updated_at desc limit 9) x;
 return jsonb_build_object('candidates',result,'more',jsonb_array_length(result)=9);
end $$;
create function public.task_command_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();t public.tasks;op public.task_operations;h text;v jsonb;review_action text;r public.reminders;old_r public.reminders;rr jsonb;flight boolean:=false;ref uuid;final_state text;conv uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,3));
 if p_request is null or p_action is null or p_action not in ('save','review','confirm','complete','reopen','cancel','delete','reject_review','review_reminder','confirm_reminder','remove_reminder') or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>12288 then raise exception 'Invalid task command' using errcode='22023';end if;
 if (p_data-'id'-'version'-'values'-'review_action'-'review'-'review_version'-'confirm_delete'-'conversation_id'-'schedule'-'reminder_snapshot'-'reminder_review')<>'{}' then raise exception 'Unsupported task fields' using errcode='22023';end if;
 h:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
 select * into op from public.task_operations where owner_id=o and request_id=p_request;
 if found then
  if op.kind<>p_action or op.request_hash<>h then raise exception 'Task idempotency conflict' using errcode='40001';end if;
  select * into t from public.tasks where id=op.task_id and owner_id=o;return jsonb_build_object('task',case when t.id is null then null else to_jsonb(t) end,'operation',to_jsonb(op),'replay',true);
 end if;
 if (select count(*) from public.task_operations where owner_id=o and created_at>now()-interval '1 minute')>=30 then raise exception 'Task rate limit' using errcode='54000';end if;
 if p_data->>'conversation_id' is not null then
  conv:=(p_data->>'conversation_id')::uuid;perform 1 from public.conversations where id=conv and owner_id=o and expires_at>now() for update;
  if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 end if;
 if p_data->>'id' is not null then
  select * into t from public.tasks where id=(p_data->>'id')::uuid and owner_id=o for update;
  if not found then raise exception 'Task unavailable' using errcode='42501';end if;
  if t.version is distinct from (p_data->>'version')::integer then raise exception 'Stale task' using errcode='40001';end if;
 elsif p_action not in ('save','review') then raise exception 'Task identifier required' using errcode='22023';end if;
 if p_action in ('save','review') then
  review_action:=case when p_action='save' then case when t.id is null then 'create' else 'edit' end else p_data->>'review_action' end;
  if review_action is null or review_action not in ('create','edit','complete','reopen','cancel','delete') or (t.id is null and review_action<>'create') or (t.id is not null and review_action='create') then raise exception 'Invalid review action' using errcode='22023';end if;
  if review_action='complete' and t.state<>'open' or review_action='reopen' and t.state not in ('completed','cancelled') or review_action='cancel' and t.state not in ('open','draft') then raise exception 'Task state changed' using errcode='40001';end if;
  if review_action in ('create','edit') then v:=p_data->'values';perform private.task_check_v1(v);else v:=null;end if;
  if t.id is null then
   if (select count(*) from public.tasks where owner_id=o)>=1000 then raise exception 'Task account limit' using errcode='54000';end if;
   insert into public.tasks(owner_id,title,notes,due_kind,due_date,due_local_datetime,due_timezone,due_at,due_resolution,state)
   values(o,v->>'title',v->>'notes',v->>'due_kind',(v->>'due_date')::date,v->>'due_local_datetime',v->>'due_timezone',(v->>'due_at')::timestamptz,v->>'due_resolution',case when p_action='save' then 'open' else 'draft' end) returning * into t;
  end if;
  if p_action='review' then
   update public.tasks set review=jsonb_build_object('action',review_action,'values',v),review_version=review_version+1,updated_at=now() where id=t.id returning * into t;
  else
   update public.tasks set title=v->>'title',notes=v->>'notes',due_kind=v->>'due_kind',due_date=(v->>'due_date')::date,due_local_datetime=v->>'due_local_datetime',due_timezone=v->>'due_timezone',due_at=(v->>'due_at')::timestamptz,due_resolution=v->>'due_resolution',state=case when state='draft' then 'open' else state end,version=version+1,review=null,review_version=review_version+1,updated_at=now() where id=t.id returning * into t;
  end if;
 elsif p_action in ('review_reminder','confirm_reminder','remove_reminder') then
  if p_action<>'remove_reminder' and t.state<>'open' then raise exception 'Only open tasks may schedule reminders' using errcode='40001';end if;
  if p_action='review_reminder' then
   -- New review does not silently move/cancel the active reminder.
   if t.reminder_review_id is not null then
    select * into r from public.reminders where id=t.reminder_review_id for update;
    if r.state='draft' then update public.reminders set state='cancelled',version=version+1,cancel_requested_at=now(),finished_at=now() where id=r.id;end if;
   end if;
   rr:=private.m2b_reminder_before_recurrence_v1('review',p_request,(p_data->'schedule')||jsonb_build_object('title','Task reminder'));
   select * into r from public.reminders where id=(rr->'reminder'->>'id')::uuid and owner_id=o for update;
   if r.state<>'draft' or r.series_id is not null or r.task_id is not null then raise exception 'Invalid task reminder draft' using errcode='40001';end if;
   update public.reminders set task_id=t.id where id=r.id returning * into r;
   select * into old_r from public.reminders where id=t.linked_reminder_id and owner_id=o;
   update public.tasks set reminder_review_id=r.id,reminder_review=jsonb_build_object('reminder_id',r.id,'replaces_id',old_r.id,'replaces_version',old_r.version),version=version+1,review=null,review_version=review_version+1,updated_at=now() where id=t.id returning * into t;
  elsif p_action='confirm_reminder' then
   if t.reminder_review_id is null or t.reminder_review is distinct from p_data->'reminder_review' then raise exception 'Exact linked review required' using errcode='40001';end if;
   select * into r from public.reminders where id=t.reminder_review_id and owner_id=o and task_id=t.id for update;
   if r.state<>'draft' or private.m2b_snapshot_v1(r) is distinct from p_data->'reminder_snapshot' then raise exception 'Stale reminder preview' using errcode='40001';end if;
   if t.linked_reminder_id is not null then
    select * into old_r from public.reminders where id=t.linked_reminder_id and owner_id=o for update;
    if old_r.id::text is distinct from t.reminder_review->>'replaces_id' or old_r.version is distinct from (t.reminder_review->>'replaces_version')::integer then raise exception 'Previous reminder changed' using errcode='40001';end if;
    -- Invalidate old only, leaving the separately reviewed candidate intact.
    if old_r.state in ('draft','scheduling_pending','scheduled','retry_scheduled','attempt_started') and old_r.cancel_requested_at is null then
     rr:=private.m2b_reminder_before_recurrence_v1('cancel',gen_random_uuid(),jsonb_build_object('id',old_r.id,'version',old_r.version));flight:=coalesce((rr->'operation'->'result'->>'in_flight')::boolean,false);
    end if;
   end if;
   rr:=private.m2b_reminder_before_recurrence_v1('confirm',p_request,jsonb_build_object('id',r.id,'version',r.version,'snapshot',p_data->'reminder_snapshot'));
   select * into r from public.reminders where id=r.id;
   update public.tasks set linked_reminder_id=r.id,reminder_review_id=null,reminder_review=null,version=version+1,review=null,review_version=review_version+1,updated_at=now() where id=t.id returning * into t;
  else
   flight:=private.task_cancel_links_v1(t.id);
   update public.tasks set linked_reminder_id=null,reminder_review_id=null,reminder_review=null,version=version+1,review=null,review_version=review_version+1,updated_at=now() where id=t.id returning * into t;
  end if;
 else
  review_action:=p_action;
  if p_action='confirm' then
   if t.review is null or (p_data->>'review_version')::integer is distinct from t.review_version or t.review is distinct from p_data->'review' then raise exception 'Exact task review required' using errcode='40001';end if;
   review_action:=t.review->>'action';v:=t.review->'values';
  end if;
  if review_action in ('create','edit') then
   perform private.task_check_v1(v);
   update public.tasks set title=v->>'title',notes=v->>'notes',due_kind=v->>'due_kind',due_date=(v->>'due_date')::date,due_local_datetime=v->>'due_local_datetime',due_timezone=v->>'due_timezone',due_at=(v->>'due_at')::timestamptz,due_resolution=v->>'due_resolution',state=case when state='draft' then 'open' else state end,version=version+1,review=null,review_version=review_version+1,updated_at=now() where id=t.id returning * into t;
  elsif review_action='reject_review' then
   if t.state='draft' then ref:=t.id;delete from public.tasks where id=t.id;t:=null;final_state:='discarded';else update public.tasks set review=null,review_version=review_version+1,updated_at=now() where id=t.id returning * into t;end if;
  else
   if review_action='delete' and (p_data->>'confirm_delete') is distinct from 'true' then raise exception 'Explicit delete confirmation required' using errcode='22023';end if;
   if review_action='complete' and t.state<>'open' or review_action='reopen' and t.state not in ('completed','cancelled') or review_action='cancel' and t.state not in ('open','draft') then raise exception 'Task state changed' using errcode='40001';end if;
   if review_action not in ('complete','reopen','cancel','delete') then raise exception 'Unsupported task transition' using errcode='22023';end if;
   if review_action in ('complete','cancel','delete') then flight:=private.task_cancel_links_v1(t.id);end if;
   final_state:=case review_action when 'complete' then 'completed' when 'reopen' then 'open' when 'cancel' then 'cancelled' else 'deleted' end;
   if review_action='delete' then ref:=t.id;delete from public.tasks where id=t.id;t:=null;
   else update public.tasks set state=final_state,version=version+1,review=null,review_version=review_version+1,reminder_review_id=null,reminder_review=null,completed_at=case when final_state='completed' then now() else null end,cancelled_at=case when final_state='cancelled' then now() else null end,updated_at=now() where id=t.id returning * into t;end if;
  end if;
 end if;
 ref:=coalesce(t.id,ref);final_state:=coalesce(t.state,final_state);
 if conv is not null and t.id is not null then update public.conversations set task_focus_id=t.id where id=conv and owner_id=o;end if;
 insert into public.task_operations(owner_id,request_id,kind,request_hash,task_id,task_ref,result)
 values(o,p_request,p_action,h,t.id,ref,jsonb_build_object('state',final_state,'version',t.version,'review_version',t.review_version,'in_flight',flight,'reminder_id',case when r.id is null then t.linked_reminder_id else r.id end)) returning * into op;
 return jsonb_build_object('task',case when t.id is null then null else to_jsonb(t) end,'operation',to_jsonb(op),'reminder',case when r.id is null then null else to_jsonb(r) end,'replay',false);
end $$;
-- Add task authority checks before the existing recurrence/queue/provider path.
grant create on schema private,public to jarvis_auth_guard;
set local role jarvis_auth_guard;
alter function private.m2b_worker_v1(text,jsonb,text) rename to m2b_worker_before_tasks_v1;
revoke all on function private.m2b_worker_before_tasks_v1(text,jsonb,text) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker;
alter function public.m2b_reminder_v1(text,uuid,jsonb) rename to m2b_reminder_before_tasks_v1;
revoke all on function public.m2b_reminder_before_tasks_v1(text,uuid,jsonb) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker;
alter function public.m2b_reminder_before_tasks_v1(text,uuid,jsonb) set schema private;
reset role;
create function private.m2b_worker_v1(p_action text,p_data jsonb default '{}',p_run text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tasks;r public.reminders;
begin
 if p_action in ('claim','authorize') then
  if p_action='claim' then select tt.* into t from public.tasks tt join public.reminders rr on rr.task_id=tt.id where rr.id=(p_data->>'reminder_id')::uuid for update of tt;
  else select tt.* into t from public.tasks tt join public.reminders rr on rr.task_id=tt.id join public.delivery_attempts a on a.reminder_id=rr.id where a.id=(p_data->>'attempt_id')::uuid for update of tt;end if;
  if t.id is not null then
   if p_action='claim' then select * into r from public.reminders where id=(p_data->>'reminder_id')::uuid for update;
   else select rr.* into r from public.reminders rr join public.delivery_attempts a on a.reminder_id=rr.id where a.id=(p_data->>'attempt_id')::uuid for update of rr;end if;
   if t.state<>'open' or t.linked_reminder_id is distinct from r.id then
    perform private.task_cancel_links_v1(t.id);return case when p_action='claim' then 'null'::jsonb else 'false'::jsonb end;
   end if;
  end if;
 end if;
 return private.m2b_worker_before_tasks_v1(p_action,p_data,p_run);
end $$;
create function public.m2b_reminder_v1(p_action text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();t public.tasks;r public.reminders;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,3));
 select tt.* into t from public.tasks tt join public.reminders rr on rr.task_id=tt.id where rr.id=(p_data->>'id')::uuid and rr.owner_id=o for update of tt;
 if t.id is not null then
  select * into r from public.reminders where id=(p_data->>'id')::uuid and owner_id=o;
  if t.state<>'open' or t.linked_reminder_id is distinct from r.id or p_action<>'cancel' then raise exception 'Use the task reminder review' using errcode='42501';end if;
 end if;
 return private.m2b_reminder_before_tasks_v1(p_action,p_request,p_data);
end $$;
do $$ declare f record;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in ('task_check_v1','task_cancel_links_v1','m2b_worker_v1')) or (n.nspname='public' and p.proname in ('task_context_v1','task_command_v1','m2b_reminder_v1')) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',f.nspname,f.proname,f.args);
 execute format('alter function %I.%I(%s) owner to jarvis_auth_guard',f.nspname,f.proname,f.args);
 end loop;
end $$;
set local role jarvis_auth_guard;
grant execute on function public.task_context_v1(text,boolean,uuid),public.task_command_v1(text,uuid,jsonb),public.m2b_reminder_v1(text,uuid,jsonb) to authenticated;
grant execute on function private.m2b_worker_v1(text,jsonb,text) to jarvis_reminder_worker;
reset role;
revoke create on schema private,public from jarvis_auth_guard;
notify pgrst,'reload schema';
