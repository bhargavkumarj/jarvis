// Explicit columns are duplicated at the SQL boundary: no SELECT * export.
export const EXPORT_FIELDS={
 profile:['id','display_name','assistant_name','tone','timezone','locale','created_at','updated_at','onboarding_completed_at'],
 privacy_settings:['id','text_cloud','notifications','retention_days','version','updated_at'],
 voice_settings:['id','cloud_transcription','consent_version','updated_at'],
 conversations:['id','title','created_at','expires_at'],messages:['id','conversation_id','user_text','assistant_text','state','created_at'],
 memory_proposals:['id','source_message_id','content','state','version','created_at','origin','conflict_memory_id'],memories:['id','content','state','version','source_date','source_kind','approved_at','updated_at','supersedes_id','source_message_id'],
 tasks:['id','title','notes','state','version','due_kind','due_date','due_local_datetime','due_timezone','due_at','due_resolution','review','review_version','linked_reminder_id','reminder_review_id','created_at','updated_at','completed_at','cancelled_at'],
 reminder_series:['id','state','schedule','review','version','review_version','cursor_date','cursor_due_at','created_at','updated_at'],
 reminders:['id','title','local_datetime','timezone','due_at','resolution','channel','state','version','task_id','series_id','series_version','occurrence_date','nominal_due_at','created_at','confirmed_at','scheduled_at','finished_at','cancel_requested_at'],
 delivery_history:['id','reminder_id','ordinal','state','started_at','send_started_at','finished_at','phone_observed','phone_observed_at'],
 usage:['id','purpose','model','budget_month','price_version','reserved_paise','charged_paise','state','created_at','dispatched_at','settled_at','input_tokens','output_tokens','cached_tokens','write30_tokens','write12_tokens','reasoning_tokens','audio_milliseconds','reported_audio_seconds'],
 // Computer control: paired Macs and 30-day action history. No credentials, tickets or hashes.
 computer_devices:['id','name','state','origin','enabled_actions','catalogue','created_at','last_seen_at','revoked_at'],
 computer_actions:['id','device_id','source','actions','labels','state','created_at','authorized_at','claimed_at','finished_at','results','summary'],
} as const;
export const COMPUTER_EXPORT_CATEGORIES=['computer_devices','computer_actions'] as const;
export type ExportCategory=keyof typeof EXPORT_FIELDS;
export const EXPORT_LIMITS={page:100,rowsPerCategory:10000,totalRows:40000,bytes:32*1024*1024,milliseconds:120000};
export function filterExport(category:ExportCategory,row:Record<string,unknown>){return Object.fromEntries(EXPORT_FIELDS[category].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));}
export type PageReader=(category:ExportCategory,after:string|null)=>Promise<Record<string,unknown>[]>;
export async function* exportChunks(read:PageReader,at:string,account:{id:string;email?:string;created_at?:string},signal:AbortSignal,limits=EXPORT_LIMITS){
 const encoder=new TextEncoder();let bytes=0,total=0;const started=Date.now();
 const out=(s:string)=>{const b=encoder.encode(s);bytes+=b.length;if(bytes>limits.bytes)throw new Error('Export limit');return b;};
 yield out(JSON.stringify({schema_version:'jarvis-personal-export-v1',exported_at:at,account,consistency:'Keyset pages with a creation cutoff; not a transaction snapshot. Concurrent edits/deletes may be reflected. Privacy-generation changes abort the export.',included:'Owned preferences/consents, unexpired conversation history, memory lifecycle and available provenance, tasks, reminder schedules/delivery states, numerical usage and computer-control devices/action history.',excluded:'Passwords, session/capability tokens, API/notification/worker/device credentials, computer-control tickets, Mac-local app paths/folder references/Shortcut lists/journals, private security diagnostics, queue/outbox internals and operation hashes, raw audio, unsent temporary content, provider copies, developer mailbox/fixture files, logs and backups.'}).slice(0,-1)+',"data":{');
 let firstCategory=true;
 for(const category of Object.keys(EXPORT_FIELDS) as ExportCategory[]){
  yield out(`${firstCategory?'':','}${JSON.stringify(category)}:[`);firstCategory=false;let first=true,cursor:string|null=null,count=0;
  try{
   while(true){signal.throwIfAborted();if(Date.now()-started>limits.milliseconds)throw new Error('Export timeout');const rows=await read(category,cursor);if(rows.length>limits.page)throw new Error('Invalid export page');
    for(const raw of rows){if(typeof raw.id!=='string'||(cursor!==null&&raw.id<=cursor))throw new Error('Invalid export cursor');cursor=raw.id;if(++count>limits.rowsPerCategory||++total>limits.totalRows)throw new Error('Export row limit');const value=JSON.stringify(filterExport(category,raw));yield out((first?'':',')+value);first=false;}
    if(rows.length<limits.page)break;
   }
  }catch{yield encoder.encode(']},"export_complete":false,"error":"Export interrupted, changed or exceeded its personal-use limit. No complete download was produced; retry after reviewing account state."}');return;}
  yield out(']');
 }
 yield out('},"export_complete":true}');
}
