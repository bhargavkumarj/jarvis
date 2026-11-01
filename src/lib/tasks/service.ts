import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../database.types';
import type {Json} from '../database.generated';
import {ContentError} from '../conversation/api';
import {resolveTask,type TaskReceipt} from './model';
import {resolveSchedule,type ScheduleInput} from '../reminders/time';
export async function taskCommand(client:SupabaseClient<Database>,action:string,request:string,data:Record<string,unknown>):Promise<TaskReceipt>{
 const r=typeof data.conversation_id==='string'?await client.rpc('privacy_action_v1',{p_kind:'task',p_action:action,p_request:request,p_conversation:data.conversation_id,p_data:data as Json}):await client.rpc('task_command_v1',{p_action:action,p_request:request,p_data:data as Json});
 if(r.error){const code=r.error.code;if(code==='42501')throw new ContentError(404,'This task, conversation or reminder is not available.');if(['40001','23505'].includes(code))throw new ContentError(409,'The task or reviewed reminder changed, or this request key was already used differently. Refresh and review again.');if(code==='54000')throw new ContentError(429,'Task or operation limit reached. Wait or remove unneeded tasks.');if(['22023','23514','22P02','22007','22008'].includes(code))throw new ContentError(422,'Check the task deadline, exact review and explicit deletion confirmation.');console.error(JSON.stringify({operation:'task_command',sqlstate:/^[0-9A-Z]{5}$/.test(code)?code:null}));throw new ContentError(503,'Task storage is unavailable. Your changes were not confirmed; refresh saved state before retrying.');}
 return r.data as unknown as TaskReceipt;
}
export function saveTask(client:SupabaseClient<Database>,request:string,input:unknown,id?:string,version?:number){return taskCommand(client,'save',request,{values:resolveTask(input),...(id?{id,version}:{})});}
export function reviewTaskReminder(client:SupabaseClient<Database>,request:string,id:string,version:number,schedule:ScheduleInput,channel:'mock'|'pushover',conversation?:string){
 const resolved=resolveSchedule({...schedule,title:'Task reminder'});return taskCommand(client,'review_reminder',request,{id,version,schedule:{...resolved,channel},...(conversation?{conversation_id:conversation}:{})});
}
