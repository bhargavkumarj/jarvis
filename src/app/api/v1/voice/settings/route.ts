import {z} from 'zod';
import {accountFor,contentBody,contentFailure,ContentError,databaseResult} from '@/lib/conversation/api';
import {readLiveConfig} from '@/lib/live/config';
import {VOICE_CONSENT,TRANSCRIPTION_MODEL} from '@/lib/voice/audio';
import {json} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 if(new URL(request.url).search)throw new ContentError(422,'Filters are not accepted.');
 const {client,profile}=await accountFor(request);const config=readLiveConfig();
 const pref=databaseResult<{cloud_transcription:boolean;consent_version:string|null}|null>(await client.from('voice_preferences').select('cloud_transcription,consent_version').eq('owner_id',profile.owner_id).maybeSingle());
 return json({enabled:pref?.cloud_transcription===true&&pref.consent_version===VOICE_CONSENT,configured:config?.owner_id===profile.owner_id&&!!config?.openai?.transcription_enabled,model:TRANSCRIPTION_MODEL,consent_version:VOICE_CONSENT,mock_available:true});
}catch(e){return contentFailure(e);}}
export async function POST(request:Request){try{
 const {client}=await accountFor(request,true);const input=z.strictObject({enabled:z.boolean(),consent:z.literal(VOICE_CONSENT).nullable()}).safeParse(await contentBody(request));
 if(!input.success||input.data.enabled&&input.data.consent!==VOICE_CONSENT)throw new ContentError(422,'Read the audio-processing explanation and explicitly enable cloud transcription.');
 const result=await client.rpc('voice_settings_v1',{p_enabled:input.data.enabled,p_consent:input.data.consent});if(result.error)throw new ContentError(503,'Voice preferences could not be saved. Apply the pending voice migration on the new machine.');
 return json({enabled:input.data.enabled});
}catch(e){return contentFailure(e);}}
