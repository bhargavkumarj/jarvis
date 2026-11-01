import { generationBatch,type ReminderSeries } from '../lib/reminders/recurrence.ts';
import {privacyTick,sweepPrivacyQueue,type QueueSweep,type PrivacyWork} from './privacy.ts';
import { PgBoss } from 'pg-boss';
import postgres from 'postgres';
import {readLiveConfig,pushBinding} from '../lib/live/config.ts';
import {deliverNotification,type DispatchAttempt} from './delivery.ts';
type JobData={reminder_id:string;owner_id:string;version:number};
type Outbox={id:string;lease:string;kind:'schedule'|'cancel';reminder_id:string;owner_id:string;version:number;due_at:string;job_id:string|null;fault:string};
export async function startWorker(connection:string,run:string|null=null) {
 if(run!==null&&!/^[a-f0-9]{24}$/.test(run)) throw new Error('Invalid isolated worker scope');
 const live=run?null:readLiveConfig();
 const binding=live?pushBinding(live):null;
 const queue=run?`reminders_test_${run}`:'reminders_v1';
 const sql=postgres(connection,{max:3,connect_timeout:5,onnotice:()=>{}});
 const boss=new PgBoss({connectionString:connection,schema:'jarvis_jobs',migrate:false,createSchema:false,schedule:false,
  supervise:true,superviseIntervalSeconds:5,monitorIntervalSeconds:5,maintenanceIntervalSeconds:60,
  reindex:false,monitorVacuum:false,persistQueueStats:false,persistWarnings:false,registerInstance:false,max:4});
 // Never print vendor error messages or query text/payloads.
 boss.on('error',()=>{console.error(JSON.stringify({worker:'queue_error',action:'check_local_services_and_permissions'}));});
 const rpc=async<T=unknown>(action:string,data:Record<string,unknown>={})=>{
  try {
   const rows=await sql`select private.m2b_worker_v1(${action},${sql.json({...data,binding} as postgres.JSONValue)},${run}) as value`;
   return rows[0].value as T;
  } catch (error) {
   const code=(error as {code?:string}).code;
   console.error(JSON.stringify({worker:'domain_error',operation:action,sqlstate:code&&/^[0-9A-Z]{5}$/.test(code)?code:null}));
   // Do not let pg-boss persist a driver error/detail containing a failing row.
   // eslint-disable-next-line preserve-caught-error -- pg-boss serializes causes; driver details may contain a failing content row.
   throw new Error('Reminder domain operation unavailable.');
  }
 };
 let stopped=false,ticking=false,lastMaintenance=0;
 const pause=async(stage:string)=>{if(run){process.send?.({stage});await new Promise<void>(()=>{});}};
 async function reconcile() {
  if(ticking||stopped)return;ticking=true;
  try {
   if(!run&&Date.now()-lastMaintenance>60000){
    lastMaintenance=Date.now();try{await sql`select private.m2c_cleanup_v1(null)`;}catch{console.error(JSON.stringify({worker:'retention_unavailable',action:'apply_local_migrations_and_check_worker_permissions'}));}
   }
   if(!run){try{
    const work=async<T=unknown>(action:string,j?:PrivacyWork,count=0,code:string|null=null)=>{const [r]=await sql`select private.privacy_work_v1(${action},${j?.id??null},${j?.lease??null},${count},${code}) value`;return r.value as T;};
    await privacyTick({claim:()=>work<PrivacyWork|null>('claim'),purge:async j=>{await work('purge',j);},jobs:owner=>boss.findJobs(queue,{data:{owner_id:owner},limit:100}),remove:async ids=>{await boss.deleteJob(queue,ids);},queueDone:async(j,n)=>{await work('queue_done',j,n);},fail:async(j,code)=>{await work('failed',j,0,code);}});
    const sweep=async<T=unknown>(action:string,j?:QueueSweep,cursor:string|null=null,rows:unknown[]=[])=>{const [r]=await sql`select private.privacy_queue_v1(${action},${j?.id??null},${cursor},${sql.json(rows as postgres.JSONValue)}) value`;return r.value as T;};
    await sweepPrivacyQueue({next:()=>sweep<QueueSweep|null>('next'),jobs:(owner,cursor)=>boss.findJobs<JobData>(queue,{data:{owner_id:owner},limit:100,...(cursor?{after:cursor}:{})}),filter:(j,rows)=>sweep<string[]>('filter',j,null,rows.map(r=>({job_id:r.id,reminder_id:r.data.reminder_id}))),remove:async ids=>{await boss.deleteJob(queue,ids);},checkpoint:async(j,cursor)=>{await sweep('checkpoint',j,cursor);}});
   }catch{console.error(JSON.stringify({worker:'privacy_cleanup_unavailable',action:'inspect_privacy_jobs_and_migrations'}));}}
   for(const series of await rpc<ReminderSeries[]>('series_plans')) {
    try{await rpc('series_advance',{id:series.id,version:series.version,cursor_date:series.cursor_date,candidates:generationBatch(series)});}
    catch{console.error(JSON.stringify({worker:'series_calendar_error',action:'inspect_schedule_and_tzdb_on_new_machine'}));}
    // A single invalid/tzdb-disagreeing series must not block manual reminders.
   }
   await rpc('recover');
   for(const e of await rpc<Outbox[]>('outbox')) {
    try {
     if(e.fault==='enqueue_failure') throw new Error('Isolated enqueue fault');
     if(e.kind==='cancel') {if(e.job_id)await boss.cancel(queue,e.job_id);}
     else {
      const data:JobData={reminder_id:e.reminder_id,owner_id:e.owner_id,version:e.version};
      const id=await boss.send(queue,data,{id:e.id,startAfter:new Date(e.due_at),retryLimit:2,retryDelay:10,retryBackoff:true,retryDelayMax:30,expireInSeconds:30,retentionSeconds:367*86400});
      if(id===null){const existing=await boss.getJobById<JobData>(queue,e.id);if(!existing||existing.data.reminder_id!==data.reminder_id||existing.data.owner_id!==data.owner_id||existing.data.version!==data.version)throw new Error('Queue identity mismatch');}
     }
     await rpc('enqueued',{id:e.id,lease:e.lease});
    }catch{await rpc('enqueue_failed',{id:e.id,lease:e.lease});}
   }
   for(const r of await rpc<{id:string;queue_job_id:string;version:number}[]>('jobs')) {
    const job=await boss.getJobById(queue,r.queue_job_id);
    if(!job||['cancelled','failed','completed'].includes(job.state)) await rpc('repair',{id:r.id,job_id:r.queue_job_id});
   }
  }finally{ticking=false;}
 }
 try {
  await boss.start();
  if(!await boss.getQueue(queue))throw new Error('Worker queue not installed; run worker:setup.');
  await reconcile();
  await boss.work<JobData>(queue,{batchSize:1,pollingIntervalSeconds:1},async jobs=>{
   for(const job of jobs){
    const attempt=await rpc<DispatchAttempt|null>('claim',{...job.data,job_id:job.id});
    if(!attempt)continue;
    if(attempt.scenario==='pause_before_authorize') await pause('before_authorize');
    if(!await rpc<boolean>('authorize',attempt))continue;
    const {outcome,code}=await deliverNotification(attempt,live,!!run,{
     mock:async id=>{await rpc('mock_accept',{attempt_id:id});},
     provider:async(id,reference)=>{await rpc('provider_accept',{attempt_id:id,reference});},
    });
    if(attempt.scenario==='pause_after_accept') await pause('after_accept');
    const result=await rpc<{retry:boolean}>('finish',{attempt_id:attempt.attempt_id,outcome,code});
    if(result.retry)throw new Error('Provider rejected before acceptance; bounded retry.');
   }
  });
 }catch(error){await boss.stop({graceful:false}).catch(()=>{});await sql.end({timeout:2});throw error;}
 const timer=setInterval(()=>{void reconcile().catch(()=>console.error(JSON.stringify({worker:'reconciliation_error',action:'check_local_services_and_migrations'})));},2000);
 process.send?.({stage:'ready'});
 return {async stop(){stopped=true;clearInterval(timer);await boss.stop({graceful:true,timeout:5000});while(ticking)await new Promise(r=>setTimeout(r,20));await sql.end({timeout:2});}};
}
