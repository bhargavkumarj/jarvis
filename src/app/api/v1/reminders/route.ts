import { accountFor,contentBody,contentFailure,ContentError,databaseResult } from '@/lib/conversation/api';
import { reviewSchema,confirmSchema,cancelReminderSchema } from '@/lib/reminders/validation';
import { reminderOperation,reviewReminder } from '@/lib/reminders/service';
import { ScheduleError } from '@/lib/reminders/time';
import { json } from '@/lib/http';
import { z } from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const url=new URL(request.url);const id=url.searchParams.get('id');
  if([...url.searchParams.keys()].some(k=>k!=='id')||url.searchParams.getAll('id').length>1||(id&&!z.uuid().safeParse(id).success))throw new ContentError(422,'Use only a valid reminder identifier.');
  const {client,profile}=await accountFor(request);
  if(id){
   const reminder=databaseResult(await client.from('reminders').select('*').eq('owner_id',profile.owner_id).eq('id',id).maybeSingle());
   if(!reminder)throw new ContentError(404,'Reminder unavailable.');
   const attempts=databaseResult(await client.from('delivery_attempts').select('*').eq('owner_id',profile.owner_id).eq('reminder_id',id).order('ordinal'));
   return json({reminder,attempts});
  }
  const reminders=databaseResult(await client.from('reminders').select('*').eq('owner_id',profile.owner_id).order('created_at',{ascending:false}).limit(100));
  return json({reminders});
 }catch(error){return contentFailure(error);}
}
export async function POST(request:Request){
 try{
  const {client}=await accountFor(request,true);
  const body=await contentBody(request);
  const input=z.discriminatedUnion('action',[
   reviewSchema.extend({action:z.literal('review')}),confirmSchema.extend({action:z.literal('confirm')}),cancelReminderSchema.extend({action:z.literal('cancel')})
  ]).safeParse(body);
  if(!input.success)throw new ContentError(422,'Check the reminder fields. Owner IDs, delivery controls and temporary-chat content are not accepted.');
  const v=input.data;
  const receipt=v.action==='review'?await reviewReminder(client,v.request_id,v.schedule,v.draft_id,v.version,v.channel):
   await reminderOperation(client,v.action,v.request_id,{id:v.id,version:v.version,...(v.action==='confirm'?{snapshot:v.snapshot}:{})});
  return json(receipt);
 }catch(error){if(error instanceof ScheduleError)return json({error:error.message,kind:error.kind,candidates:error.candidates},422);return contentFailure(error);}
}
