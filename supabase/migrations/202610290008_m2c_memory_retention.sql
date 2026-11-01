-- Natural-language proposals remain unapproved; model output has no approval RPC.
alter table public.memory_proposals add column origin text not null default 'mock' check(origin in ('mock','openai'));
alter table public.memory_proposals add column conflict_memory_id uuid;
alter table public.memory_proposals add column conflict_memory_version integer;
alter table public.memory_proposals add foreign key(conflict_memory_id,owner_id) references public.memories(id,owner_id) on delete set null(conflict_memory_id);
alter table public.conversations add column expires_at timestamptz not null default now()+interval '30 days';
-- Existing retained conversations receive at most 30 days from their creation.
update public.conversations set expires_at=created_at+interval '30 days';
drop policy owned_read on public.conversations;
create policy owned_read on public.conversations for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()) and expires_at>now());
drop policy owned_read on public.messages;
create policy owned_read on public.messages for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()) and exists(select 1 from public.conversations c where c.id=conversation_id and c.owner_id=messages.owner_id and c.expires_at>now()));
create function public.m2c_mark_turn_v1(p_id uuid,p_attempt uuid,p_model text) returns void language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();
begin
 if p_model not in ('gpt-6-luna','gpt-6.1-sol') or p_model is null then raise exception 'Unsupported model' using errcode='22023'; end if;
 update public.messages set provider_version=p_model||'/personal-assistant-m2c-v1' where id=p_id and owner_id=o and attempt=p_attempt and state='running';
 if not found then raise exception 'Turn unavailable' using errcode='42501'; end if;
end $$;
create function public.m2c_finish_turn_v1(p_id uuid,p_attempt uuid,p_text text,p_used jsonb,p_proposal jsonb,p_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); r public.messages; p public.memory_proposals; result jsonb; candidate text; conflict uuid; conflict_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 select * into r from public.messages where id=p_id and owner_id=o for update;
 if not found or r.state<>'running' or r.attempt<>p_attempt then raise exception 'Turn unavailable' using errcode='40001'; end if;
 if not exists(select 1 from public.conversations where id=r.conversation_id and owner_id=o and expires_at>now()) then raise exception 'Conversation expired' using errcode='42501'; end if;
 if p_model is null or p_model not in ('gpt-6-luna','gpt-6.1-sol') then raise exception 'Unsupported provider model' using errcode='22023'; end if;
 -- Existing atomic completion rechecks all used active revisions before commit.
 result:=public.m2a_end_turn_v1(p_id,p_attempt,'complete',p_text,p_used);
 if p_proposal is not null and p_proposal<>'null'::jsonb then
  if r.user_text !~* '^(please[[:space:]]+)?(remember([[:space:]]+(this|that))?|save[[:space:]]+(this|a)[[:space:]]+(memory|note))\M' or
    r.user_text ~* '((do not|don''t|never)[[:space:]]+(remember|save)|pretend|roleplay|hypothetical|quotation|quote|["“”])' then raise exception 'Explicit current save request required' using errcode='22023'; end if;
  candidate:=p_proposal->>'content';conflict:=(p_proposal->>'conflict_id')::uuid;conflict_version:=(p_proposal->>'conflict_version')::integer;
  if candidate is null or length(btrim(candidate)) not between 1 and 1000 then raise exception 'Invalid proposal' using errcode='22023'; end if;
  if conflict is not null and not exists(select 1 from public.memories where id=conflict and owner_id=o and state='active' and version=conflict_version) then raise exception 'Conflict unavailable' using errcode='42501'; end if;
  select * into p from public.memory_proposals where source_message_id=r.id and owner_id=o for update;
  if found then
   if p.state<>'pending' then raise exception 'Reviewed source cannot be re-extracted' using errcode='40001'; end if;
   update public.memory_proposals set content=btrim(candidate),origin='openai',conflict_memory_id=conflict,conflict_memory_version=conflict_version where id=p.id returning * into p;
  else
   if (select count(*) from public.memory_proposals where owner_id=o and state='pending')>=50 then raise exception 'Proposal limit' using errcode='54000'; end if;
   insert into public.memory_proposals(owner_id,source_message_id,content,origin,conflict_memory_id,conflict_memory_version) values(o,r.id,btrim(candidate),'openai',conflict,conflict_version) returning * into p;
  end if;
  result:=jsonb_set(result,'{proposal_id}',to_jsonb(p.id));
 else
  -- M2A's anchored demo proposal must not become an unvalidated live proposal.
  delete from public.memory_proposals where owner_id=o and source_message_id=r.id and state='pending';
  result:=jsonb_set(result,'{proposal_id}','null'::jsonb);
 end if;
 update public.messages set provider_version=p_model||'/personal-assistant-m2c-v1' where id=r.id;
 return result;
