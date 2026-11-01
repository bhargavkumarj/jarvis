import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Profile} from '../database.types';
import type {Json} from '../database.generated';
import type {Turn,MemorySnippet} from '../conversation/types';
import {ContentError,databaseResult} from '../conversation/api';
import {readLiveConfig} from '../live/config';
import {liveResponse} from './provider';
import {EMPTY_PLAN,composeLiveResult,type ActionPlan} from './contracts';
import {reviewSeries} from '../reminders/series-service';
import {DST_POLICY} from '../reminders/recurrence';
import {reviewReminder} from '../reminders/service';
import {loadTaskContext,taskChat,type TaskContext} from '../tasks/chat';
import {taskRelated} from '../tasks/chat-plan';
import {ScheduleError} from '../reminders/time';
export async function prepareLive(client:SupabaseClient<Database>,profile:Profile){
 const config=readLiveConfig();
 if(!config?.openai?.enabled||!config.openai.model||config.owner_id!==profile.owner_id)throw new ContentError(403,'Live OpenAI is not configured and enabled for this account. No fallback provider was used.');
 const caps=databaseResult<{ai_enabled:boolean;pushover_enabled:boolean}>(await client.rpc('m2c_capabilities_v1',{}));
 if(!caps.ai_enabled)throw new ContentError(403,'Live AI is disabled for this account. Manual reminders remain available.');
 databaseResult(await client.rpc('m2c_cleanup_self_v1',{}));
 return {config,settings:config.openai,caps};
}
export async function safeRecentHistory(client:SupabaseClient<Database>,owner:string,conversation:string){
 const rows=databaseResult<{id:string;user_text:string;assistant_text:string;used_memories:Json}[]>(await client.from('messages').select('id,user_text,assistant_text,used_memories').eq('owner_id',owner).eq('conversation_id',conversation).eq('state','complete').eq('memory_suppressed',false).order('created_at',{ascending:false}).limit(6));
 if(!rows.length)return [];
 // Never refeed any memory-proposal source, including rejected/deleted ones.
 // Approved information enters only through freshly retrieved active revisions.
 const sources=databaseResult<{source_message_id:string}[]>(await client.from('memory_proposals').select('source_message_id').eq('owner_id',owner).in('source_message_id',rows.map(r=>r.id)));
 const excluded=new Set(sources.map(p=>p.source_message_id));
 return rows.filter(r=>!excluded.has(r.id)).reverse().map(r=>({user_text:r.user_text.slice(0,1000),assistant_text:''}));
}
export async function runLive(input:{client:SupabaseClient<Database>;profile:Profile;turn?:Turn;request_id:string;text:string;history:{user_text:string;assistant_text:string}[];memories:MemorySnippet[];signal:AbortSignal;prepared:Awaited<ReturnType<typeof prepareLive>>;emit:(event:{type:'delta';text:string})=>void}){
 if(input.turn)databaseResult(await input.client.rpc('m2c_mark_turn_v1',{p_id:input.turn.id,p_attempt:input.turn.attempt,p_model:input.prepared.settings.model!}));
 const taskContext:TaskContext=input.turn&&taskRelated(input.text)?await loadTaskContext(input.client,input.profile.owner_id,input.text,input.turn.conversation_id):{candidates:[],more:false,focus:null};
 let text='',plan:ActionPlan=EMPTY_PLAN,success=false;
 for await(const event of liveResponse({client:input.client,request_id:input.request_id,attempt_id:input.turn?.attempt??crypto.randomUUID(),key:input.prepared.settings.api_key,model:input.prepared.settings.model!,signal:input.signal,
  context:{text:input.text,assistantName:input.profile.assistant_name,allowMemory:!!input.turn,memories:input.turn?input.memories:[],history:input.history,tone:input.profile.tone,timezone:input.profile.timezone,now:new Date().toISOString(),tasks:taskContext.candidates,conversation_id:input.turn?.conversation_id,privacy_epoch:input.turn?.privacy_epoch}})){
  if(event.type==='delta'){text+=event.text;input.emit(event);}else if(event.type==='actions')plan=event.plan;else if(event.type==='success')success=true;
 }
 input.signal.throwIfAborted();
 if(!success)throw new Error('No complete live response');
 if(input.turn)databaseResult(await input.client.rpc('privacy_context_v1',{p_conversation:input.turn.conversation_id,p_epoch:input.turn.privacy_epoch??null}));
 let receipt='';
 if(plan.reminder&&input.turn){
  if(!input.prepared.caps.pushover_enabled||!input.prepared.config.pushover)receipt='No reminder draft was saved: the personal Pushover channel is unavailable. Use Today to select an available channel explicitly.';
  else try{
   const p=plan.reminder;
   const result=await reviewReminder(input.client,input.request_id,{title:p.title,local_datetime:p.local_datetime,timezone:p.timezone,...(p.disambiguation?{disambiguation:p.disambiguation}:{})},undefined,undefined,'pushover',input.turn.conversation_id);
   const r=result.reminder;receipt=`App operation receipt: draft ${r.id}; operation ${result.operation.id}. Review ${r.local_datetime} in ${r.timezone}; UTC ${r.due_at}; Pushover generic channel. State at receipt: ${r.state}. Open Today to review and confirm this exact version; no notification was sent by the AI.`;
  }catch(error){if(!(error instanceof ScheduleError))throw error;receipt=`Reminder needs clarification: ${error.message} No new schedule was confirmed. Use Today for exact review.`;}
 }
 if(plan.recurrence&&input.turn){
  if(!input.prepared.caps.pushover_enabled||!input.prepared.config.pushover)receipt='No series draft was saved: the personal live channel is unavailable. Use Today to explicitly choose an available channel.';
  else try{
   const result=await reviewSeries(input.client,input.request_id,{...plan.recurrence,channel:'pushover',dst_policy:DST_POLICY,late_minutes:5},undefined,undefined,input.turn.conversation_id);
   receipt=`App operation receipt: series draft ${result.series.id}; operation ${result.operation.id}. Open Today → Review proposed series for the exact three-occurrence preview and separate confirmation. No schedule was confirmed and no notification was sent by the AI.`;
  }catch(error){if(!(error instanceof ScheduleError))throw error;receipt=`Recurring reminder needs clarification: ${error.message} No series was confirmed.`;}
 }
 if(plan.task&&input.turn)receipt=await taskChat({client:input.client,owner:input.profile.owner_id,request:input.request_id,text:input.text,plan:plan.task,context:taskContext,conversation:input.turn.conversation_id,timezone:input.profile.timezone,channel:input.prepared.caps.pushover_enabled&&input.prepared.config.pushover?'pushover':null});
 if(plan.memory&&input.turn)receipt+=(receipt?'\n':'')+'A memory proposal is available for exact review in Memory. It is not approved.';
 const result=composeLiveResult(text,plan.clarification,receipt);text=result.text;
 let proposal_id:string|null=null;
 input.signal.throwIfAborted();
 if(input.turn){
  const committed=databaseResult<{proposal_id:string|null}>(await input.client.rpc('m2c_finish_turn_v1',{p_id:input.turn.id,p_attempt:input.turn.attempt,p_text:text,p_used:input.memories.map(m=>({id:m.id,version:m.version})),p_proposal:plan.memory as Json|null,p_model:input.prepared.settings.model!}));
  proposal_id=committed.proposal_id;
 }else{
  const stillActive=databaseResult(await input.client.from('profiles').select('owner_id').eq('owner_id',input.profile.owner_id).maybeSingle());if(!stillActive)throw new Error('Session expired');
 }
 if(result.completionDelta)input.emit({type:'delta',text:result.completionDelta});
 return {text,receipt,proposal_id};
}
