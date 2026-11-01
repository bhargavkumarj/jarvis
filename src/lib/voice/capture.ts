import {chooseRecordingFormat,MAX_CAPTURE_BYTES,MAX_SECONDS,VoiceError} from './audio';
export type CaptureState='idle'|'permission'|'recording'|'stopped'|'failed';
type Recorder=Pick<MediaRecorder,'start'|'stop'|'state'|'ondataavailable'|'onstop'|'onerror'>;
export type CaptureDependencies={getUserMedia:()=>Promise<MediaStream>;supported:(type:string)=>boolean;recorder:(s:MediaStream,type:string)=>Recorder;now:()=>number;setTimer:(f:()=>void,ms:number)=>ReturnType<typeof setTimeout>;clearTimer:(id:ReturnType<typeof setTimeout>)=>void};
export class VoiceCapture {
 private epoch=0;private stream:MediaStream|null=null;private recorder:Recorder|null=null;private chunks:Blob[]=[];private bytes=0;private timer:ReturnType<typeof setTimeout>|null=null;private startTime=0;
 state:CaptureState='idle';
 constructor(private deps:CaptureDependencies,private changed:(state:CaptureState,message?:string)=>void,private completed:(blob:Blob)=>void){}
 private update(state:CaptureState,message?:string){this.state=state;this.changed(state,message);}
 private release(){if(this.timer)this.deps.clearTimer(this.timer);this.timer=null;this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;}
 async start(){
  if(this.state==='permission'||this.state==='recording')return;
  const format=chooseRecordingFormat(this.deps.supported);if(!format){this.update('failed','No supported recording format is available. Continue typing.');return;}
  const epoch=++this.epoch;this.chunks=[];this.bytes=0;this.update('permission');
  try{
   const stream=await this.deps.getUserMedia();if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;const recorder=this.deps.recorder(stream,format);this.recorder=recorder;
   recorder.ondataavailable=e=>{if(epoch!==this.epoch||!e.data.size)return;this.bytes+=e.data.size;if(this.bytes>MAX_CAPTURE_BYTES){this.cancel('Recording exceeded the 2 MiB limit. Record again.');return;}this.chunks.push(e.data);};
   recorder.onerror=()=>this.cancel('Microphone capture failed. Record again or continue typing.');
   recorder.onstop=()=>{this.release();if(epoch!==this.epoch)return;this.recorder=null;const blob=new Blob(this.chunks,{type:format});this.chunks=[];this.update('stopped');if(blob.size)this.completed(blob);else this.update('failed','No audio was captured. Record again.');};
   for(const track of stream.getTracks())track.onended=()=>this.cancel('Microphone capture was interrupted. Nothing was uploaded.');
   this.startTime=this.deps.now();this.update('recording');recorder.start(250);this.timer=this.deps.setTimer(()=>this.stop(),MAX_SECONDS*1000);
  }catch(error){if(epoch!==this.epoch)return;this.release();if(this.recorder){this.recorder.ondataavailable=null;this.recorder.onstop=null;this.recorder.onerror=null;}this.recorder=null;this.chunks=[];const name=(error as {name?:string}).name;this.update('failed',name==='NotAllowedError'?'Microphone permission was denied. Change browser permission or continue typing.':name==='NotFoundError'?'No microphone is available. Continue typing.':'Microphone unavailable. Use a secure local/HTTPS page and a supported browser, or continue typing.');}
 }
 stop(){if(this.state!=='recording')return;const recorder=this.recorder;this.update('stopped');if(this.timer)this.deps.clearTimer(this.timer);this.timer=null;try{if(recorder&&recorder.state!=='inactive')recorder.stop();}finally{this.release();}}
 cancel(message='Recording cancelled. Nothing was uploaded.'){
  ++this.epoch;const recorder=this.recorder;this.recorder=null;this.chunks=[];this.bytes=0;this.release();if(recorder){recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;try{if(recorder.state!=='inactive')recorder.stop();}catch{/* Cleanup remains best effort after track termination. */}}
  this.update('stopped',message);
 }
 elapsed(){return this.state==='recording'?Math.min(MAX_SECONDS,Math.floor((this.deps.now()-this.startTime)/1000)):0;}
}
export function browserCapture(changed:(state:CaptureState,message?:string)=>void,complete:(b:Blob)=>void){
 if(typeof MediaRecorder==='undefined'||!navigator.mediaDevices?.getUserMedia)throw new VoiceError(422,'Recording is unavailable in this browser or context. Continue typing.');
 return new VoiceCapture({getUserMedia:()=>navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true},video:false}),supported:t=>MediaRecorder.isTypeSupported(t),recorder:(s,type)=>new MediaRecorder(s,{mimeType:type,audioBitsPerSecond:96000}),now:()=>performance.now(),setTimer:setTimeout,clearTimer:clearTimeout},changed,complete);
}