end $$;
create function public.m2c_approve_memory_v1(p_id uuid,p_version integer,p_content text,p_reviewed boolean,p_replace uuid default null,p_replace_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); p public.memory_proposals; old public.memories; m public.memories;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 select * into p from public.memory_proposals where id=p_id and owner_id=o for update;
 if not found then raise exception 'Unavailable' using errcode='42501'; end if;
 if p.origin<>'openai' or p.state<>'pending' or p.version is distinct from p_version or p.content is distinct from p_content or p_reviewed is not true then raise exception 'Exact review/approval required' using errcode='40001'; end if;
 if p.conflict_memory_id is not null and (p_replace is distinct from p.conflict_memory_id or p_replace_version is distinct from p.conflict_memory_version) then raise exception 'Review the proposed conflict explicitly' using errcode='40001'; end if;
 if p_replace is not null then
  select * into old from public.memories where id=p_replace and owner_id=o and state='active' for update;
  if not found or old.version is distinct from p_replace_version then raise exception 'Replacement changed' using errcode='40001'; end if;
  perform private.m2a_redact_v1(o,old.id);
  update public.memories set content='',state='superseded',version=version+1,updated_at=now() where id=old.id;
  update public.memory_proposals set content='',state='deleted',version=version+1 where id=old.proposal_id and owner_id=o;
 end if;
 if (select count(*) from public.memories where owner_id=o and state='active')>=50 then raise exception 'Memory limit' using errcode='54000'; end if;
 insert into public.memories(owner_id,proposal_id,source_message_id,source_date,content,supersedes_id)
 select o,p.id,p.source_message_id,s.created_at,p.content,old.id from public.messages s join public.conversations c on c.id=s.conversation_id and c.owner_id=s.owner_id where s.id=p.source_message_id and s.owner_id=o and c.expires_at>now() returning * into m;
 if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
 update public.memory_proposals set state='approved',version=version+1 where id=p.id;
 return to_jsonb(m);
exception when unique_violation then raise exception 'Explicit duplicate/conflict review required' using errcode='40001';
end $$;
create function private.m2c_cleanup_v1(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare conv integer;rem integer;
begin
 delete from public.conversations where id in(select id from public.conversations where expires_at<=now() and (p_owner is null or owner_id=p_owner) order by expires_at limit 10);
 get diagnostics conv=row_count;
 update public.memory_proposals set content='',state='rejected',version=version+1 where state='pending' and created_at<now()-interval '7 days' and (p_owner is null or owner_id=p_owner);
 delete from public.reminders where id in(select r.id from public.reminders r where r.state in ('cancelled','expired','failed','outcome_unknown','simulated_acceptance','provider_accepted') and r.finished_at<now()-interval '30 days' and (p_owner is null or r.owner_id=p_owner)
  and not exists(select 1 from private.personal_integrations c where c.channel_test_id=r.id) order by r.finished_at limit 20);
 get diagnostics rem=row_count;
 update public.ai_requests set state='unknown',settled_at=now() where state in ('reserved','inflight') and lease_until<now() and (p_owner is null or owner_id=p_owner);
 return jsonb_build_object('conversations_purged',conv,'reminders_purged',rem);
end $$;
create function public.m2c_cleanup_self_v1() returns jsonb language sql security definer set search_path='' as $$
 select private.m2c_cleanup_v1(private.m2a_owner_v1());
$$;
create function public.m2c_live_readiness_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); c private.personal_integrations;
begin
 select * into c from private.personal_integrations where owner_id=o;
 return jsonb_build_object('generic_test_observed',exists(select 1 from public.delivery_attempts where owner_id=o and reminder_id=c.channel_test_id and phone_observed=true),
 'scheduled_phone_observed',exists(select 1 from public.delivery_attempts d join public.reminders r on r.id=d.reminder_id and r.owner_id=d.owner_id where r.owner_id=o and r.id is distinct from c.channel_test_id and r.channel='pushover' and d.phone_observed=true));
