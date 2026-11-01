import {VoiceError,MAX_AUDIO_BYTES} from './audio';
// Per-process memory bound; durable cross-process paid limits are in the ledger.
export class VoiceLimiter {
 private active=new Set<string>();private recent=new Map<string,number[]>();
 acquire(owner:string,now=Date.now()){
  for(const [key,times] of this.recent){const alive=times.filter(t=>t>now-60000);if(alive.length)this.recent.set(key,alive);else this.recent.delete(key);}
  if(this.active.has(owner)||this.active.size>=4||(this.recent.get(owner)?.length??0)>=4||(!this.recent.has(owner)&&this.recent.size>=1000))throw new VoiceError(429,'Recording upload limit reached. Wait a minute before retrying.');
  this.active.add(owner);this.recent.set(owner,[...(this.recent.get(owner)??[]),now]);let released=false;
  return ()=>{if(!released){released=true;this.active.delete(owner);}};
 }
}
export async function readAudio(request:Request,signal:AbortSignal){
 const reader=request.body?.getReader();if(!reader)throw new VoiceError(422,'Recording is empty.');
 const target=new Uint8Array(MAX_AUDIO_BYTES);let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;if(size+value.length>target.length)throw new VoiceError(413,'Audio exceeds the 60-second WAV upload limit.');target.set(value,size);size+=value.length;}return target.slice(0,size);}
 finally{target.fill(0);signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
