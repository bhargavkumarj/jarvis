-- Additive, unapplied voice increment. Requires the complete chain including
-- pending 010 and 202610310001. No audio/transcript content is stored here.
alter table private.personal_integrations add column transcription_enabled boolean not null default false;
alter table private.ai_test_policies add column transcription_enabled boolean not null default false;
alter table private.ai_prices add column audio_usd_per_minute numeric;
insert into private.ai_prices(model,price_version,valid_until,input_microusd,cached_microusd,write30_microusd,write12_microusd,output_microusd,audio_usd_per_minute)
 values('gpt-transcribe','2026-10-31-audio-v1','2026-11-30T00:00:00+05:30',0,0,0,0,0,0.0045);
alter table public.ai_requests drop constraint ai_requests_purpose_check;
alter table public.ai_requests add constraint ai_requests_purpose_check check(purpose in ('ordinary','evaluation','transcription'));
alter table public.ai_requests add column audio_milliseconds integer,add column reported_audio_seconds numeric;
alter table public.ai_requests add constraint audio_usage_shape check((purpose='transcription' and audio_milliseconds is not null and audio_milliseconds between 200 and 60000) or (purpose<>'transcription' and audio_milliseconds is null and reported_audio_seconds is null));
create unique index voice_request_once on public.ai_requests(owner_id,request_id) where purpose='transcription';
grant select(audio_milliseconds,reported_audio_seconds) on public.ai_requests to authenticated;
create table public.voice_preferences (
 owner_id uuid primary key references public.profiles(owner_id) on delete cascade,
 cloud_transcription boolean not null default false,consent_version text,updated_at timestamptz not null default now(),
 check(not cloud_transcription or consent_version='openai-audio-2026-10-31-v1')
);
alter table public.voice_preferences enable row level security;
revoke all on public.voice_preferences from public,anon,authenticated,service_role,jarvis_reminder_worker;
grant select on public.voice_preferences to authenticated;
grant select,insert,update on public.voice_preferences to jarvis_auth_guard;
create policy voice_owned_read on public.voice_preferences for select to authenticated using(owner_id=(select auth.uid()) and (select private.has_access()));
create policy voice_guard on public.voice_preferences to jarvis_auth_guard using(true) with check(true);
create function public.voice_settings_v1(p_enabled boolean,p_consent text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();r public.voice_preferences;
begin
 if p_enabled is null or (p_enabled and p_consent is distinct from 'openai-audio-2026-10-31-v1') then raise exception 'Explicit cloud audio consent required' using errcode='22023';end if;
 insert into public.voice_preferences(owner_id,cloud_transcription,consent_version) values(o,p_enabled,case when p_enabled then p_consent else null end)
 on conflict(owner_id) do update set cloud_transcription=excluded.cloud_transcription,consent_version=excluded.consent_version,updated_at=now() returning * into r;
 return to_jsonb(r);
end $$;
create function private.voice_allowed_v1(o uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.voice_preferences where owner_id=o and cloud_transcription and consent_version='openai-audio-2026-10-31-v1') and
 coalesce((select transcription_enabled from private.personal_integrations where owner_id=o),(select transcription_enabled from private.ai_test_policies where owner_id=o),false);
$$;
create function public.voice_reserve_v1(p_request uuid,p_milliseconds integer,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();c jsonb;scope text;m date;r public.ai_requests;
begin
 -- Same global lock, scope and ledger as text usage. No separate allowance.
 perform pg_advisory_xact_lock(908410237451::bigint);
 c:=private.m2c_ai_policy_v1(o);scope:=c->>'scope';
 if not private.voice_allowed_v1(o) or scope is null then raise exception 'Transcription disabled' using errcode='42501';end if;
 if p_request is null or p_milliseconds is null or p_milliseconds not between 200 and 60000 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid voice bounds' using errcode='22023';end if;
 if not exists(select 1 from private.ai_prices where model='gpt-transcribe' and price_version='2026-10-31-audio-v1' and audio_usd_per_minute=0.0045 and valid_until>now()) then raise exception 'Audio price review required' using errcode='22023';end if;
 if exists(select 1 from public.ai_requests where owner_id=o and request_id=p_request and purpose='transcription') then raise exception 'Voice request already used; transcript is not retained' using errcode='40001';end if;
 update public.ai_requests set state='unknown',settled_at=now() where scope_id=scope and state in ('reserved','inflight') and lease_until<=now();
 if (select count(*) from public.ai_requests where scope_id=scope and state in ('reserved','inflight'))>=2 or
 exists(select 1 from public.ai_requests where owner_id=o and purpose='transcription' and state in ('reserved','inflight')) or
 (select count(*) from public.ai_requests where owner_id=o and purpose='transcription' and created_at>now()-interval '1 minute')>=4 then raise exception 'Voice concurrency/rate limit' using errcode='54000';end if;
 m:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;
 -- Reserve INR 1 for the full bounded minute (current estimated maximum INR .675).
 if (select coalesce(sum(charged_paise),0) from public.ai_requests where scope_id=scope and budget_month=m)+100>100000 then raise exception 'AI allowance insufficient' using errcode='54000';end if;
 insert into public.ai_requests(owner_id,scope_id,request_id,attempt_id,purpose,model,price_version,budget_month,input_bound,output_bound,reserved_paise,charged_paise,state,settlement_hash,audio_milliseconds)
 values(o,scope,p_request,gen_random_uuid(),'transcription','gpt-transcribe','2026-10-31-audio-v1',m,1,1,100,100,'reserved',p_hash,p_milliseconds) returning * into r;
 return jsonb_build_object('id',r.id,'reserved_paise',r.reserved_paise);
end $$;
create function public.voice_account_v1(p_action text,p_id uuid,p_token text,p_seconds numeric default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=private.m2a_owner_v1();r public.ai_requests;cost integer;
begin
 perform pg_advisory_xact_lock(908410237451::bigint);
 select * into r from public.ai_requests where id=p_id and owner_id=o and purpose='transcription' for update;
 if not found or p_token is null or length(p_token)<>64 or r.settlement_hash<>encode(sha256(convert_to(p_token,'UTF8')),'hex') then raise exception 'Voice reservation unavailable' using errcode='42501';end if;
 if r.state not in ('reserved','inflight') then return jsonb_build_object('state',r.state,'charged_paise',r.charged_paise,'dispatched',false);end if;
 if p_action='dispatch' then
  if r.state<>'reserved' or r.lease_until<=now() or not private.voice_allowed_v1(o) then raise exception 'Voice dispatch unavailable' using errcode='42501';end if;
  if r.budget_month<>date_trunc('month',now() at time zone 'Asia/Kolkata')::date then update public.ai_requests set state='released',charged_paise=0,settled_at=now() where id=r.id;return jsonb_build_object('state','released','dispatched',false);end if;
  update public.ai_requests set state='inflight',dispatched_at=now() where id=r.id;return jsonb_build_object('state','inflight','dispatched',true);
 elsif p_action='release' then
  if r.state<>'reserved' then raise exception 'Cannot refund dispatched audio' using errcode='40001';end if;
  update public.ai_requests set state='released',charged_paise=0,settled_at=now() where id=r.id;
 elsif p_action='unknown' then update public.ai_requests set state='unknown',settled_at=now() where id=r.id;
 elsif p_action='settle' then
  if r.state<>'inflight' or p_seconds is null or p_seconds::text in ('NaN','Infinity','-Infinity') or p_seconds<=0 or p_seconds>60 then raise exception 'Unverified audio usage' using errcode='22023';end if;
  cost:=ceil(p_seconds*0.0045/60*15000)::integer;
  update public.ai_requests set state='settled',charged_paise=cost,reported_audio_seconds=p_seconds,settled_at=now(),provider_model='gpt-transcribe' where id=r.id;
 else raise exception 'Unsupported voice accounting action' using errcode='22023';end if;
 select * into r from public.ai_requests where id=r.id;return jsonb_build_object('state',r.state,'charged_paise',r.charged_paise);
end $$;
-- Text accounting must not interpret duration-priced audio as zero-price tokens.
grant create on schema private,public to jarvis_auth_guard;
set local role jarvis_auth_guard;
alter function public.m2c_ai_reserve_v1(uuid,uuid,text,text,integer,integer,text) rename to m2c_ai_reserve_before_voice_v1;
revoke all on function public.m2c_ai_reserve_before_voice_v1(uuid,uuid,text,text,integer,integer,text) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker;
alter function public.m2c_ai_reserve_before_voice_v1(uuid,uuid,text,text,integer,integer,text) set schema private;
alter function public.m2c_ai_account_v1(text,uuid,text,jsonb) rename to m2c_ai_account_before_voice_v1;
revoke all on function public.m2c_ai_account_before_voice_v1(text,uuid,text,jsonb) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker;
alter function public.m2c_ai_account_before_voice_v1(text,uuid,text,jsonb) set schema private;
reset role;
create function public.m2c_ai_reserve_v1(p_request uuid,p_attempt uuid,p_purpose text,p_model text,p_input integer,p_output integer,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_purpose not in ('ordinary','evaluation') or p_model not in ('gpt-6-luna','gpt-6.1-sol') then raise exception 'Use the duration-priced audio boundary' using errcode='22023';end if;
 return private.m2c_ai_reserve_before_voice_v1(p_request,p_attempt,p_purpose,p_model,p_input,p_output,p_hash);
end $$;
create function public.m2c_ai_account_v1(p_action text,p_id uuid,p_token text,p_usage jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.ai_requests where id=p_id and owner_id=private.m2a_owner_v1() and purpose='transcription') then perform private.m2a_owner_v1();raise exception 'Use audio accounting' using errcode='42501';end if;
 return private.m2c_ai_account_before_voice_v1(p_action,p_id,p_token,p_usage);
end $$;
do $$ declare f record;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='public' and p.proname in ('voice_settings_v1','voice_reserve_v1','voice_account_v1','m2c_ai_reserve_v1','m2c_ai_account_v1')) or (n.nspname='private' and p.proname='voice_allowed_v1') loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role,authenticator,jarvis_reminder_worker',f.nspname,f.proname,f.args);
 execute format('alter function %I.%I(%s) owner to jarvis_auth_guard',f.nspname,f.proname,f.args);
 end loop;
end $$;
set local role jarvis_auth_guard;
grant execute on function public.voice_settings_v1(boolean,text),public.voice_reserve_v1(uuid,integer,text),public.voice_account_v1(text,uuid,text,numeric),public.m2c_ai_reserve_v1(uuid,uuid,text,text,integer,integer,text),public.m2c_ai_account_v1(text,uuid,text,jsonb) to authenticated;
reset role;
revoke create on schema private,public from jarvis_auth_guard;
notify pgrst,'reload schema';
