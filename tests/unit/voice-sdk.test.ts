import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {openAITranscription} from '../../src/lib/voice/transcription';
import {encodeWav} from '../../src/lib/voice/audio';
it('installed official SDK creates a bounded audio multipart request to the transcription endpoint',async()=>{
 let calls=0;const wire:typeof fetch=async(input,init)=>{if(input==='data:,')return new Response('');calls++;const req=new Request(input,init);expect(req.url).toBe('https://api.openai.com/v1/audio/transcriptions');const form=await req.formData();expect(form.get('model')).toBe('gpt-transcribe');expect([...form.keys()].sort()).toEqual(['file','languages[]','model']);expect(form.get('languages[]')).toBe('en');const file=form.get('file') as File;expect(file.type).toBe('audio/wav');expect(file.size).toBe(32044);return new Response(JSON.stringify({text:'SDK fixture transcript',usage:{type:'duration',seconds:1}}),{headers:{'Content-Type':'application/json'}});};
 const result=await openAITranscription('NONCREDENTIAL',wire).transcribe(encodeWav(new Float32Array(16000).fill(.01)),'en',new AbortController().signal);expect(result).toEqual({text:'SDK fixture transcript',seconds:1});expect(calls).toBe(1);
});
it('SDK 429 body is suppressed and does not trigger a hidden paid retry',async()=>{let calls=0;const wire:typeof fetch=async(input)=>{if(input==='data:,')return new Response('');calls++;return new Response(JSON.stringify({error:{message:'SECRET_PROVIDER_BODY',type:'rate_limit'}}),{status:429,headers:{'Content-Type':'application/json'}});};await expect(openAITranscription('NONCREDENTIAL',wire).transcribe(new Uint8Array(),undefined,new AbortController().signal)).rejects.not.toThrow('SECRET_PROVIDER_BODY');expect(calls).toBe(1);});
