-- Durable, content-free AI accounting. No admin credential in the web path.
-- Per-request settlement capabilities are generated server-side. Only hashes
-- persist; normal API responses never return the secret capability. A caller
-- cannot settle/release an existing server request using another token.
alter table private.personal_integrations add column ai_evaluation_enabled boolean not null default false;
create table private.ai_prices (
 model text primary key, price_version text not null,valid_until timestamptz not null,
 input_microusd numeric not null,cached_microusd numeric not null,write30_microusd numeric not null,write12_microusd numeric not null,output_microusd numeric not null
);
insert into private.ai_prices values
 ('gpt-6-luna','2026-10-29-standard-v1','2026-11-29T00:00:00+05:30',100000,10000,125000,250000,500000),
 ('gpt-6.1-sol','2026-10-29-standard-v1','2026-11-29T00:00:00+05:30',2000000,100000,2500000,5000000,10000000);
alter table private.ai_prices enable row level security;
revoke all on private.ai_prices from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select on private.ai_prices to jarvis_auth_guard;
create policy ai_price_guard on private.ai_prices for select to jarvis_auth_guard using(true);
-- Restricted test infrastructure, populated only by isolated synthetic fixtures.
-- It supplies no provider credential; web key ownership still denies live use.
create table private.ai_test_policies (
 owner_id uuid primary key references public.profiles(owner_id) on delete cascade,
 run_id text not null check(run_id ~ '^[a-f0-9]{24}$'),ai_enabled boolean not null,ai_evaluation_enabled boolean not null
);
alter table private.ai_test_policies enable row level security;
revoke all on private.ai_test_policies from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select,update on private.ai_test_policies to jarvis_auth_guard;
create policy ai_test_guard on private.ai_test_policies to jarvis_auth_guard using(true) with check(true);
create function private.m2c_ai_policy_v1(p_owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce((select jsonb_build_object('scope','personal','ai_enabled',ai_enabled,'ai_evaluation_enabled',ai_evaluation_enabled) from private.personal_integrations where owner_id=p_owner),
 (select jsonb_build_object('scope',run_id,'ai_enabled',ai_enabled,'ai_evaluation_enabled',ai_evaluation_enabled) from private.ai_test_policies where owner_id=p_owner));
$$;
revoke all on function private.m2c_ai_policy_v1(uuid) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker;
grant execute on function private.m2c_ai_policy_v1(uuid) to jarvis_auth_guard;
create table public.ai_requests (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(owner_id) on delete cascade,
 scope_id text not null,request_id uuid not null,attempt_id uuid not null,purpose text not null check(purpose in ('ordinary','evaluation')),
 model text not null references private.ai_prices(model),price_version text not null,
 budget_month date not null,input_bound integer not null check(input_bound between 1 and 28096),output_bound integer not null check(output_bound between 1 and 1024),
 reserved_paise integer not null check(reserved_paise>0),charged_paise integer not null check(charged_paise>=0),
 state text not null check(state in ('reserved','inflight','settled','unknown','released')),
 settlement_hash text not null check(settlement_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),lease_until timestamptz not null default now()+interval '90 seconds',dispatched_at timestamptz,settled_at timestamptz,
 input_tokens integer,output_tokens integer,cached_tokens integer,write30_tokens integer,write12_tokens integer,reasoning_tokens integer,
 provider_model text,provider_response_id text,
 unique(owner_id,request_id,attempt_id),unique(id,owner_id)
);
create index ai_monthly on public.ai_requests(budget_month,purpose);
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select(id,owner_id,request_id,attempt_id,purpose,model,price_version,budget_month,input_bound,output_bound,reserved_paise,charged_paise,state,created_at,lease_until,dispatched_at,settled_at,input_tokens,output_tokens,cached_tokens,write30_tokens,write12_tokens,reasoning_tokens,provider_model,provider_response_id) on public.ai_requests to authenticated;
grant select,insert,update on public.ai_requests to jarvis_auth_guard;
create policy ai_owned_read on public.ai_requests for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()));
create policy ai_guard on public.ai_requests to jarvis_auth_guard using(true) with check(true);
create function public.m2c_ai_reserve_v1(p_request uuid,p_attempt uuid,p_purpose text,p_model text,p_input integer,p_output integer,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); r public.ai_requests; c jsonb; scope text; p private.ai_prices; m date; amount integer; spent bigint; eval_spent bigint;
begin
 perform pg_advisory_xact_lock(908410237451::bigint);
 c:=private.m2c_ai_policy_v1(o);scope:=c->>'scope';
 if c is null or not ((p_purpose='ordinary' and (c->>'ai_enabled')::boolean) or (p_purpose='evaluation' and (c->>'ai_evaluation_enabled')::boolean)) then raise exception 'AI not enabled for account/purpose' using errcode='42501'; end if;
 if p_request is null or p_attempt is null or p_input is null or p_input not between 1 and 28096 or p_output is null or p_output not between 1 and 1024 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid bounds' using errcode='22023'; end if;
 select * into p from private.ai_prices where model=p_model and valid_until>now();
 if not found then raise exception 'Pricing review required' using errcode='22023'; end if;
 select * into r from public.ai_requests where owner_id=o and request_id=p_request and attempt_id=p_attempt;
 if found then
  if r.settlement_hash<>p_hash or r.model<>p_model or r.purpose<>p_purpose or r.input_bound<>p_input or r.output_bound<>p_output then raise exception 'Reservation conflict' using errcode='40001'; end if;
  return jsonb_build_object('id',r.id,'state',r.state,'acquired',false);
 end if;
 update public.ai_requests set state='unknown',settled_at=now() where scope_id=scope and state in ('reserved','inflight') and lease_until<now(); -- charged reservation is retained
 if (select count(*) from public.ai_requests where scope_id=scope and state in ('reserved','inflight'))>=2 then raise exception 'AI concurrency limit' using errcode='54000'; end if;
 m:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;
 amount:=ceil((p_input*p.write12_microusd+p_output*p.output_microusd)*15000/1000000000000)::integer;
 select coalesce(sum(charged_paise),0) into spent from public.ai_requests where scope_id=scope and budget_month=m;
 select coalesce(sum(charged_paise),0) into eval_spent from public.ai_requests where scope_id=scope and purpose='evaluation';
 if spent+amount>100000 or (p_purpose='evaluation' and eval_spent+amount>20000) then raise exception 'AI allowance insufficient' using errcode='54000'; end if;
 insert into public.ai_requests(owner_id,scope_id,request_id,attempt_id,purpose,model,price_version,budget_month,input_bound,output_bound,reserved_paise,charged_paise,state,settlement_hash)
 values(o,scope,p_request,p_attempt,p_purpose,p_model,p.price_version,m,p_input,p_output,amount,amount,'reserved',p_hash) returning * into r;
 return jsonb_build_object('id',r.id,'state',r.state,'acquired',true,'reserved_paise',amount,'month',m);
