-- Additive M2A. No changes to Auth, admission, sessions or existing profiles.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  title text not null default 'Conversation' check (length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  unique(id, owner_id)
);
-- One row is one atomic text turn (user message + assistant outcome).
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  conversation_id uuid not null,
  request_id uuid not null,
  user_text text not null check (length(btrim(user_text)) between 1 and 2000),
  assistant_text text not null default '' check (length(assistant_text) <= 8000),
  state text not null default 'running' check (state in ('running','complete','failed','cancelled','redacted')),
  attempt uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default (now() + interval '45 seconds'),
  used_memories jsonb not null default '[]' check (jsonb_typeof(used_memories) = 'array' and jsonb_array_length(used_memories) <= 5),
  provider_version text not null default 'deterministic-mock-v1',
  created_at timestamptz not null default now(),
  unique(id, owner_id), unique(owner_id, request_id),
  foreign key(conversation_id, owner_id) references public.conversations(id, owner_id) on delete cascade
);
create index messages_conversation on public.messages(owner_id, conversation_id, created_at);
create table public.memory_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  source_message_id uuid not null,
  content text not null check (length(content) <= 1000),
  state text not null default 'pending' check (state in ('pending','approved','rejected','deleted')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique(id, owner_id), unique(source_message_id, owner_id),
  check (state not in ('pending','approved') or length(btrim(content)) > 0),
  foreign key(source_message_id, owner_id) references public.messages(id, owner_id) on delete cascade
);
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  proposal_id uuid,
  source_message_id uuid,
  source_date timestamptz not null,
  source_kind text not null default 'conversation' check (source_kind in ('conversation','user_correction')),
  content text not null check (length(content) <= 1000),
  memory_key text generated always as (lower(btrim(split_part(content, ':', 1)))) stored,
  state text not null default 'active' check (state in ('active','deleted','superseded')),
  version integer not null default 1 check (version > 0),
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supersedes_id uuid,
  unique(id, owner_id), unique(proposal_id, owner_id),
  check (state <> 'active' or length(btrim(content)) > 0),
  foreign key(proposal_id, owner_id) references public.memory_proposals(id, owner_id) on delete set null (proposal_id),
  foreign key(source_message_id, owner_id) references public.messages(id, owner_id) on delete set null (source_message_id),
  foreign key(supersedes_id, owner_id) references public.memories(id, owner_id)
);
create unique index active_memory_key on public.memories(owner_id, memory_key) where state='active';

-- Ordinary roles can inspect only their own data; all writes use bounded RPCs.
-- No new superuser/BYPASSRLS role or managed Auth grant is introduced.
do $$ declare t text; begin
  foreach t in array array['conversations','messages','memory_proposals','memories'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select, insert, update, delete on public.%I to jarvis_auth_guard',t);
    execute format('create policy owned_read on public.%I for select to authenticated using (owner_id = (select auth.uid()) and (select private.has_access()))',t);
    execute format('create policy domain_mutation on public.%I for all to jarvis_auth_guard using (true) with check (true)',t);
  end loop;
end $$;

create function private.m2a_owner_v1() returns uuid
language plpgsql set search_path='' as $$
begin
  if private.has_access() is not true then raise exception 'Not authorized' using errcode='42501'; end if;
  return (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
end $$;
create function private.m2a_redact_v1(o uuid, memory uuid) returns void
language sql set search_path='' as $$
  update public.messages set assistant_text='', used_memories='[]', state='redacted'
  where owner_id=o and state='complete' and used_memories @> jsonb_build_array(jsonb_build_object('id',memory));
$$;
create function public.m2a_create_conversation_v1(p_title text default 'Conversation') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); r public.conversations;
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
  if p_title is null or length(btrim(p_title)) not between 1 and 80 then raise exception 'Invalid title' using errcode='22023'; end if;
  if (select count(*) from public.conversations where owner_id=o) >= 50 then raise exception 'Conversation limit' using errcode='54000'; end if;
  insert into public.conversations(owner_id,title) values(o,btrim(p_title)) returning * into r;
  return to_jsonb(r);
end $$;
create function public.m2a_delete_conversation_v1(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1();
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
  delete from public.conversations where id=p_id and owner_id=o;
  if not found then raise exception 'Not available' using errcode='42501'; end if;
  -- Cascades remove turns/proposals; independently approved memories survive
  -- with nullable source pointers and their source/approval dates.
end $$;
create function public.m2a_start_turn_v1(p_conversation uuid,p_request uuid,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); r public.messages;
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
  if p_request is null or p_text is null or length(btrim(p_text)) not between 1 and 2000 then raise exception 'Invalid message' using errcode='22023'; end if;
  if not exists(select 1 from public.conversations where id=p_conversation and owner_id=o) then raise exception 'Not available' using errcode='42501'; end if;
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
create function public.m2a_end_turn_v1(p_id uuid,p_attempt uuid,p_state text,p_text text default '',p_used jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); r public.messages; proposal uuid; candidate text;
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
  select * into r from public.messages where id=p_id and owner_id=o for update;
  if not found then raise exception 'Not available' using errcode='42501'; end if;
  if r.attempt <> p_attempt or r.state <> 'running' then raise exception 'Stale turn attempt' using errcode='40001'; end if;
  if p_state is null or p_state not in ('complete','failed','cancelled') then raise exception 'Invalid outcome' using errcode='22023'; end if;
  if p_state='complete' then
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
create function public.m2a_retrieve_v1(p_query text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); result jsonb;
begin
  if p_query is null or length(p_query)>2000 then raise exception 'Invalid query' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into result from (
    select id,content,version from public.memories where owner_id=o and state='active' and exists(
      select 1 from regexp_split_to_table(lower(p_query),'[^[:alnum:]]+') term
      where length(term)>=3 and term not in ('the','and','this','that','what','remember','please','with','you','your') and position(term in lower(content))>0
    ) order by updated_at desc,id limit 5
  ) m;
  return result;
end $$;
create function public.m2a_memory_v1(p_action text,p_id uuid,p_version integer,p_content text default '',p_replace uuid default null,p_replace_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid := private.m2a_owner_v1(); p public.memory_proposals; m public.memories; old public.memories; k text;
begin
  perform pg_advisory_xact_lock(hashtextextended(o::text, 2));
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
end $$;

-- Fixed schemas, no SQL execution/context-setting RPC, no PUBLIC/default access.
-- Transfer only this migration's functions, not the already-applied Auth helpers.
grant create on schema public, private to jarvis_auth_guard;
do $$ declare f record; begin
  for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'm2a_%_v1' loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated, service_role, authenticator',f.nspname,f.proname,f.args);
    if f.nspname='public' then execute format('grant execute on function %I.%I(%s) to authenticated',f.nspname,f.proname,f.args); end if;
    execute format('alter function %I.%I(%s) owner to jarvis_auth_guard',f.nspname,f.proname,f.args);
  end loop;
end $$;
revoke create on schema public, private from jarvis_auth_guard;
notify pgrst,'reload schema';
