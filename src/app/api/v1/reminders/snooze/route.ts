import { z } from 'zod';
import { accountFor,contentBody,contentFailure,ContentError,databaseResult } from '@/lib/conversation/api';
import { json } from '@/lib/http';
import type {Reminder} from '@/lib/reminders/types';
import type {ReminderSeries} from '@/lib/reminders/recurrence';
import { nextOccurrences,resolveSnooze } from '@/lib/reminders/recurrence';
import { ScheduleError,resolveSchedule } from '@/lib/reminders/time';
import { scheduleStorageError } from '@/lib/reminders/series-service';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('review'),id:z.uuid(),minutes:z.union([z.literal(10),z.literal(60)]).optional(),local_datetime:z.string().max(19).optional(),disambiguation:z.enum(['earlier','later']).optional()}),
 z.strictObject({action:z.literal('confirm'),id:z.uuid(),version:z.number().int().positive(),request_id:z.uuid(),local_datetime:z.string().max(19),due_at:z.iso.datetime(),resolution:z.enum(['unique','earlier','later'])}),
]);
export async function POST(request:Request){try{
 const {client,profile}=await accountFor(request,true);const v=input.safeParse(await contentBody(request));
 if(!v.success)throw new ContentError(422,'Choose 10 minutes, one hour or a future local date/time.');
 const data=v.data;
 const r=databaseResult<Reminder|null>(await client.from('reminders').select('*').eq('id',data.id).eq('owner_id',profile.owner_id).maybeSingle());
 if(!r)throw new ContentError(404,'Occurrence unavailable.');
 let next:string|undefined;
 if(r.series_id){const s=databaseResult<ReminderSeries|null>(await client.from('reminder_series').select('*').eq('id',r.series_id).eq('owner_id',profile.owner_id).maybeSingle());if(!s)throw new ContentError(404,'Series unavailable.');
 // Start after the nominal calendar date; a snooze never moves the series cursor.
 const candidates=nextOccurrences(s.schedule,r.occurrence_date!,2);next=candidates.find(c=>c.date>r.occurrence_date!)?.due_at;
 }
 if(data.action==='review'){
  if((data.minutes?1:0)+(data.local_datetime?1:0)!==1)throw new ContentError(422,'Choose exactly one snooze method.');
  if(!['scheduling_pending','scheduled','retry_scheduled','attempt_started'].includes(r.state)||r.cancel_requested_at)throw new ContentError(409,'This occurrence is no longer pending. Accepted, unknown or in-flight sends cannot be recalled.');
  const sent=databaseResult<{id:string}[]>(await client.from('delivery_attempts').select('id').eq('owner_id',profile.owner_id).eq('reminder_id',r.id).not('send_started_at','is',null).limit(1));
  if(sent.length)throw new ContentError(409,'Sending already started for this occurrence. Snooze cannot retract or replay that send.');
  const resolved=resolveSnooze(r,data,Date.now(),next);return json({id:r.id,version:r.version,...resolved});
 }
 const resolved=resolveSchedule({title:r.title,timezone:r.timezone,local_datetime:data.local_datetime,...(data.resolution==='unique'?{}:{disambiguation:data.resolution})},Date.parse(data.due_at)-10000);
 if(resolved.due_at!==data.due_at||resolved.resolution!==data.resolution)throw new ContentError(409,'Snooze preview changed. Review again.');
 const result=await client.rpc('reminder_snooze_v1',{p_request:data.request_id,p_data:{id:r.id,version:data.version,due_at:resolved.due_at,local_datetime:resolved.local_datetime,resolution:resolved.resolution}});
 if(result.error)throw scheduleStorageError(result.error.code);return json(result.data);
}catch(e){if(e instanceof ScheduleError)return json({error:e.message},422);return contentFailure(e);}}
