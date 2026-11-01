import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import type { Json } from '../database.generated';
import { ContentError } from '../conversation/api';
import { reviewRecurrence, type ReminderSeries } from './recurrence';
export type SeriesReceipt={series:ReminderSeries;operation:{id:string;result:Json};replay:boolean};
export async function seriesOperation(client:SupabaseClient<Database>,action:string,request:string,data:Record<string,unknown>,conversation?:string):Promise<SeriesReceipt> {
 const result=conversation?await client.rpc('privacy_action_v1',{p_kind:'series',p_action:action,p_request:request,p_conversation:conversation,p_data:data as Json}):await client.rpc('reminder_series_v1',{p_action:action,p_request:request,p_data:data as Json});
 if(result.error)throw scheduleStorageError(result.error.code);
 return result.data as unknown as SeriesReceipt;
}
export async function reviewSeries(client:SupabaseClient<Database>,request:string,schedule:unknown,id?:string,version?:number,conversation?:string){
 const review=reviewRecurrence(schedule);
 return seriesOperation(client,'review',request,{...review,...(id?{id,version}:{})},conversation);
}
export function scheduleStorageError(code:string){
 if(code==='42501')return new ContentError(404,'This schedule, occurrence or delivery channel is unavailable.');
 if(['40001','23505'].includes(code))return new ContentError(409,'The schedule changed or sending already started. Refresh, inspect the current state and review again. An in-flight notification cannot be recalled.');
 if(code==='54000')return new ContentError(429,'Schedule operation limit reached. Wait before trying again.');
 if(['22023','23514','22P02','22007','22008'].includes(code))return new ContentError(422,'Check the exact schedule, DST interpretation and future snooze time. Snooze must end before the next occurrence.');
 console.error(JSON.stringify({operation:'recurrence_storage',sqlstate:/^[0-9A-Z]{5}$/.test(code)?code:null}));
 return new ContentError(503,'Schedule storage is unavailable. On the new machine apply the pending migrations, then retry.');
}
