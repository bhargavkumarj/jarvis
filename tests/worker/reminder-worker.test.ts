import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {fork,type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {PgBoss} from 'pg-boss';
import postgres from 'postgres';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {localFixtures} from '../support/local-fixtures';
import {readWorkerConfig} from '../../scripts/worker-config.mjs';
import type {Database} from '../../src/lib/database.types';
import type {OperationReceipt,Reminder} from '../../src/lib/reminders/types';
import {snapshot} from '../../src/lib/reminders/types';
import {resolveSchedule} from '../../src/lib/reminders/time';
let f:Awaited<ReturnType<typeof localFixtures>>,a:SupabaseClient<Database>,boss:PgBoss,workerSql:ReturnType<typeof postgres>,run:string,queue:string;
const diagnostics=new Set<string>();
const children:ChildProcess[]=[];const stages=new WeakMap<ChildProcess,Set<string>>();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>Promise<boolean>,message:string,timeout=50_000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(250);}throw new Error(`${message}; sanitized worker diagnostics: ${[...diagnostics].join(", ")||"none"}`);}
async function rpc<T=unknown>(action:string,data:Record<string,string|number|boolean|null>={}){const rows=await workerSql`select private.m2b_worker_v1(${action},${workerSql.json(data)},${run}) value`;return rows[0].value as T;}
async function start(){
 const child=fork(new URL('../../scripts/worker.mjs',import.meta.url),[],{env:{...process.env,M2B_TEST_RUN:run},stdio:['ignore','ignore','pipe','ipc']});children.push(child);stages.set(child,new Set());
 child.stderr?.on('data',(chunk:Buffer)=>{for(const line of chunk.toString().split('\n')){try{const raw=JSON.parse(line);const safe:Record<string,string|number>={};for(const key of ['worker','operation','sqlstate','category','routine','routineLine']){const value=raw[key];if(typeof value==='number'||(typeof value==='string'&&/^[a-zA-Z0-9_]{1,70}$/.test(value)))safe[key]=value;}if(Object.keys(safe).length)diagnostics.add(JSON.stringify(safe));}catch{/* Non-JSON output is intentionally discarded. */}}});
 child.on('message',(message:unknown)=>{if(message&&typeof message==='object'&&'stage' in message)stages.get(child)!.add(String(message.stage));});
 await until(async()=>{if(child.exitCode!==null)throw new Error(`Restricted worker exited during startup: ${[...diagnostics].join(', ')||'no diagnostic'}`);return stages.get(child)!.has('ready');},'Worker did not become ready',12_000);return child;
}
async function stop(child:ChildProcess,signal:'SIGTERM'|'SIGKILL'='SIGTERM'){
 if(child.exitCode!==null||child.signalCode!==null)return;child.kill(signal);
 await until(async()=>child.exitCode!==null||child.signalCode!==null,'Owned test worker did not stop',9000);
}
async function create(scenario='accept',seconds=7,enqueueFailures=0){
 const local=new Date(Date.now()+seconds*1000).toISOString().slice(0,19);
 const {channel:_channel,...data}=resolveSchedule({title:'Synthetic worker reminder',local_datetime:local,timezone:'UTC'});void _channel;
 const review=await a.rpc('m2b_reminder_v1',{p_action:'review',p_request:crypto.randomUUID(),p_data:data});
 if(review.error)throw new Error(`Review fixture SQLSTATE ${review.error.code}`);
 const draft=(review.data as unknown as OperationReceipt).reminder;
 await f.sql`insert into private.reminder_test_controls(reminder_id,owner_id,run_id,scenario,enqueue_failures) values(${draft.id},${draft.owner_id},${run},${scenario},${enqueueFailures})`;
 const confirmed=await a.rpc('m2b_reminder_v1',{p_action:'confirm',p_request:crypto.randomUUID(),p_data:{id:draft.id,version:draft.version,snapshot:snapshot(draft)}});
 if(confirmed.error)throw new Error(`Confirm fixture SQLSTATE ${confirmed.error.code}`);
 return (confirmed.data as unknown as OperationReceipt).reminder;
}
async function row(id:string){const result=await a.from('reminders').select('*').eq('id',id).single();if(result.error)throw new Error('Own reminder read failed');return result.data;}
async function state(id:string,wanted:string){await until(async()=>(await row(id)).state===wanted,`Reminder did not reach ${wanted}`);}
async function receipts(id:string){const [r]=await f.sql`select count(*)::integer n from private.mock_notification_receipts where reminder_id=${id}`;return r.n;}
async function cancel(r:Reminder){const result=await a.rpc('m2b_reminder_v1',{p_action:'cancel',p_request:crypto.randomUUID(),p_data:{id:r.id,version:r.version}});if(result.error)throw new Error(`Cancel SQLSTATE ${result.error.code}`);return result.data as unknown as OperationReceipt;}
beforeAll(async()=>{
 f=await localFixtures();a=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 if((await a.auth.signInWithPassword(f.users.alex)).error)throw new Error('Synthetic sign-in failed');
 workerSql=postgres(readWorkerConfig(),{max:2,connect_timeout:5,onnotice:()=>{}});
 boss=new PgBoss({connectionString:f.status.DB_URL,schema:'jarvis_jobs',migrate:false,createSchema:false,schedule:false,supervise:false,registerInstance:false});boss.on('error',()=>{});await boss.start();
});
beforeEach(async()=>{
 diagnostics.clear();run=randomBytes(12).toString('hex');queue=`reminders_test_${run}`;
 await boss.createQueue(queue,{policy:'standard',partition:false,retryLimit:2,retryDelay:10,retryBackoff:true,retryDelayMax:30,expireInSeconds:30,retentionSeconds:367*86400});
});
afterEach(async()=>{for(const c of children.splice(0))await stop(c,'SIGKILL');if(queue)await boss?.deleteQueue(queue);});
afterAll(async()=>{await boss?.stop({graceful:true,timeout:3000});await workerSql?.end({timeout:2});if(f){const ids=await f.sql`select id from auth.users where email in (${f.users.alex.email},${f.users.sam.email})`;for(const {id} of ids){await f.sql`delete from private.privacy_jobs where owner_id=${id}`;await f.sql`delete from private.privacy_events where owner_id=${id}`;}}await f?.close();});
it('a real restricted worker persists a future job, stops before due, restarts and records one logical acceptance without the web app',async()=>{
 const r=await create('accept',14);const child=await start();await state(r.id,'scheduled');
 const queued=await boss.getJobById(queue,(await row(r.id)).queue_job_id!);expect(queued?.state).toBe('created');
 await stop(child);const saved=await row(r.id);expect(saved.state).toBe('scheduled');expect(await receipts(r.id)).toBe(0);
 await start();await state(r.id,'simulated_acceptance');expect(await receipts(r.id)).toBe(1);
 const attempts=await a.from('delivery_attempts').select('*').eq('reminder_id',r.id);expect(attempts.data).toHaveLength(1);
});
it('failed enqueue leaves committed outbox recoverable; reconciliation schedules it later',async()=>{
 const r=await create('accept',12,1);await start();
 await until(async()=>{const [e]=await f.sql`select enqueue_count from private.reminder_outbox where reminder_id=${r.id}`;return e.enqueue_count>=2;},'Outbox was not retried');
 await state(r.id,'simulated_acceptance');expect(await receipts(r.id)).toBe(1);
});
it('reconciles a missing effective queue job with bounded generation repair',async()=>{
 const r=await create('accept',14);const child=await start();await state(r.id,'scheduled');await stop(child);
 await boss.deleteJob(queue,(await row(r.id)).queue_job_id!);await start();
 await state(r.id,'simulated_acceptance');expect((await row(r.id)).enqueue_generation).toBe(2);expect(await receipts(r.id)).toBe(1);
});
it('two real workers cannot create duplicate logical attempts or receipts',async()=>{
 const r=await create('accept',9);await Promise.all([start(),start()]);await state(r.id,'simulated_acceptance');
 expect(await receipts(r.id)).toBe(1);expect((await a.from('delivery_attempts').select('id').eq('reminder_id',r.id)).data).toHaveLength(1);
});
it('only proven pre-acceptance transient rejection retries; permanent and unknown outcomes terminate without blind replay',async()=>{
 const retry=await create('retry_once',7),permanent=await create('permanent',7),unknown=await create('timeout_unknown',7),exhausted=await create('always_retry',7);await start();
 await state(retry.id,'simulated_acceptance');await state(permanent.id,'failed');await state(unknown.id,'outcome_unknown');await state(exhausted.id,'failed');expect((await row(exhausted.id)).attempt_count).toBe(3);expect(await receipts(exhausted.id)).toBe(0);
 expect((await row(retry.id)).attempt_count).toBe(2);expect(await receipts(retry.id)).toBe(1);
 expect((await row(permanent.id)).attempt_count).toBe(1);expect((await row(unknown.id)).attempt_count).toBe(1);expect(await receipts(unknown.id)).toBe(0);
 await sleep(6000);expect((await row(unknown.id)).attempt_count).toBe(1);
});
it('cancellation wins before dispatch authorization even when a worker already prepared an attempt',async()=>{
 const r=await create('pause_before_authorize',7);const child=await start();await until(async()=>stages.get(child)!.has('before_authorize'),'No prepared attempt pause');
 const cancelled=await cancel(r);expect(cancelled.operation.result.in_flight).toBe(false);await stop(child,'SIGKILL');
 await start();expect((await row(r.id)).state).toBe('cancelled');expect(await receipts(r.id)).toBe(0);
});
it('an in-flight mock acceptance cannot be recalled; restart recovers its receipt without another dispatch',async()=>{
 const r=await create('pause_after_accept',7);const child=await start();await until(async()=>stages.get(child)!.has('after_accept'),'No accepted attempt pause');
 const result=await cancel(r);expect(result.operation.result.in_flight).toBe(true);await stop(child,'SIGKILL');
 // Controlled fixture clock: expire only this run's lease, never global queue time.
 await f.sql`update public.delivery_attempts set lease_until=now()-interval '1 second' where reminder_id=${r.id}`;
 await start();await state(r.id,'simulated_acceptance');expect(await receipts(r.id)).toBe(1);expect((await row(r.id)).attempt_count).toBe(1);
});
it('interruption after send authorization without a receipt becomes unknown instead of replaying',async()=>{
 const r=await create('pause_before_authorize',7);const child=await start();await until(async()=>stages.get(child)!.has('before_authorize'),'No pause');
 const [attempt]=await f.sql`select id from public.delivery_attempts where reminder_id=${r.id}`;expect(await rpc('authorize',{attempt_id:attempt.id})).toBe(true);
 await stop(child,'SIGKILL');await f.sql`update public.delivery_attempts set lease_until=now()-interval '1 second' where reminder_id=${r.id}`;
 await start();await state(r.id,'outcome_unknown');expect(await receipts(r.id)).toBe(0);expect((await row(r.id)).attempt_count).toBe(1);
});
it('disabled accounts and overdue catch-up expiry prevent sending',async()=>{
 const disabled=await create('accept',7),overdue=await create('accept',7);const child=await start();await state(disabled.id,'scheduled');await state(overdue.id,'scheduled');await stop(child);
 await f.sql`update public.reminders set due_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where id=${overdue.id}`;
 await f.sql`update private.admissions set enabled=false where owner_id=${disabled.owner_id}`;
 try{await start();await until(async()=>{const [d]=await f.sql`select state from public.reminders where id=${disabled.id}`;return d.state==='failed';},'Disabled account was not denied');}
 finally{await f.sql`update private.admissions set enabled=true where owner_id=${disabled.owner_id}`;}
 expect((await row(overdue.id)).state).toBe('expired');expect(await receipts(disabled.id)).toBe(0);expect(await receipts(overdue.id)).toBe(0);
});
it('bounded domain reconciliation rotates across more than one batch and account (catalog fixtures, not scheduling proof)',async()=>{
 const [{alex,sam}]=await f.sql`select (select id from auth.users where email=${f.users.alex.email}) alex,(select id from auth.users where email=${f.users.sam.email}) sam`;
 const fixtures=await f.sql`insert into public.reminders(owner_id,title,local_datetime,timezone,due_at,expires_at,resolution,state,queue_job_id)
 select case when n%2=0 then ${alex}::uuid else ${sam}::uuid end,'Synthetic rotation fixture',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),'UTC',now()+interval '1 hour',now()+interval '25 hours','unique','scheduled',gen_random_uuid() from generate_series(1,70) n returning id,owner_id`;
 for(const r of fixtures)await f.sql`insert into private.reminder_test_controls(reminder_id,owner_id,run_id) values(${r.id},${r.owner_id},${run})`;
 const first=await rpc<{id:string}[]>('jobs'),second=await rpc<{id:string}[]>('jobs');
 expect(first).toHaveLength(50);expect(second).toHaveLength(50);expect(new Set([...first,...second].map(r=>r.id)).size).toBe(70);
});
// Recurrence additions: written—not executed in the deferred-runtime phase.
it('isolated recurring series survives a real worker restart and generates the next occurrence independently',async()=>{
 const {Temporal}=await import('@js-temporal/polyfill');const {reviewRecurrence,DST_POLICY}=await import('../../src/lib/reminders/recurrence');
 const due=Temporal.Instant.fromEpochMilliseconds(Math.ceil((Date.now()+15000)/60000)*60000).toZonedDateTimeISO('UTC');
 const review=reviewRecurrence({title:'Synthetic recurring restart',frequency:'daily',weekdays:[],start_date:due.toPlainDate().toString(),end_date:null,local_time:due.toPlainTime().toString({smallestUnit:'minute'}),timezone:'UTC',channel:'mock',dst_policy:DST_POLICY,late_minutes:5});
 const draftResult=await a.rpc('reminder_series_v1',{p_action:'review',p_request:crypto.randomUUID(),p_data:review});if(draftResult.error)throw new Error(`Series review SQLSTATE ${draftResult.error.code}`);
 const draft=(draftResult.data as unknown as {series:import('../../src/lib/reminders/recurrence').ReminderSeries}).series;
 await f.sql`insert into private.series_test_controls(series_id,owner_id,run_id) values(${draft.id},${draft.owner_id},${run})`;
 const confirmed=await a.rpc('reminder_series_v1',{p_action:'confirm',p_request:crypto.randomUUID(),p_data:{id:draft.id,version:draft.version,review_version:draft.review_version,review:draft.review}});if(confirmed.error)throw new Error(`Series confirm SQLSTATE ${confirmed.error.code}`);
 const initial=await a.from('reminders').select('*').eq('series_id',draft.id);if(initial.error||initial.data.length!==1)throw new Error('Initial owned occurrence missing.');const first=initial.data[0];
 const child=await start();await state(first.id,'scheduled');await stop(child);expect(await receipts(first.id)).toBe(0);
 await start();await until(async()=>(await row(first.id)).state==='simulated_acceptance','Recurring restart acceptance missing',100000);
 expect(await receipts(first.id)).toBe(1);
 await until(async()=>{const r=await a.from('reminders').select('id').eq('series_id',draft.id);return r.data?.length===2;},'Next occurrence was not generated');
 const rows=await a.from('reminders').select('*').eq('series_id',draft.id).order('due_at');expect(rows.data?.[1].occurrence_date).toBe(due.toPlainDate().add({days:1}).toString());expect(rows.data?.[1].state).toMatch(/scheduled|scheduling_pending/);
 const stopSeries=await a.rpc('reminder_series_v1',{p_action:'cancel',p_request:crypto.randomUUID(),p_data:{id:draft.id,version:draft.version+1}});expect(stopSeries.error).toBeNull();
});
// Task-linked worker cases: written—not executed in this runtime-deferred phase.
async function taskLinked(scenario:string){
 const {resolveTask}=await import('../../src/lib/tasks/model');
 const {data,error}=await a.rpc('task_command_v1',{p_action:'save',p_request:crypto.randomUUID(),p_data:{values:resolveTask({title:'Synthetic worker task',notes:'No content in provider',due:{kind:'none'}})}});if(error)throw new Error(`Task fixture SQLSTATE ${error.code}`);
 let t=(data as unknown as import('../../src/lib/tasks/model').TaskReceipt).task!;
 const schedule=resolveSchedule({title:'Task reminder',local_datetime:new Date(Date.now()+10000).toISOString().slice(0,19),timezone:'UTC'});
 const review=await a.rpc('task_command_v1',{p_action:'review_reminder',p_request:crypto.randomUUID(),p_data:{id:t.id,version:t.version,schedule}});if(review.error)throw new Error(`Task review SQLSTATE ${review.error.code}`);
 const draft=review.data as unknown as import('../../src/lib/tasks/model').TaskReceipt;t=draft.task!;const r=draft.reminder!;
 await f.sql`insert into private.reminder_test_controls(reminder_id,owner_id,run_id,scenario) values(${r.id},${r.owner_id},${run},${scenario})`;
 const result=await a.rpc('task_command_v1',{p_action:'confirm_reminder',p_request:crypto.randomUUID(),p_data:{id:t.id,version:t.version,reminder_review:t.reminder_review,reminder_snapshot:snapshot(r)}});if(result.error)throw new Error(`Task confirm SQLSTATE ${result.error.code}`);return result.data as unknown as import('../../src/lib/tasks/model').TaskReceipt;
}
it('task completion wins before authorization; stale queued work and reopen cannot dispatch it',async()=>{
 const linked=await taskLinked('pause_before_authorize'),r=linked.reminder!,t=linked.task!;const child=await start();await until(async()=>stages.get(child)!.has('before_authorize'),'Task attempt not prepared');
 const done=await a.rpc('task_command_v1',{p_action:'complete',p_request:crypto.randomUUID(),p_data:{id:t.id,version:t.version}});expect(done.error).toBeNull();const after=(done.data as unknown as import('../../src/lib/tasks/model').TaskReceipt).task!;
 const [attempt]=await f.sql`select id from public.delivery_attempts where reminder_id=${r.id}`;expect(await rpc('authorize',{attempt_id:attempt.id})).toBe(false);
 await stop(child,'SIGKILL');expect((await a.rpc('task_command_v1',{p_action:'reopen',p_request:crypto.randomUUID(),p_data:{id:t.id,version:after.version}})).error).toBeNull();
 await start();expect((await row(r.id)).state).toBe('cancelled');expect(await receipts(r.id)).toBe(0);expect((await a.from('tasks').select('state').eq('id',t.id)).data?.[0].state).toBe('open');
});
it('an accepted task notification never completes its task; closing in flight preserves one logical acceptance',async()=>{
 const linked=await taskLinked('pause_after_accept'),r=linked.reminder!,t=linked.task!;const child=await start();await until(async()=>stages.get(child)!.has('after_accept'),'No task acceptance pause');
 expect((await a.from('tasks').select('state').eq('id',t.id)).data?.[0].state).toBe('open');
 const done=await a.rpc('task_command_v1',{p_action:'cancel',p_request:crypto.randomUUID(),p_data:{id:t.id,version:t.version}});expect(done.error).toBeNull();expect((done.data as unknown as import('../../src/lib/tasks/model').TaskReceipt).operation.result.in_flight).toBe(true);
 const closed=(done.data as unknown as import('../../src/lib/tasks/model').TaskReceipt).task!;const detached=await a.rpc('task_command_v1',{p_action:'remove_reminder',p_request:crypto.randomUUID(),p_data:{id:closed.id,version:closed.version}});expect(detached.error).toBeNull();expect((detached.data as unknown as import('../../src/lib/tasks/model').TaskReceipt).operation.result.in_flight).toBe(true);
 await stop(child,'SIGKILL');await f.sql`update public.delivery_attempts set lease_until=now()-interval '1 second' where reminder_id=${r.id}`;
 await start();await state(r.id,'simulated_acceptance');expect(await receipts(r.id)).toBe(1);expect((await a.from('tasks').select('state').eq('id',t.id)).data?.[0].state).toBe('cancelled');expect((await row(r.id)).title).toBe('Task reminder');
});
// Privacy/worker race: written—not executed. This suite's random owner/queue only.
it('privacy task/reminder erasure denies a prepared real worker attempt and durably removes its queue job',async()=>{
 if((await a.auth.signInWithPassword(f.users.alex)).error)throw new Error('Synthetic reauthentication failed');
 const r=await create('pause_before_authorize',7),child=await start();await until(async()=>stages.get(child)!.has('before_authorize'),'No privacy race pause');expect(await receipts(r.id)).toBe(0);
 const deleted=await a.rpc('privacy_command_v1',{p_action:'delete',p_request:crypto.randomUUID(),p_data:{scope:'tasks_reminders',confirmation:'DELETE TASKS AND REMINDERS'}});if(deleted.error)throw new Error(`Privacy fixture SQLSTATE ${deleted.error.code}`);const j=(deleted.data as unknown as {job:{id:string}}).job;
 const [attempt]=await f.sql`select id from public.delivery_attempts where reminder_id=${r.id}`;expect(await rpc('authorize',{attempt_id:attempt.id})).toBe(false);expect(await receipts(r.id)).toBe(0);await stop(child,'SIGKILL');
 for(let i=0;i<100;i++){
  const [claim]=await workerSql`select private.privacy_work_v1('claim',${j.id}) value`;const current=claim.value;if(!current)break;
  if(current.phase==='queue'){const jobs=await boss.findJobs(queue,{data:{owner_id:r.owner_id},limit:100});if(jobs.length)await boss.deleteJob(queue,jobs.map(x=>x.id));await workerSql`select private.privacy_work_v1('queue_done',${current.id},${current.lease},${jobs.length})`;}
  else await workerSql`select private.privacy_work_v1('purge',${current.id},${current.lease})`;
 }
 expect((await f.sql`select state from private.privacy_jobs where id=${j.id}`)[0].state).toBe('complete');expect(await boss.findJobs(queue,{data:{owner_id:r.owner_id},limit:100})).toEqual([]);
 expect((await a.from('reminders').select('id').eq('id',r.id)).data).toEqual([]);await start();expect(await boss.findJobs(queue,{data:{owner_id:r.owner_id},limit:100})).toEqual([]);
 await f.sql`delete from private.privacy_jobs where id=${j.id}`;await f.sql`delete from private.privacy_events where owner_id=${r.owner_id}`;
});
