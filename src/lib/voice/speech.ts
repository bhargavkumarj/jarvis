export type LocalVoice=Pick<SpeechSynthesisVoice,'voiceURI'|'name'|'lang'|'localService'|'default'>;
export function localVoice(voices:LocalVoice[],language='en'){const local=voices.filter(v=>v.localService===true);return local.find(v=>v.lang.toLowerCase()===language.toLowerCase())??local.find(v=>v.lang.toLowerCase().split('-')[0]===language.toLowerCase().split('-')[0])??null;}
export function speechText(text:string){
 const plain=text.replace(/```[\s\S]*?```/g,' Code block omitted. ').replace(/`[^`]*`/g,' Code omitted. ').replace(/!\[[^\]]*\]\([^)]*\)/g,' Image omitted. ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/(?:https?:\/\/|www\.)\S+/gi,' link omitted ').replace(/^\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s)/gm,'').replace(/[*_~|]/g,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
 return {text:plain.slice(0,2000),truncated:plain.length>2000};
}
export interface SpeechOutput {speak:(text:string,voice:SpeechSynthesisVoice,rate:number,done:()=>void,failed:()=>void)=>void;stop:()=>void;}
export function browserSpeech():SpeechOutput|null{
 if(typeof speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined')return null;
 return {speak(text,voice,rate,done,failed){if(!voice.localService){failed();return;}try{speechSynthesis.cancel();}catch{failed();return;}const u=new SpeechSynthesisUtterance(text);u.voice=voice;u.rate=Math.max(.8,Math.min(1.2,rate));u.onend=done;u.onerror=failed;try{speechSynthesis.speak(u);}catch{failed();}},stop(){try{speechSynthesis.cancel();}catch{/* Missing/terminated speech service. */}}};
}
export const VOICE_STOP_EVENT='jarvis:stop-voice';
export function stopVoice(){if(typeof window!=='undefined')window.dispatchEvent(new Event(VOICE_STOP_EVENT));}