end $$;
grant create on schema public,private to jarvis_auth_guard;
do $$ declare f record; begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('m2c_mark_turn_v1','m2c_finish_turn_v1','m2c_approve_memory_v1','m2c_cleanup_v1','m2c_cleanup_self_v1','m2c_live_readiness_v1') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',f.nspname,f.proname,f.args);
  if f.nspname='public' then execute format('grant execute on function %I.%I(%s) to authenticated',f.nspname,f.proname,f.args); else execute format('grant execute on function %I.%I(%s) to jarvis_reminder_worker',f.nspname,f.proname,f.args); end if;
  execute format('alter function %I.%I(%s) owner to jarvis_auth_guard',f.nspname,f.proname,f.args);
 end loop;
end $$;
set local role jarvis_auth_guard;
create or replace function public.m2a_start_turn_v1(p_conversation uuid,p_request uuid,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); r public.messages;
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
  if p_request is null or p_text is null or length(btrim(p_text)) not between 1 and 2000 then raise exception 'Invalid message' using errcode='22023'; end if;
  if not exists(select 1 from public.conversations where id=p_conversation and owner_id=o and expires_at>now()) then raise exception 'Not available' using errcode='42501'; end if;
  select * into r from public.messages where owner_id=o and request_id=p_request for update;
  if found then
    if r.conversation_id <> p_conversation or r.user_text <> p_text then raise exception 'Request ID already used' using errcode='40001'; end if;
    if r.state in ('complete','redacted') then return jsonb_build_object('turn',to_jsonb(r),'acquired',false); end if;
    if r.state='running' and r.lease_until > now() then raise exception 'Turn still running; stop it or wait 45 seconds' using errcode='40001'; end if;
    update public.messages set state='running',assistant_text='',used_memories='[]',attempt=gen_random_uuid(),lease_until=now()+interval '45 seconds'
      where id=r.id returning * into r;
  else
    if exists(select 1 from public.messages where owner_id=o and conversation_id=p_conversation and state='running' and lease_until>now()) then
      raise exception 'Another turn is running' using errcode='40001';
    end if;
    if (select count(*) from public.messages where owner_id=o and conversation_id=p_conversation) >= 200 or
       (select count(*) from public.messages where owner_id=o and created_at > now()-interval '1 minute') >= 30 then
      raise exception 'Text turn limit' using errcode='54000';
    end if;
    insert into public.messages(owner_id,conversation_id,request_id,user_text) values(o,p_conversation,p_request,p_text) returning * into r;
  end if;
  return jsonb_build_object('turn',to_jsonb(r),'acquired',true);
end $$;
create or replace function public.m2a_end_turn_v1(p_id uuid,p_attempt uuid,p_state text,p_text text default '',p_used jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); r public.messages; proposal uuid; candidate text;
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
  select * into r from public.messages where id=p_id and owner_id=o for update;
  if not found then raise exception 'Not available' using errcode='42501'; end if;
  if r.attempt <> p_attempt or r.state <> 'running' then raise exception 'Stale turn attempt' using errcode='40001'; end if;
  if p_state is null or p_state not in ('complete','failed','cancelled') then raise exception 'Invalid outcome' using errcode='22023'; end if;
  if p_state='complete' then
    if not exists(select 1 from public.conversations where id=r.conversation_id and owner_id=o and expires_at>now()) then raise exception 'Conversation expired' using errcode='42501'; end if;
    if r.lease_until < now() then raise exception 'Turn lease expired' using errcode='40001'; end if;
    if p_text is null or length(p_text) not between 1 and 8000 or p_used is null or jsonb_typeof(p_used)<>'array' or jsonb_array_length(p_used)>5 then raise exception 'Invalid response' using errcode='22023'; end if;
    -- Lock referenced active revisions against concurrent correction/deletion.
    perform 1 from public.memories m where m.owner_id=o and m.id in (select (x->>'id')::uuid from jsonb_array_elements(p_used) x) for share;
    if exists(select 1 from jsonb_array_elements(p_used) x where not exists(
      select 1 from public.memories m where m.owner_id=o and m.id=(x->>'id')::uuid and m.version=(x->>'version')::integer and m.state='active'
    )) then raise exception 'Memory changed; retry' using errcode='40001'; end if;
    if r.user_text ~* '^remember( this)?:[[:space:]]*[^[:space:]]' then
      candidate := btrim(regexp_replace(r.user_text,'^remember( this)?:[[:space:]]*','','i'));
      if length(candidate)>1000 then raise exception 'Memory content too long' using errcode='22023'; end if;
      if (select count(*) from public.memory_proposals where owner_id=o and state='pending')>=50 then raise exception 'Proposal limit' using errcode='54000'; end if;
      insert into public.memory_proposals(owner_id,source_message_id,content) values(o,r.id,candidate)
        on conflict (source_message_id,owner_id) do nothing returning id into proposal;
    end if;
  end if;
  update public.messages set state=p_state,assistant_text=case when p_state='complete' then p_text else '' end,
    used_memories=case when p_state='complete' then p_used else '[]'::jsonb end where id=r.id;
  return jsonb_build_object('id',r.id,'state',p_state,'proposal_id',proposal);
