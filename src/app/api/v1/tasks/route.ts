import {z} from 'zod';
import {accountFor,contentBody,contentFailure,ContentError,databaseResult} from '@/lib/conversation/api';
import {json} from '@/lib/http';
import {taskInputSchema} from '@/lib/tasks/model';
import {taskCommand,saveTask,reviewTaskReminder} from '@/lib/tasks/service';
import {scheduleSchema,snapshotSchema} from '@/lib/reminders/validation';
import {ScheduleError} from '@/lib/reminders/time';
export const dynamic='force-dynamic';
const base={request_id:z.uuid(),id:z.uuid(),version:z.number().int().positive()};
const input=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('save'),request_id:z.uuid(),id:z.uuid().optional(),version:z.number().int().positive().optional(),values:taskInputSchema}),
 z.strictObject({action:z.enum(['complete','reopen','cancel','reject_review','remove_reminder']),...base}),
 z.strictObject({action:z.literal('delete'),...base,confirm_delete:z.literal(true)}),
 z.strictObject({action:z.literal('confirm'),...base,review_version:z.number().int().positive(),review:z.unknown(),confirm_delete:z.literal(true).optional()}),
 z.strictObject({action:z.literal('review_reminder'),...base,schedule:scheduleSchema,channel:z.enum(['mock','pushover'])}),
 z.strictObject({action:z.literal('confirm_reminder'),...base,reminder_snapshot:snapshotSchema,reminder_review:z.strictObject({reminder_id:z.uuid(),replaces_id:z.uuid().nullable(),replaces_version:z.number().int().positive().nullable()})}),
]);
export async function GET(request:Request){try{
 const url=new URL(request.url),id=url.searchParams.get('id');if([...url.searchParams.keys()].some(k=>k!=='id')||url.searchParams.getAll('id').length>1||(id&&!z.uuid().safeParse(id).success))throw new ContentError(422,'Use only an optional task identifier.');
 const {client,profile}=await accountFor(request);
 if(id){const task=databaseResult(await client.from('tasks').select('*').eq('owner_id',profile.owner_id).eq('id',id).maybeSingle());if(!task)throw new ContentError(404,'Task unavailable.');
  const reminders=databaseResult<{id:string}[]>(await client.from('reminders').select('*').eq('owner_id',profile.owner_id).eq('task_id',id).order('created_at',{ascending:false}).limit(20));
  const attempts=reminders.length?databaseResult(await client.from('delivery_attempts').select('*').eq('owner_id',profile.owner_id).in('reminder_id',reminders.map(r=>r.id)).order('started_at',{ascending:false}).limit(60)):[];
  return json({task,reminders,attempts,server_now:new Date().toISOString()});
 }
 const tasks=databaseResult(await client.from('tasks').select('*').eq('owner_id',profile.owner_id).order('updated_at',{ascending:false}).limit(1000));return json({tasks,server_now:new Date().toISOString(),limit:1000});
}catch(e){return contentFailure(e);}}
export async function POST(request:Request){try{
 const {client}=await accountFor(request,true),v=input.safeParse(await contentBody(request,16384));if(!v.success)throw new ContentError(422,'Check task fields and versions. Owner IDs, delivery controls and temporary-chat action fields are not accepted.');const d=v.data;
 if(d.action==='save'){if(!!d.id!==(d.version!==undefined))throw new ContentError(422,'Editing requires both task ID and version.');return json(await saveTask(client,d.request_id,d.values,d.id,d.version));}
 if(d.action==='review_reminder')return json(await reviewTaskReminder(client,d.request_id,d.id,d.version,d.schedule,d.channel));
 const {action,request_id,...data}=d;return json(await taskCommand(client,action,request_id,data));
}catch(e){if(e instanceof ScheduleError)return json({error:e.message,kind:e.kind},422);return contentFailure(e);}}
