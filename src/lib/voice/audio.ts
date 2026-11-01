// Canonical transient upload format. No compressed-codec parser or client duration trust.
export const SAMPLE_RATE=16000,MAX_SECONDS=60,MAX_AUDIO_BYTES=44+SAMPLE_RATE*MAX_SECONDS*2,MAX_CAPTURE_BYTES=2*1024*1024;
export const TRANSCRIPTION_MODEL='gpt-transcribe',VOICE_CONSENT='openai-audio-2026-10-31-v1';
export class VoiceError extends Error {constructor(public status:number,message:string){super(message);}}
function ascii(v:DataView,offset:number,length:number){let s='';for(let i=0;i<length;i++)s+=String.fromCharCode(v.getUint8(offset+i));return s;}
export function validateWav(bytes:Uint8Array){
 if(bytes.byteLength<44||bytes.byteLength>MAX_AUDIO_BYTES)throw new VoiceError(413,'Audio must be a nonempty recording of at most 60 seconds (1,920,044 bytes).');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(ascii(v,0,4)!=='RIFF'||v.getUint32(4,true)!==bytes.length-8||ascii(v,8,4)!=='WAVE'||ascii(v,12,4)!=='fmt '||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint32(24,true)!==SAMPLE_RATE||v.getUint32(28,true)!==SAMPLE_RATE*2||v.getUint16(32,true)!==2||v.getUint16(34,true)!==16||ascii(v,36,4)!=='data'||v.getUint32(40,true)!==bytes.length-44||(bytes.length-44)%2!==0)throw new VoiceError(422,'Use the recorder’s mono 16 kHz PCM WAV output. Other formats, metadata chunks and truncated files are not accepted.');
 const frames=(bytes.length-44)/2,duration=frames/SAMPLE_RATE;
 if(duration<.2||duration>MAX_SECONDS)throw new VoiceError(422,'Record between 0.2 and 60 seconds of audio.');
 let audible=false;for(let i=44;i<bytes.length;i+=2){if(Math.abs(v.getInt16(i,true))>8){audible=true;break;}}
 if(!audible)throw new VoiceError(422,'No audible samples were captured. Check your microphone and record again.');
 return {milliseconds:Math.ceil(duration*1000),seconds:duration};
}
export function encodeWav(samples:Float32Array){
 if(samples.length<3200||samples.length>SAMPLE_RATE*MAX_SECONDS)throw new VoiceError(422,'Recording duration is outside the supported range.');
 const bytes=new Uint8Array(44+samples.length*2),v=new DataView(bytes.buffer);
 const str=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,SAMPLE_RATE,true);v.setUint32(28,SAMPLE_RATE*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const x=Number.isFinite(samples[i])?Math.max(-1,Math.min(1,samples[i])):0;v.setInt16(44+i*2,x<0?x*32768:x*32767,true);}
 return bytes;
}
// Recorder choices are all provider-supported containers, then normalized to WAV
// for authoritative server duration validation. No browser speech-recognition API.
export const RECORDING_FORMATS=['audio/webm;codecs=opus','audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm'];
export function chooseRecordingFormat(supported:(s:string)=>boolean){return RECORDING_FORMATS.find(s=>supported(s))??null;}
export async function normalizeRecording(blob:Blob,signal:AbortSignal):Promise<Uint8Array>{
 signal.throwIfAborted();if(!blob.size||blob.size>MAX_CAPTURE_BYTES)throw new VoiceError(413,'The recording is empty or exceeds the 2 MiB capture limit. Record again.');
 if(typeof AudioContext==='undefined'||typeof OfflineAudioContext==='undefined')throw new VoiceError(422,'This browser cannot prepare audio safely. Continue typing.');
 const context=new AudioContext();let decoded:AudioBuffer|null=null;let rendered:AudioBuffer|null=null;let raw:ArrayBuffer|null=null;
 try{
  raw=await blob.arrayBuffer();signal.throwIfAborted();decoded=await context.decodeAudioData(raw);raw=null;signal.throwIfAborted();
  // A timer stop may include a short encoder tail. Explicitly trim it to 60 s.
  if(decoded.duration>62||!Number.isFinite(decoded.duration)||decoded.duration<.2)throw new VoiceError(422,'Capture was interrupted or exceeded its duration limit. Record again.');
  const frames=Math.min(SAMPLE_RATE*MAX_SECONDS,Math.floor(decoded.duration*SAMPLE_RATE));
  const offline=new OfflineAudioContext(1,frames,SAMPLE_RATE),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();rendered=await offline.startRendering();signal.throwIfAborted();
  const wav=encodeWav(rendered.getChannelData(0));validateWav(wav);return wav;
 }finally{if(raw)new Uint8Array(raw).fill(0);for(const b of [decoded,rendered])if(b)for(let c=0;c<b.numberOfChannels;c++)b.getChannelData(c).fill(0);await context.close().catch(()=>{});}
}
