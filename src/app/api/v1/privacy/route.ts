import {randomBytes,createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import {accountFor,contentBody,contentFailure,ContentError} from '@/lib/conversation/api';
import {json} from '@/lib/http';
import {getConfig} from '@/lib/config';
import {sessionCookieOptions} from '@/lib/session-cookies';
import {privacyCommand,validConfirmation,type PrivacyStatus} from '@/lib/privacy/model';
import {privacyResult} from '@/lib/privacy/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(new URL(request.url).search)throw new ContentError(422,'Privacy filters and owner identifiers are not accepted.');const {client,profile}=await accountFor(request);const value=privacyResult<PrivacyStatus>(await client.rpc('privacy_get_v1',{}));const voice=privacyResult(await client.from('voice_preferences').select('cloud_transcription,consent_version').eq('owner_id',profile.owner_id).maybeSingle());return json({...value,voice});}catch(e){return contentFailure(e);}}
export async function POST(request:Request){try{
 const {client}=await accountFor(request,true);const parsed=privacyCommand.safeParse(await contentBody(request,4096));if(!parsed.success)throw new ContentError(422,'Check privacy fields; owner and worker controls are not accepted.');
 const {action,request_id,...data}=parsed.data;let receipt:string|undefined;
 if(parsed.data.action==='delete'){if(!validConfirmation(parsed.data.scope,parsed.data.confirmation))throw new ContentError(422,'Type the exact displayed confirmation.');if(parsed.data.scope==='account')receipt=randomBytes(32).toString('hex');}
 const payload={...data,...(receipt?{receipt_hash:createHash('sha256').update(receipt).digest('hex')}:{})};
 const result=privacyResult(await client.rpc('privacy_command_v1',{p_action:action,p_request:request_id,p_data:payload}));
 const response=json({result,...(receipt?{redirect:'/privacy/deletion'}:{})});
 if(receipt){const jar=await cookies();jar.set('jarvis_privacy_receipt',JSON.stringify({request:request_id,token:receipt}),{...sessionCookieOptions(getConfig().APP_ORIGIN),maxAge:30*86400});}
 return response;
}catch(e){return contentFailure(e);}}
