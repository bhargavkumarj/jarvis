import {cookies} from 'next/headers';
import {z} from 'zod';
import {supabase} from '@/lib/supabase';
import {json,validMutation} from '@/lib/http';
import {getConfig} from '@/lib/config';
import {contentFailure,ContentError} from '@/lib/conversation/api';
import {privacyResult} from '@/lib/privacy/server';
export const dynamic='force-dynamic';
const receipt=z.strictObject({request:z.uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)});
async function status(request:Request,retry=false){try{
 if(new URL(request.url).search)throw new ContentError(422,'Receipt is not accepted in a URL.');if(retry&&!validMutation(request,getConfig().APP_ORIGIN))throw new ContentError(403,'Origin not accepted.');
 const client=await supabase();let value:unknown=null;const raw=(await cookies()).get('jarvis_privacy_receipt')?.value;
 if(raw){let parsed;try{parsed=receipt.safeParse(JSON.parse(raw));}catch{throw new ContentError(403,'Receipt unavailable.');}if(!parsed.success)throw new ContentError(403,'Receipt unavailable.');value=privacyResult(await client.rpc('privacy_receipt_v1',{p_request:parsed.data.request,p_token:parsed.data.token,p_retry:retry}));}
 else if(!retry)value=privacyResult(await client.rpc('privacy_own_deletion_v1',{}));
 if(!value)throw new ContentError(404,'No deletion receipt is available in this browser. The local operator can inspect pending deletion status without recovering your content.');return json({job:value});
}catch(e){return contentFailure(e);}}
export const GET=(request:Request)=>status(request);
export const POST=(request:Request)=>status(request,true);