end $$;

create or replace function public.m2a_memory_v1(p_action text,p_id uuid,p_version integer,p_content text default '',p_replace uuid default null,p_replace_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); p public.memory_proposals; m public.memories; old public.memories; k text;
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
  if p_action='approve' and exists(select 1 from public.memory_proposals where id=p_id and owner_id=o and origin='openai') then raise exception 'Use exact live proposal review' using errcode='40001'; end if;
  if p_version is null or p_version<1 then raise exception 'Version required' using errcode='22023'; end if;
  if p_action in ('edit_proposal','approve','reject') then
    select * into p from public.memory_proposals where id=p_id and owner_id=o for update;
    if not found then raise exception 'Not available' using errcode='42501'; end if;
    if p.state<>'pending' or p.version<>p_version then raise exception 'Proposal changed; review again' using errcode='40001'; end if;
    if p_action='reject' then
      update public.memory_proposals set content='',state='rejected',version=version+1 where id=p.id;
      return jsonb_build_object('state','rejected');
    end if;
    if p_content is null or length(btrim(p_content)) not between 1 and 1000 then raise exception 'Invalid memory' using errcode='22023'; end if;
    if p_action='edit_proposal' then
      update public.memory_proposals set content=btrim(p_content),version=version+1 where id=p.id returning * into p;
      return to_jsonb(p);
    end if;
    if p_content <> p.content then raise exception 'Exact reviewed content required' using errcode='40001'; end if;
    k := lower(btrim(split_part(p.content,':',1)));
    select * into old from public.memories where owner_id=o and state='active' and memory_key=k for update;
    if found then
      if p_replace is distinct from old.id or p_replace_version is distinct from old.version then raise exception 'Review conflicting memory before replacement' using errcode='40001'; end if;
      perform private.m2a_redact_v1(o,old.id);
      update public.memories set state='superseded',content='',version=version+1,updated_at=now() where id=old.id;
      update public.memory_proposals set content='',state='deleted',version=version+1 where id=old.proposal_id and owner_id=o;
    elsif p_replace is not null then raise exception 'Replacement changed' using errcode='40001';
    end if;
    if (select count(*) from public.memories where owner_id=o and state='active')>=50 then raise exception 'Memory limit' using errcode='54000'; end if;
    insert into public.memories(owner_id,proposal_id,source_message_id,source_date,content,supersedes_id)
      select o,p.id,p.source_message_id,s.created_at,p.content,old.id from public.messages s where s.id=p.source_message_id and s.owner_id=o returning * into m;
    if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
    update public.memory_proposals set state='approved',version=version+1 where id=p.id;
    return to_jsonb(m);
  elsif p_action in ('edit_memory','delete_memory') then
    select * into m from public.memories where id=p_id and owner_id=o for update;
    if not found then raise exception 'Not available' using errcode='42501'; end if;
    if m.state<>'active' or m.version<>p_version then raise exception 'Memory changed; review again' using errcode='40001'; end if;
    perform private.m2a_redact_v1(o,m.id);
    if p_action='delete_memory' then
      update public.memories set content='',state='deleted',version=version+1,updated_at=now() where id=m.id;
      update public.memory_proposals set content='',state='deleted',version=version+1 where id=m.proposal_id and owner_id=o;
      return jsonb_build_object('state','deleted');
    end if;
    if p_content is null or length(btrim(p_content)) not between 1 and 1000 then raise exception 'Invalid memory' using errcode='22023'; end if;
    update public.memories set content=btrim(p_content),version=version+1,updated_at=now(),source_kind='user_correction' where id=m.id returning * into m;
    update public.memory_proposals set content='',state='deleted',version=version+1 where id=m.proposal_id and owner_id=o;
    return to_jsonb(m);
  end if;
  raise exception 'Unsupported memory operation' using errcode='22023';
exception when unique_violation then raise exception 'Explicit duplicate/conflict review required' using errcode='40001';
end $$;


reset role;
revoke create on schema public,private from jarvis_auth_guard;
notify pgrst,'reload schema';
