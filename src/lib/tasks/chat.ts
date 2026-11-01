import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../database.types';
import {databaseResult} from '../conversation/api';
import {resolveReference,resolveTask,taskInput,describeDue,type Task,type TaskCandidate,type TaskInput,type TaskOperation} from './model';
import {ambiguousTaskDate,deadlinePhrase,type ParsedTask,type TaskPlan} from './chat-plan';
import {taskCommand,reviewTaskReminder} from './service';
export type TaskContext={candidates:TaskCandidate[];more:boolean;focus:string|null};
export async function loadTaskContext(client:SupabaseClient<Database>,owner:string,query:string,conversation?:string):Promise<TaskContext>{
 const c=conversation?databaseResult<{task_focus_id:string|null}|null>(await client.from('conversations').select('task_focus_id').eq('id',conversation).eq('owner_id',owner).maybeSingle()):null;
 const r=databaseResult<{candidates:TaskCandidate[];more:boolean}>(await client.rpc('task_context_v1',{p_query:query,p_focus:c?.task_focus_id??null}));return {...r,focus:c?.task_focus_id??null,candidates:r.candidates.slice(0,8)};
}
export async function taskChat(input:{client:SupabaseClient<Database>;owner:string;request:string;text:string;plan:TaskPlan;context:TaskContext;conversation:string;timezone:string;channel:'mock'|'pushover'|null;parsed?:ParsedTask;now?:number}):Promise<string>{
 const {client,plan,context}=input;
 if(plan.operation==='list_overdue'){
  const r=databaseResult<{candidates:TaskCandidate[];more:boolean}>(await client.rpc('task_context_v1',{p_overdue:true}));
  return r.candidates.length?`Current owned overdue tasks${r.more?' (bounded list; open Today for all)':''}:\n`+r.candidates.slice(0,8).map(t=>`• ${t.title} — ${describeDue({...t,notes:''})}`).join('\n'):'No open overdue tasks were returned by task storage.';
 }
 // The turn boundary already binds this request UUID to the exact user text.
 // Recover a committed domain review before rebuilding CAS arguments after an interrupted stream.
 const previous=databaseResult<Pick<TaskOperation,'id'|'kind'|'task_ref'|'result'>|null>(await client.from('task_operations').select('id,kind,task_ref,result').eq('owner_id',input.owner).eq('request_id',input.request).maybeSingle());
 if(previous)return `App task operation receipt: ${previous.id}. Earlier ${previous.kind} operation for task ${previous.task_ref} was committed. Inspect its current state in Today; this retry created no new task, review or notification schedule.`;
 if(ambiguousTaskDate(input.text))return 'Which calendar date? Please give YYYY-MM-DD and specify date-only or an exact time. No task or reminder was changed.';
 let t:Task|null=null;
 if(plan.operation!=='create'){
  let target:TaskCandidate;try{target=resolveReference(context.candidates,plan.reference??'it',context.focus,context.more);}catch(e){return e instanceof Error?e.message:'Choose a task in Today.';}
  t=databaseResult<Task|null>(await client.from('tasks').select('*').eq('owner_id',input.owner).eq('id',target.id).maybeSingle());if(!t||t.version!==target.version)return 'The task changed or is no longer available. Reload Today and choose the exact task again.';
 }
 if(plan.operation==='remind'){
  if(!input.channel)return 'No live reminder draft was saved: the personal notification channel is unavailable. Open Today to explicitly choose a mock or live task reminder.';
  const phrase=input.parsed&&'reminderPhrase' in input.parsed?input.parsed.reminderPhrase:undefined;let due:TaskInput['due']|undefined;
  try{if(phrase)due=deadlinePhrase(phrase,t?.due_timezone??input.timezone,input.now);}catch(e){return e instanceof Error?e.message:'Clarify the reminder date/time.';}
  const p=due?.kind==='instant'?{local_datetime:due.local_datetime,timezone:due.timezone,disambiguation:due.disambiguation}:plan.reminder;
  if(!p)return 'Give a full reminder date and time, with AM/PM or an exact local time and IANA timezone. No notification was scheduled.';
  const r=await reviewTaskReminder(client,input.request,t!.id,t!.version,{title:'Task reminder',local_datetime:p.local_datetime,timezone:p.timezone,...(p.disambiguation?{disambiguation:p.disambiguation}:{})},input.channel,input.conversation);
  return `App task operation receipt: ${r.operation.id}. Linked reminder review saved for task ${t!.id}; ${input.channel==='mock'?'explicit mock channel — no phone delivery':'Pushover generic channel'}. Open Today → task details to review the exact schedule and confirm. No notification was scheduled by this chat request.`;
 }
 let values:ReturnType<typeof resolveTask>|null=null;
 if(plan.operation==='create'||plan.operation==='edit'){
  const current=t?taskInput(t):{title:plan.title??'',notes:'',due:{kind:'none'} as TaskInput['due']};
  if(plan.title)current.title=plan.title;if(plan.notes!==null)current.notes=plan.notes;
  const phrase=input.parsed&&'duePhrase' in input.parsed?input.parsed.duePhrase:undefined;
  try{
   if(phrase)current.due=deadlinePhrase(phrase,t?.due_timezone??input.timezone,input.now);
   else if(plan.deadline){const d=plan.deadline,zone=d.timezone??t?.due_timezone??input.timezone;current.due=d.kind==='none'?{kind:'none'}:d.kind==='date'?{kind:'date',date:d.date??'',timezone:zone}:{kind:'instant',local_datetime:d.local_datetime??'',timezone:zone,...(d.disambiguation?{disambiguation:d.disambiguation}:{})};}
   values=resolveTask(current,input.now);
  }catch(e){return e instanceof Error?e.message:'Clarify the task deadline in Today.';}
 }
 const r=await taskCommand(client,'review',input.request,{review_action:plan.operation,values,...(t?{id:t.id,version:t.version}:{}),conversation_id:input.conversation});
 return r.task?`App task operation receipt: ${r.operation.id}. Pending ${plan.operation} review for task ${r.task.id}. Open Today → Review task proposal. This is not a confirmed task change; reminders require a separate exact schedule confirmation.`:'This earlier task operation exists, but its task has since been deleted. No new task was created.';
}
