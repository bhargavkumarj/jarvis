import {z} from 'zod';import {accountFor,contentBody,contentFailure,databaseResult,ContentError} from '@/lib/conversation/api';import {json} from '@/lib/http';
export async function POST(request:Request){try{
 const {client}=await accountFor(request,true);const v=z.strictObject({attempt_id:z.uuid(),observed:z.boolean(),at:z.iso.datetime()}).safeParse(await contentBody(request));
 if(!v.success)throw new ContentError(422,'Use the owned attempt, yes/no observation and approximate arrival time.');
 databaseResult(await client.rpc('m2c_observe_phone_v1',{p_attempt:v.data.attempt_id,p_observed:v.data.observed,p_at:v.data.at}));
 return json({recorded:true,evidence:'user_observation_not_provider_delivery_receipt'});
}catch(error){return contentFailure(error);}}
