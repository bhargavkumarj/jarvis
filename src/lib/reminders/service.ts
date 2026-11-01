import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { ContentError } from '../conversation/api';
import { resolveSchedule, type ScheduleInput } from './time';
import type { OperationReceipt } from './types';
export async function reminderOperation(client:SupabaseClient<Database>,action:'review'|'confirm'|'cancel',request:string,data:Record<string,unknown>,conversation?:string):Promise<OperationReceipt> {
 const values=data as Database['public']['Functions']['m2b_reminder_v1']['Args']['p_data'];const result=conversation?await client.rpc('privacy_action_v1',{p_kind:'reminder',p_action:action,p_request:request,p_conversation:conversation,p_data:values}):await client.rpc('m2b_reminder_v1',{p_action:action,p_request:request,p_data:values});
 if(result.error){
  const code=result.error.code;
  if(code==='42501')throw new ContentError(404,'This reminder or operation is not available.');
  if(code==='40001'||code==='23505')throw new ContentError(409,'The reviewed values changed, the operation key was reused, or the reminder is no longer editable. Reload and review again.');
  if(code==='54000')throw new ContentError(429,'The reminder or operation limit was reached. Cancel unneeded drafts or wait a minute.');
  if(['22023','23514','22P02','22007','22008'].includes(code))throw new ContentError(422,'Check the date, timezone, future time, DST choice and exact reviewed values.');
  console.error(JSON.stringify({operation:'reminder_command',sqlstate:/^[0-9A-Z]{5}$/.test(code)?code:null}));
  throw new ContentError(503,'Local reminder storage is unavailable. Check local services and the M2B migrations.');
 }
 return result.data as unknown as OperationReceipt;
}
export async function reviewReminder(client:SupabaseClient<Database>,request:string,schedule:ScheduleInput,draft_id?:string,version?:number,channel:'mock'|'pushover'='mock',conversation?:string) {
 const {channel:_channel,...resolved}=resolveSchedule(schedule);void _channel;
 return reminderOperation(client,'review',request,{...resolved,...(channel==='pushover'?{channel}:{}),...(draft_id?{id:draft_id,version}:{})},conversation);
}
