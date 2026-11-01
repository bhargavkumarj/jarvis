// WRITTEN — NOT EXECUTED on the old machine. Ordinary JWT assertions are real
// Data API/RLS checks; installer SQL below is fixture setup/catalog inspection only.
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import postgres from 'postgres';
import {Temporal} from '@js-temporal/polyfill';
import {localFixtures} from '../support/local-fixtures';
import type {Database} from '../../src/lib/database.types';
import {DST_POLICY,reviewRecurrence,generationBatch,occurrenceOn,type ReminderSeries} from '../../src/lib/reminders/recurrence';
import type {Reminder,OperationReceipt} from '../../src/lib/reminders/types';
import type {Json} from '../../src/lib/database.generated';
let f:Awaited<ReturnType<typeof localFixtures>>,a:SupabaseClient<Database>,b:SupabaseClient<Database>,ownerA:string,ownerB:string,worker:ReturnType<typeof postgres>;
function good<T>(r:{data:unknown;error:{code?:string}|null}):T{if(r.error)throw new Error(`Recurrence fixture SQLSTATE ${r.error.code??'unknown'}; details suppressed.`);return r.data as T;}
function schedule(){return {title:'Synthetic recurrence',frequency:'daily' as const,weekdays:[],start_date:Temporal.Now.plainDateISO('UTC').add({days:1}).toString(),end_date:null,local_time:'12:00',timezone:'UTC',channel:'mock' as const,dst_policy:DST_POLICY,late_minutes:5};}
async function call(action:string,data:unknown,client=a,key=crypto.randomUUID()){return client.rpc('reminder_series_v1',{p_action:action,p_request:key,p_data:data as Json});}
async function review(id?:string,version?:number){return good<{series:ReminderSeries}>(await call('review',{...reviewRecurrence(schedule()),...(id?{id,version}:{})})).series;}
async function confirm(s:ReminderSeries,key=crypto.randomUUID()){return good<{series:ReminderSeries;operation:{id:string};replay:boolean}>(await call('confirm',{id:s.id,version:s.version,review_version:s.review_version,review:s.review},a,key));}
async function occurrence(s:ReminderSeries){return good<Reminder[]>(await a.from('reminders').select('*').eq('series_id',s.id).eq('series_version',s.version))[0];}
async function wrpc(action:string,data:unknown){const r=await worker`select private.m2b_worker_v1(${action},${worker.json(data as postgres.JSONValue)},null) value`;return r[0].value;}
// Worker runtime credential is locally read by support code; never printed.
import {readWorkerConfig} from '../../scripts/worker-config.mjs';
describe('recurrence real ownership, transactions and worker fencing (written—not executed)',()=>{
 beforeAll(async()=>{
  f=await localFixtures();const auth={persistSession:false,autoRefreshToken:false};a=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});b=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});
  const aa=await a.auth.signInWithPassword(f.users.alex),bb=await b.auth.signInWithPassword(f.users.sam);if(!aa.data.user||!bb.data.user)throw new Error('Synthetic identities unavailable.');ownerA=aa.data.user.id;ownerB=bb.data.user.id;
  worker=postgres(readWorkerConfig(),{max:2,onnotice:()=>{},connect_timeout:5});
 });
 beforeEach(async()=>{
  // Quota clock fixture for this exact random account; not authorization evidence.
  await f.sql`update public.series_operations set created_at=now()-interval '2 minutes' where owner_id=${ownerA}`;
  await f.sql`update public.reminder_operations set created_at=now()-interval '2 minutes' where owner_id=${ownerA}`;
 });
 afterAll(async()=>{await worker?.end({timeout:2});await f?.close();});
 it('restricts series tables, helper/delegate execution and schema creation',async()=>{
  const s=await review();for(const table of ['reminder_series','series_operations'] as const){expect((await b.from(table).select('*').eq('owner_id',ownerA)).data).toEqual([]);expect((await b.from(table).insert({owner_id:ownerA})).error).not.toBeNull();expect((await a.from(table).update({owner_id:ownerB}).eq('owner_id',ownerA)).error).not.toBeNull();}
  const [acl]=await f.sql`select has_function_privilege('authenticated','private.m2b_worker_before_recurrence_v1(text,jsonb,text)','EXECUTE') old_worker,has_function_privilege('authenticated','private.m2b_reminder_before_recurrence_v1(text,uuid,jsonb)','EXECUTE') old_web,has_schema_privilege('jarvis_auth_guard','private','CREATE') ddl,has_function_privilege('jarvis_reminder_worker','public.reminder_series_v1(text,uuid,jsonb)','EXECUTE') worker_web`;
  expect(Object.values(acl).some(Boolean)).toBe(false);expect((await a.from('reminder_series').select('id').eq('id',s.id)).data).toHaveLength(1);
 });
 it('denies forged series IDs and owner fields without mutation',async()=>{
  const s=await review();for(const action of ['confirm','pause','resume','cancel','skip'])expect((await call(action,{id:s.id,version:s.version,review_version:s.review_version,review:s.review},b)).error).not.toBeNull();
  expect((await call('review',{...reviewRecurrence(schedule()),owner_id:ownerB})).error?.code).toBe('22023');expect((await a.from('reminder_series').select('state').eq('id',s.id)).data?.[0].state).toBe('draft');
 });
 it('binds exact preview and newer review version; a draft creates no occurrence',async()=>{
  const s=await review();expect((await a.from('reminders').select('id').eq('series_id',s.id)).data).toEqual([]);
  const newer=await review(s.id,s.version);expect((await call('confirm',{id:s.id,version:s.version,review_version:s.review_version,review:s.review})).error?.code).toBe('40001');
  expect((await call('confirm',{id:newer.id,version:newer.version,review_version:newer.review_version,review:{...newer.review,schedule:{...schedule(),title:'forged'}}})).error?.code).toBe('40001');
  expect((await a.from('reminders').select('id').eq('series_id',s.id)).data).toEqual([]);
 });
 it('confirms atomically once under concurrent ordinary user requests and rejects key conflicts',async()=>{
  const s=await review(),key=crypto.randomUUID();const data={id:s.id,version:s.version,review_version:s.review_version,review:s.review};const results=await Promise.all([call('confirm',data,a,key),call('confirm',data,a,key)]);const r=results.map(x=>good<{operation:{id:string}}>(x));expect(r[0].operation.id).toBe(r[1].operation.id);
  expect((await call('pause',{id:s.id,version:s.version+1},a,key)).error?.code).toBe('40001');const [n]=await f.sql`select (select count(*)::int from public.reminders where series_id=${s.id}) occurrences,(select count(*)::int from private.reminder_outbox o join public.reminders r on r.id=o.reminder_id where r.series_id=${s.id}) events`;expect(n).toMatchObject({occurrences:1,events:1});
 });
 it('atomic failure leaves series draft, no occurrence/operation/outbox (trusted transaction fixture)',async()=>{
  const s=await review(),key=crypto.randomUUID();const session=(await a.auth.getSession()).data.session!;const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());let failed=false;
  try{await f.sql.begin(async tx=>{await tx`alter table private.reminder_outbox add constraint recurrence_fixture_fail check(false) not valid`;await tx`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`;await tx`set local role authenticated`;await tx`select public.reminder_series_v1('confirm',${key},${tx.json({id:s.id,version:s.version,review_version:s.review_version,review:s.review})})`;});}catch{failed=true;}
  expect(failed).toBe(true);expect((await a.from('reminder_series').select('state').eq('id',s.id)).data?.[0].state).toBe('draft');expect((await a.from('reminders').select('id').eq('series_id',s.id)).data).toEqual([]);
 });
 it('serializes concurrent worker occurrence creation and preserves mock routing',async()=>{
  const s=(await confirm(await review())).series;
  await f.sql`update public.reminder_series set cursor_due_at=now()-interval '1 second' where id=${s.id}`;
  const data={id:s.id,version:s.version,cursor_date:s.cursor_date,candidates:generationBatch(s)};
  await Promise.all([wrpc('series_advance',data),wrpc('series_advance',data)]);
  const rows=good<Reminder[]>(await a.from('reminders').select('*').eq('series_id',s.id));expect(rows).toHaveLength(2);expect(rows.every(r=>r.channel==='mock')).toBe(true);expect(new Set(rows.map(r=>r.occurrence_date)).size).toBe(2);
 });
 it('editing cancels unsent old occurrences and fences stale queued jobs without deleting history',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s),job=crypto.randomUUID();await f.sql`update public.reminders set queue_job_id=${job} where id=${r.id}`;
  const updated=(await confirm(await review(s.id,s.version))).series;expect(updated.version).toBe(s.version+1);expect((await a.from('reminders').select('state').eq('id',r.id)).data?.[0].state).toBe('cancelled');
  expect(await wrpc('claim',{reminder_id:r.id,owner_id:ownerA,version:r.version,job_id:job})).toBeNull();expect((await a.from('reminders').select('id').eq('series_id',s.id)).data).toHaveLength(2);
 });
 it('pause/resume/cancel preserve history and choose only a future resume occurrence',async()=>{
  const s=(await confirm(await review())).series;const paused=good<{series:ReminderSeries}>(await call('pause',{id:s.id,version:s.version})).series;
  expect((await a.from('reminders').select('state').eq('series_id',s.id)).data?.[0].state).toBe('cancelled');const resumed=good<{series:ReminderSeries}>(await call('resume',{id:s.id,version:paused.version})).series;expect(Date.parse(resumed.cursor_due_at!)).toBeGreaterThan(Date.now());
  await call('cancel',{id:s.id,version:resumed.version});expect((await a.from('reminders').select('id').eq('series_id',s.id)).data).toHaveLength(2);
 });
 it('skip is version-bound and preserves the calendar date of the following occurrence',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s);expect((await call('skip',{id:s.id,version:s.version,occurrence_id:crypto.randomUUID()})).error?.code).toBe('40001');
  good(await call('skip',{id:s.id,version:s.version,occurrence_id:r.id}));expect((await a.from('reminders').select('state').eq('id',r.id)).data?.[0].state).toBe('skipped');await wrpc('series_advance',{id:s.id,version:s.version,cursor_date:s.cursor_date,candidates:generationBatch(s)});expect((await a.from('reminders').select('id').eq('series_id',s.id)).data).toHaveLength(2);
 });
 it('snooze is owned, atomic, idempotent and changes only the selected occurrence',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s);const due=Temporal.Instant.from(r.due_at).add({minutes:10});const fields={id:r.id,version:r.version,due_at:due.toString(),local_datetime:due.toZonedDateTimeISO('UTC').toPlainDateTime().toString({smallestUnit:'second'}),resolution:'unique'};const key=crypto.randomUUID();
  expect((await b.rpc('reminder_snooze_v1',{p_request:key,p_data:fields})).error?.code).toBe('42501');
  const first=good<OperationReceipt>(await a.rpc('reminder_snooze_v1',{p_request:key,p_data:fields})),again=good<OperationReceipt>(await a.rpc('reminder_snooze_v1',{p_request:key,p_data:fields}));expect(again.operation.id).toBe(first.operation.id);expect(first.reminder.occurrence_date).toBe(r.occurrence_date);expect(first.reminder.nominal_due_at).toBe(r.nominal_due_at);
  expect((await a.from('reminder_series').select('schedule,cursor_date').eq('id',s.id)).data?.[0]).toEqual({schedule:s.schedule,cursor_date:s.cursor_date});
 });
 it('rejects snooze overlap and stale snooze after cancellation without changing target',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s),due=Temporal.Instant.from(r.due_at).add({hours:24});const fields={id:r.id,version:r.version,due_at:due.toString(),local_datetime:due.toZonedDateTimeISO('UTC').toPlainDateTime().toString({smallestUnit:'second'}),resolution:'unique'};
  expect((await a.rpc('reminder_snooze_v1',{p_request:crypto.randomUUID(),p_data:fields})).error?.code).toBe('22023');await call('cancel',{id:s.id,version:s.version});expect((await a.rpc('reminder_snooze_v1',{p_request:crypto.randomUUID(),p_data:fields})).error?.code).toBe('40001');expect((await a.from('reminders').select('due_at').eq('id',r.id)).data?.[0].due_at).toBe(r.due_at);
 });
 it('snooze cannot race past sending authorization or resurrect an unknown outcome',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s);const due=Temporal.Instant.from(r.due_at).add({minutes:10});const fields={id:r.id,version:r.version,due_at:due.toString(),local_datetime:due.toZonedDateTimeISO('UTC').toPlainDateTime().toString({smallestUnit:'second'}),resolution:'unique'};
  await f.sql`insert into public.delivery_attempts(owner_id,reminder_id,ordinal,job_id,schedule_version,state,send_started_at) values(${ownerA},${r.id},1,${crypto.randomUUID()},${r.version},'sending',now())`;
  expect((await a.rpc('reminder_snooze_v1',{p_request:crypto.randomUUID(),p_data:fields})).error?.code).toBe('40001');await call('pause',{id:s.id,version:s.version});expect((await a.from('reminders').select('cancel_requested_at,state').eq('id',r.id)).data?.[0]).toMatchObject({state:'scheduling_pending',cancel_requested_at:expect.any(String)});
  await f.sql`update public.reminders set state='outcome_unknown' where id=${r.id}`;expect((await a.rpc('reminder_snooze_v1',{p_request:crypto.randomUUID(),p_data:fields})).error?.code).toBe('40001');
 });
 it('cross-owner occurrence references fail even for installer fixture writes',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s);let denied=false;try{await f.sql`update public.reminders set owner_id=${ownerB} where id=${r.id}`;}catch{denied=true;}expect(denied).toBe(true);expect((await a.from('reminders').select('owner_id').eq('id',r.id)).data?.[0].owner_id).toBe(ownerA);
 });

 it('cancel racing snooze leaves no deliverable occurrence or stale-job dispatch',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s),job=crypto.randomUUID();await f.sql`update public.reminders set queue_job_id=${job} where id=${r.id}`;
  const due=Temporal.Instant.from(r.due_at).add({minutes:10});const fields={id:r.id,version:r.version,due_at:due.toString(),local_datetime:due.toZonedDateTimeISO('UTC').toPlainDateTime().toString({smallestUnit:'second'}),resolution:'unique'};
  const [cancelled]=await Promise.all([call('cancel',{id:s.id,version:s.version}),a.rpc('reminder_snooze_v1',{p_request:crypto.randomUUID(),p_data:fields})]);expect(cancelled.error).toBeNull();
  expect((await a.from('reminders').select('state').eq('id',r.id)).data?.[0].state).toBe('cancelled');expect(await wrpc('claim',{reminder_id:r.id,owner_id:ownerA,version:r.version,job_id:job})).toBeNull();
 });
 it('schedule edit racing snooze preserves the old history and a separate new occurrence',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s),edited=await review(s.id,s.version),due=Temporal.Instant.from(r.due_at).add({minutes:10});
  const fields={id:r.id,version:r.version,due_at:due.toString(),local_datetime:due.toZonedDateTimeISO('UTC').toPlainDateTime().toString({smallestUnit:'second'}),resolution:'unique'};
  const [changed]=await Promise.all([confirm(edited),a.rpc('reminder_snooze_v1',{p_request:crypto.randomUUID(),p_data:fields})]);expect(changed.series.version).toBe(s.version+1);
  expect((await a.from('reminders').select('state,occurrence_date').eq('id',r.id)).data?.[0]).toEqual({state:'cancelled',occurrence_date:r.occurrence_date});expect((await a.from('reminders').select('id').eq('series_id',s.id)).data).toHaveLength(2);
 });
 it('authorization racing snooze has one winner; a started send cannot be moved',async()=>{
  const s=(await confirm(await review())).series,r=await occurrence(s),job=crypto.randomUUID();
  // Controlled dispatch-time fixture, not proof of calendar calculation or external delivery.
  await f.sql`update public.reminders set due_at=now()-interval '1 second',expires_at=now()+interval '23 hours 59 minutes 59 seconds',queue_job_id=${job},state='scheduled' where id=${r.id}`;
  const attempt=await wrpc('claim',{reminder_id:r.id,owner_id:ownerA,version:r.version,job_id:job});expect(attempt).not.toBeNull();
  const due=Temporal.Instant.from(r.due_at).add({minutes:10});const fields={id:r.id,version:r.version,due_at:due.toString(),local_datetime:due.toZonedDateTimeISO('UTC').toPlainDateTime().toString({smallestUnit:'second'}),resolution:'unique'};
  const [authorized,snoozed]=await Promise.all([wrpc('authorize',{attempt_id:attempt.attempt_id}),a.rpc('reminder_snooze_v1',{p_request:crypto.randomUUID(),p_data:fields})]);
  expect(authorized===(snoozed.error!==null)).toBe(true);const current=good<Reminder[]>(await a.from('reminders').select('*').eq('id',r.id))[0];expect(current.state).toBe(authorized?'attempt_started':'scheduling_pending');
  const rows=good<{state:string}[]>(await a.from('delivery_attempts').select('state').eq('reminder_id',r.id));expect(rows[0].state).toBe(authorized?'sending':'cancelled');
 });
 it('SQL independently agrees with Temporal DST gap and fold fixtures',async()=>{
  for(const [zone,date,time] of [['America/New_York','2026-03-08','02:30'],['America/New_York','2026-11-01','01:30'],['Australia/Lord_Howe','2026-10-04','02:15']]){const s={...schedule(),timezone:zone,local_time:time};const row=await f.sql.begin(async tx=>{await tx`set local role jarvis_auth_guard`;const [row]=await tx`select private.rs_occurrence_v1(${tx.json(s)},${date}::date) value`;return row;});expect(row.value).toEqual(occurrenceOn(s,date));}
 });
});
