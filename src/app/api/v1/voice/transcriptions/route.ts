import {z} from 'zod';
import {accountFor,ContentError,contentFailure,databaseResult} from '@/lib/conversation/api';
import {getConfig} from '@/lib/config';
import {readLiveConfig} from '@/lib/live/config';
import {validMutation,json} from '@/lib/http';
import {VoiceLimiter,readAudio} from '@/lib/voice/limits';
import {validateWav,VoiceError,VOICE_CONSENT} from '@/lib/voice/audio';
import {mockTranscription,openAITranscription,reserveTranscription,transcribeBounded} from '@/lib/voice/transcription';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=60;
const limiter=new VoiceLimiter();
const headers=z.strictObject({request_id:z.uuid(),provider:z.enum(['mock','openai']),language:z.enum(['en','hi','te','ta','es','fr','de']).optional()});
export async function POST(request:Request){
 let audio:Uint8Array|undefined,release:(()=>void)|undefined,reservation:Awaited<ReturnType<typeof reserveTranscription>>|undefined;
 try{
  if(!validMutation(request,getConfig().APP_ORIGIN,'audio/wav'))throw new ContentError(403,'Audio origin or content type not accepted.');
  if(new URL(request.url).search)throw new ContentError(422,'Audio request takes no URL parameters.');
  const input=headers.safeParse({request_id:request.headers.get('x-voice-request'),provider:request.headers.get('x-voice-provider'),...(request.headers.get('x-voice-language')?{language:request.headers.get('x-voice-language')}:{})});
  if(!input.success)throw new ContentError(422,'Choose a provider, request ID and optional supported language hint.');
  const {client,profile}=await accountFor(request);release=limiter.acquire(profile.owner_id);
  const config=input.data.provider==='openai'?readLiveConfig():null;
  if(input.data.provider==='openai'&&(!config?.openai?.transcription_enabled||config.owner_id!==profile.owner_id))throw new VoiceError(403,'Live transcription is not configured for this account. Choose the explicit mock or continue typing; no fallback was used.');
  if(input.data.provider==='openai'){const pref=databaseResult<{cloud_transcription:boolean;consent_version:string|null}|null>(await client.from('voice_preferences').select('cloud_transcription,consent_version').eq('owner_id',profile.owner_id).maybeSingle());if(!pref?.cloud_transcription||pref.consent_version!==VOICE_CONSENT)throw new VoiceError(403,'Enable cloud transcription after reading the audio disclosure. Microphone permission alone is insufficient.');}
  audio=await readAudio(request,AbortSignal.any([request.signal,AbortSignal.timeout(20000)]));const duration=validateWav(audio);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(30000)]);
  if(input.data.provider==='openai'){reservation=await reserveTranscription(client,input.data.request_id,duration.milliseconds);signal.throwIfAborted();await reservation.dispatch();}
  const result=await transcribeBounded(audio,config?openAITranscription(config.openai!.api_key):mockTranscription,input.data.language,signal);
  const usage=reservation?await reservation.settle(result.seconds):null;
  // Reverify identity/admission before returning even a temporary transcript.
  await accountFor(request);signal.throwIfAborted();
  return json({text:result.text,provider:input.data.provider,usage,review_required:true,content_stored:false});
 }catch(e){await reservation?.uncertain();if(request.signal.aborted)return json({error:'Transcription stopped. No message was sent; an already dispatched request may remain charged.'},409);if(e instanceof VoiceError)return json({error:e.message},e.status);return contentFailure(e);}
 finally{audio?.fill(0);release?.();}
}
