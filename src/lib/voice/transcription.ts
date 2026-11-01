import 'server-only';
import {randomBytes,createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../database.types';
import {createOpenAIClient} from '../ai/provider';
import {TRANSCRIPTION_MODEL,VoiceError} from './audio';
export type TranscriptionTransport={transcribe:(audio:Uint8Array,language:string|undefined,signal:AbortSignal)=>Promise<{text:string;seconds:number|null}>};
export const mockTranscription:TranscriptionTransport={async transcribe(_audio,_language,signal){signal.throwIfAborted();return {text:'Mock voice transcript. Review and edit this demonstration before sending.',seconds:null};}};
export function openAITranscription(key:string,request?:typeof fetch):TranscriptionTransport{
 const sdk=createOpenAIClient(key,request);
 return {async transcribe(audio,language,signal){
  // Fixed endpoint/model; no prompt, history, memories, provider store or fallback.
  const file=new File([Uint8Array.from(audio)],'recording.wav',{type:'audio/wav'});
  try{const response=await sdk.audio.transcriptions.create({model:TRANSCRIPTION_MODEL,file,...(language?{languages:[language]}:{})},{signal});
   return {text:response.text,seconds:response.usage?.type==='duration'?response.usage.seconds:null};
  }catch(error){const status=(error as {status?:number}).status;
   throw new VoiceError(status===429?429:status===401||status===403?503:502,status===429?'OpenAI rate limit reached. No automatic retry occurred. The request may remain charged; inspect usage before recording again.':'Transcription did not complete. No automatic fallback or retry occurred; dispatched audio may remain charged.');
  }
 }};
}
function storageError(code?:string){return new VoiceError(code==='54000'?429:code==='40001'||code==='23505'?409:code==='42501'?403:503,code==='54000'?'AI budget, concurrency or transcription rate limit reached. Typing and manual reminders remain available.':code==='40001'||code==='23505'?'This recording request was already used. Its transcript is not stored, and no second paid call was made. Record again only if you want a new request.':code==='42501'?'Cloud transcription is disabled or unavailable for this account.':'Voice accounting is unavailable. Apply the pending migration and review audio pricing on the new machine.');}
export async function reserveTranscription(client:SupabaseClient<Database>,request:string,milliseconds:number){
 const token=randomBytes(32).toString('hex');
 const result=await client.rpc('voice_reserve_v1',{p_request:request,p_milliseconds:milliseconds,p_hash:createHash('sha256').update(token).digest('hex')});
 if(result.error)throw storageError(result.error.code);const reservation=result.data as {id:string;reserved_paise:number};let dispatched=false,closed=false;
 const account=async(action:string,seconds?:number)=>{const r=await client.rpc('voice_account_v1',{p_action:action,p_id:reservation.id,p_token:token,...(seconds!==undefined?{p_seconds:seconds}:{})});if(r.error)throw storageError(r.error.code);return r.data as {dispatched?:boolean;charged_paise:number};};
 return {async dispatch(){if(!(await account('dispatch')).dispatched)throw new VoiceError(409,'The budget month changed. Nothing was sent; record again for a new request.');dispatched=true;},async settle(seconds:number|null){if(seconds===null||!Number.isFinite(seconds)||seconds<=0||seconds>60){await account('unknown');closed=true;return {charged_paise:reservation.reserved_paise,estimated:true};}const r=await account('settle',seconds);closed=true;return {...r,estimated:false};},async uncertain(){if(!closed)try{await account(dispatched?'unknown':'release');closed=true;}catch{/* Never refund without confirmed accounting. */}}};
}
export async function transcribeBounded(audio:Uint8Array,transport:TranscriptionTransport,language:string|undefined,signal:AbortSignal){
 signal.throwIfAborted();const result=await transport.transcribe(audio,language,signal);signal.throwIfAborted();
 if(typeof result.text!=='string'||!result.text.trim())throw new VoiceError(422,'No transcript was recognized. Check microphone/noise/language and record again.');
 if(result.text.length>8000)throw new VoiceError(422,'Transcript exceeded the review limit. Make a shorter recording.');
 return {text:result.text.trim(),seconds:result.seconds};
}
