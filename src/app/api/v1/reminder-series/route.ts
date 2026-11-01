import { z } from 'zod';
import { accountFor,contentBody,contentFailure,ContentError,databaseResult } from '@/lib/conversation/api';
import { json } from '@/lib/http';
import { recurrenceSchema } from '@/lib/reminders/recurrence';
import { reviewSeries,seriesOperation } from '@/lib/reminders/series-service';
import { ScheduleError } from '@/lib/reminders/time';
export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('review'),request_id:z.uuid(),schedule:recurrenceSchema,id:z.uuid().optional(),version:z.number().int().positive().optional()}),
 z.strictObject({action:z.literal('confirm'),request_id:z.uuid(),id:z.uuid(),version:z.number().int().positive(),review_version:z.number().int().positive(),review:z.unknown()}),
 z.strictObject({action:z.enum(['pause','resume','cancel','skip']),request_id:z.uuid(),id:z.uuid(),version:z.number().int().positive(),occurrence_id:z.uuid().optional()}),
]);
export async function GET(request:Request){try{
 if(new URL(request.url).search)throw new ContentError(422,'Series listing takes no identifiers or owner fields.');
 const {client,profile}=await accountFor(request);
 const series=databaseResult(await client.from('reminder_series').select('*').eq('owner_id',profile.owner_id).order('created_at',{ascending:false}).limit(50));
 return json({series});
}catch(e){return contentFailure(e);}}
export async function POST(request:Request){try{
 const {client}=await accountFor(request,true);const parsed=command.safeParse(await contentBody(request,12288));
 if(!parsed.success)throw new ContentError(422,'Use a supported series action and exact reviewed values. Owner and worker fields are not accepted.');
 const v=parsed.data;
 if(v.action==='review')return json(await reviewSeries(client,v.request_id,v.schedule,v.id,v.version));
 const {action,request_id,...data}=v;return json(await seriesOperation(client,action,request_id,data));
}catch(e){if(e instanceof ScheduleError)return json({error:e.message},422);return contentFailure(e);}}