end $$;
create function public.m2c_ai_account_v1(p_action text,p_id uuid,p_token text,p_usage jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); r public.ai_requests; p private.ai_prices; u integer; v integer; cached integer; w30 integer; w12 integer; reasoning integer; cost integer;
begin
 perform pg_advisory_xact_lock(908410237451::bigint);
 select * into r from public.ai_requests where id=p_id and owner_id=o for update;
 if not found or p_token is null or length(p_token)<>64 or r.settlement_hash<>encode(sha256(convert_to(p_token,'UTF8')),'hex') then raise exception 'Reservation unavailable' using errcode='42501'; end if;
 if r.state not in ('reserved','inflight') then return jsonb_build_object('state',r.state,'charged_paise',r.charged_paise,'dispatched',false); end if;
 if p_action='dispatch' then
  if r.state<>'reserved' or r.lease_until<=now() then raise exception 'Dispatch not available' using errcode='40001'; end if;
  if r.budget_month<>date_trunc('month',now() at time zone 'Asia/Kolkata')::date then
   update public.ai_requests set state='released',charged_paise=0,settled_at=now() where id=r.id;
   return jsonb_build_object('state','released','dispatched',false,'reason','month_changed');
  end if;
  update public.ai_requests set state='inflight',dispatched_at=now() where id=r.id;
  return jsonb_build_object('state','inflight','dispatched',true);
 elsif p_action='release' then
  if r.state<>'reserved' then raise exception 'Cannot release a dispatched request' using errcode='40001'; end if;
  update public.ai_requests set state='released',charged_paise=0,settled_at=now() where id=r.id;
 elsif p_action='unknown' then
  update public.ai_requests set state='unknown',settled_at=now() where id=r.id;
 elsif p_action='settle' then
  if r.state<>'inflight' or p_usage is null or jsonb_typeof(p_usage)<>'object' or octet_length(p_usage::text)>2048 then raise exception 'Invalid usage' using errcode='22023'; end if;
  u:=(p_usage->>'input')::integer;v:=(p_usage->>'output')::integer;cached:=(p_usage->>'cached')::integer;w30:=(p_usage->>'write30')::integer;w12:=(p_usage->>'write12')::integer;reasoning:=(p_usage->>'reasoning')::integer;
  if u is null or v is null or cached is null or w30 is null or w12 is null or reasoning is null or least(u,v,cached,w30,w12,reasoning)<0 or cached::bigint+w30+w12>u or reasoning>v or greatest(u,v)>1000000 then raise exception 'Invalid usage counts' using errcode='22023'; end if;
  select * into p from private.ai_prices where model=r.model;
  cost:=ceil(((u-cached-w30-w12)*p.input_microusd+cached*p.cached_microusd+w30*p.write30_microusd+w12*p.write12_microusd+v*p.output_microusd)*15000/1000000000000)::integer;
  if length(coalesce(p_usage->>'model',''))>120 or length(coalesce(p_usage->>'response_id',''))>150 then raise exception 'Invalid references' using errcode='22023'; end if;
  update public.ai_requests set state='settled',charged_paise=cost,settled_at=now(),input_tokens=u,output_tokens=v,cached_tokens=cached,write30_tokens=w30,write12_tokens=w12,reasoning_tokens=reasoning,provider_model=p_usage->>'model',provider_response_id=p_usage->>'response_id' where id=r.id;
  if cost>r.reserved_paise or u>r.input_bound or v>r.output_bound then update private.personal_integrations set ai_enabled=false,ai_evaluation_enabled=false where owner_id=o; update private.ai_test_policies set ai_enabled=false,ai_evaluation_enabled=false where owner_id=o; end if;
 else raise exception 'Unsupported accounting action' using errcode='22023'; end if;
 select * into r from public.ai_requests where id=p_id and owner_id=o;
 return jsonb_build_object('state',r.state,'charged_paise',r.charged_paise);
