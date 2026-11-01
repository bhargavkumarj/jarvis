import { accountFor,contentFailure,ContentError,databaseResult } from '@/lib/conversation/api';
import { z } from 'zod';import { json } from '@/lib/http';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {id}=await params;
  if(new URL(request.url).search||!z.uuid().safeParse(id).success)throw new ContentError(422,'Use a valid operation identifier without filters.');
  const {client,profile}=await accountFor(request);
  const operation=databaseResult(await client.from('reminder_operations').select('*').eq('id',id).eq('owner_id',profile.owner_id).maybeSingle());
  if(!operation)throw new ContentError(404,'Operation unavailable.');return json({operation});
 }catch(error){return contentFailure(error);}
}
