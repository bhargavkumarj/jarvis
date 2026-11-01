import {it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {ResponseCreateParamsStreaming} from 'openai/resources/responses/responses';
import type {Database} from '../../src/lib/database.types';
import {createOpenAIClient,liveResponse,responseUsage,type AITransport,type LiveEvent} from '../../src/lib/ai/provider';
const usage={input_tokens:100,output_tokens:8,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:2},total_tokens:108};
const completed={type:'response.completed',response:{status:'completed',id:'resp_synthetic',model:'gpt-6-luna',usage}};
function harness(events:unknown[],status=200){
 const accounts:string[]=[];
 // This stub proves adapter lifecycle only. Real policy tests remain in integration/.
 const client={rpc:vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='m2c_ai_reserve_v1')return {data:{id:crypto.randomUUID(),acquired:true,reserved_paise:20},error:null};
  accounts.push(args.p_action as string);return {data:{dispatched:true,state:'settled',charged_paise:1},error:null};
 })} as unknown as SupabaseClient<Database>;
 const request=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(status===200?events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n':JSON.stringify({error:{message:'synthetic failure',type:'rate_limit_error'}}),{status,headers:{'content-type':status===200?'text/event-stream':'application/json'}}));
 const sdk=createOpenAIClient('noncredential-synthetic-sentinel',request);
 const transport:AITransport={responses:{create:(body,options)=>sdk.responses.create(body as unknown as ResponseCreateParamsStreaming,options)}};
 const run=(text='Hello',signal=new AbortController().signal)=>liveResponse({client,request_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),key:'unused',model:'gpt-6-luna',signal,transport,context:{text,assistantName:'Assistant',tone:'balanced',timezone:'Asia/Kolkata',now:'2026-10-29T00:00:00Z',allowMemory:true,memories:[],history:[]}});
 return {accounts,request,run};
}
it('the installed SDK parses actual SSE framing and sends bounded, stateless requests',async()=>{
 const h=harness([{type:'response.output_text.delta',delta:'Hello.'},completed]);const events=[];for await(const event of h.run())events.push(event);
 expect(events.map(e=>e.type)).toEqual(['delta','usage','actions','success']);expect(h.accounts).toEqual(['dispatch','settle']);expect(h.request).toHaveBeenCalledTimes(1);
 const [url,options]=h.request.mock.calls[0];expect(String(url)).toBe('https://api.openai.com/v1/responses');
 const body=JSON.parse(options!.body as string);expect(body).toMatchObject({store:false,stream:true,max_output_tokens:1024,reasoning:{effort:'low'},parallel_tool_calls:false,prompt_cache_options:{mode:'explicit',ttl:'30m'}});
 expect(body).not.toHaveProperty('conversation');expect(body).not.toHaveProperty('previous_response_id');expect(JSON.stringify(body)).not.toContain('noncredential-synthetic-sentinel');
});
it('one typed SDK function call proposes memory without claiming approval or persistence',async()=>{
 const h=harness([{type:'response.output_item.done',item:{type:'function_call',name:'propose_actions_v1',arguments:JSON.stringify({memory:{content:'Prefers concise replies.',conflict_id:null,conflict_version:null},reminder:null,clarification:null})}},completed]);
 const events=[];for await(const event of h.run('Please remember that I prefer concise replies.'))events.push(event);
 expect(events.find(e=>e.type==='actions')).toMatchObject({plan:{memory:{content:'Prefers concise replies.'}}});expect(h.accounts).toEqual(['dispatch','settle']);
});
it('an interrupted SDK stream cannot complete an answer or refund a dispatched request',async()=>{
 const h=harness([{type:'response.output_text.delta',delta:'Partial'}]);await expect(async()=>{for await(const event of h.run())void event;}).rejects.toMatchObject({kind:'incomplete'});expect(h.accounts).toEqual(['dispatch','unknown']);
});
it('unsupported action-success claims never emit success',async()=>{
 const h=harness([{type:'response.output_text.delta',delta:'I have scheduled your reminder.'},completed]);const events:LiveEvent[]=[];
 await expect(async()=>{for await(const event of h.run())events.push(event);}).rejects.toMatchObject({kind:'invalid'});expect(events).toEqual([]);expect(h.accounts).toEqual(['dispatch','unknown']);
});
it('SDK rate-limit failures are not retried and conservatively retain the reservation',async()=>{
 const h=harness([],429);await expect(async()=>{for await(const event of h.run())void event;}).rejects.toThrow();expect(h.request).toHaveBeenCalledTimes(1);expect(h.accounts).toEqual(['dispatch','unknown']);
});
it('pre-dispatch cancellation releases the hold without making an HTTP request',async()=>{
 const h=harness([]);await expect(async()=>{for await(const event of h.run('Hello',AbortSignal.abort()))void event;}).rejects.toThrow();expect(h.request).not.toHaveBeenCalled();expect(h.accounts).toEqual(['release']);
});
it('unrecognized cache billing stays uncertain rather than undercharging',()=>{
 expect(responseUsage(usage)).toMatchObject({input:100,output:8,reasoning:2,write30:0,write12:0});
 expect(()=>responseUsage({...usage,input_tokens_details:{cached_tokens:0,cache_write_tokens:10}})).toThrow('Unrecognized billable cache');
});
it('surfaces streamed refusals as a complete answer only after valid completion and usage',async()=>{
 const h=harness([{type:'response.refusal.delta',delta:'I cannot perform that action.'},completed]);const events=[];
 for await(const event of h.run())events.push(event);
 expect(events[0]).toEqual({type:'delta',text:'I cannot perform that action.'});expect(events.at(-1)?.type).toBe('success');expect(h.accounts).toEqual(['dispatch','settle']);
});
it.each(['response.failed','response.incomplete','error'])('never completes or refunds an SDK %s event',async type=>{
 const h=harness([{type}]);await expect(async()=>{for await(const e of h.run())void e;}).rejects.toMatchObject({kind:'incomplete'});expect(h.accounts).toEqual(['dispatch','unknown']);
});
it.each([401,403,429])('maps SDK status %s to a safe recovery reason',async status=>{
 const h=harness([],status);await expect(async()=>{for await(const e of h.run())void e;}).rejects.toMatchObject({kind:status===429?'rate_limit':'credentials'});expect(h.request).toHaveBeenCalledTimes(1);
});
it('rejects a second tool round and never emits proposals as success',async()=>{
 const call={type:'response.output_item.done',item:{type:'function_call',name:'propose_actions_v1',arguments:'{"memory":null,"reminder":null,"clarification":"Which time?"}'}};
 const h=harness([call,call,completed]);const events:LiveEvent[]=[];
 await expect(async()=>{for await(const e of h.run())events.push(e);}).rejects.toMatchObject({kind:'invalid'});expect(events.some(e=>e.type==='actions'||e.type==='success')).toBe(false);
});
it('does not invent an answer for an empty completed provider result',async()=>{
 const h=harness([completed]);await expect(async()=>{for await(const e of h.run())void e;}).rejects.toMatchObject({kind:'incomplete'});expect(h.accounts).toEqual(['dispatch','settle']);
});