end $$;
create function public.m2c_ai_budget_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1(); m date; spent bigint; evaluated bigint; pending bigint;
begin
 m:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;
 select coalesce(sum(charged_paise),0),count(*) filter(where state in ('reserved','inflight')) into spent,pending from public.ai_requests where owner_id=o and budget_month=m;
 select coalesce(sum(charged_paise),0) into evaluated from public.ai_requests where owner_id=o and purpose='evaluation';
 return jsonb_build_object('period',m,'timezone','Asia/Kolkata','estimated_committed_or_reserved_paise',spent,'remaining_paise',greatest(0,100000-spent),'evaluation_paise',evaluated,'evaluation_remaining_paise',greatest(0,20000-evaluated),'active_requests',pending,'alert80',spent>=80000,'monthly_ai_cap_paise',100000,'evaluation_cap_paise',20000,'contingency_is_not_ai',true,'invoice_total_verified',false);
end $$;
grant create on schema public,private to jarvis_auth_guard;
alter function private.m2c_ai_policy_v1(uuid) owner to jarvis_auth_guard;
do $$ declare f record; begin
 for f in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('m2c_ai_reserve_v1','m2c_ai_account_v1','m2c_ai_budget_v1') loop
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',f.proname,f.args);
  execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.args);
  execute format('alter function public.%I(%s) owner to jarvis_auth_guard',f.proname,f.args);
 end loop;
end $$;
revoke create on schema public,private from jarvis_auth_guard;
notify pgrst,'reload schema';
