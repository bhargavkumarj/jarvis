import {z} from 'zod';
import {accountFor,contentBody,contentFailure,ContentError} from '@/lib/conversation/api';
import {json} from '@/lib/http';
import {privacyResult} from '@/lib/privacy/server';
export async function POST(request:Request){try{
 const {client,profile}=await accountFor(request,true);const parsed=z.strictObject({password:z.string().min(1).max(128)}).safeParse(await contentBody(request,1024));if(!parsed.success)throw new ContentError(422,'Enter your current password.');
 privacyResult(await client.rpc('privacy_reauth_check_v1',{}));const user=await client.auth.getUser();if(user.error||!user.data.user.email||user.data.user.id!==profile.owner_id)throw new ContentError(401,'Session could not be verified.');
 const result=await client.auth.signInWithPassword({email:user.data.user.email,password:parsed.data.password});if(result.error||result.data.user?.id!==profile.owner_id)throw new ContentError(401,'Password verification failed. No privacy operation was authorized.');
 return json({recent_authentication:true,valid_for_seconds:300});
}catch(e){return contentFailure(e);}}
