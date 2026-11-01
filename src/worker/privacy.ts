// Existing restricted worker: content/queue cleanup only; no Auth admin credential.
export type PrivacyWork={id:string;owner_id:string;scope:string;lease:string;phase:string};
export async function privacyTick(deps:{claim:()=>Promise<PrivacyWork|null>;purge:(j:PrivacyWork)=>Promise<void>;jobs:(owner:string)=>Promise<{id:string}[]>;remove:(ids:string[])=>Promise<void>;queueDone:(j:PrivacyWork,n:number)=>Promise<void>;fail:(j:PrivacyWork,code:string)=>Promise<void>}){
 const job=await deps.claim();if(!job)return;
 try{
  if(job.phase==='queue'){const rows=await deps.jobs(job.owner_id);if(rows.length>100)throw new Error('Queue page limit');if(rows.length)await deps.remove(rows.map(r=>r.id));await deps.queueDone(job,rows.length);}
  else await deps.purge(job);
 }catch{await deps.fail(job,job.phase==='queue'?'queue_unavailable':'cleanup_unavailable');}
}

export type QueueSweep={id:string;owner_id:string;cursor:string|null};
export async function sweepPrivacyQueue(deps:{next:()=>Promise<QueueSweep|null>;jobs:(owner:string,cursor:string|null)=>Promise<{id:string;data:{reminder_id:string}}[]>;filter:(j:QueueSweep,rows:{id:string;data:{reminder_id:string}}[])=>Promise<string[]>;remove:(ids:string[])=>Promise<void>;checkpoint:(j:QueueSweep,cursor:string|null)=>Promise<void>}){
 const j=await deps.next();if(!j)return;let rows;
 try{rows=await deps.jobs(j.owner_id,j.cursor);}catch{await deps.checkpoint(j,null);return;}
 if(rows.length>100)throw new Error('Queue sweep page limit');const erase=new Set(await deps.filter(j,rows));const ids=rows.filter(r=>erase.has(r.id)).map(r=>r.id);if(ids.length)await deps.remove(ids);
 const retained=rows.filter(r=>!erase.has(r.id));await deps.checkpoint(j,rows.length<100?null:retained.at(-1)?.id??null);
}
