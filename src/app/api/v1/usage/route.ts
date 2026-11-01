import {accountFor,ContentError,contentFailure,databaseResult} from '@/lib/conversation/api';import {json} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 if(new URL(request.url).search)throw new ContentError(400,'Usage filters/owner IDs are not accepted.');
 const {client}=await accountFor(request);const budget=databaseResult(await client.rpc('m2c_ai_budget_v1',{}));return json({budget,disclosure:'Conservative INR estimates/reservations, not a verified invoice. ₹500 contingency is not AI allowance.'});
}catch(error){return contentFailure(error);}}
