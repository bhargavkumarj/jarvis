// Server/Node only. Next uses this through its server-only orchestration route;
// CLI evaluation uses the same SDK adapter with synthetic context.
import OpenAI from 'openai';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../database.types';
import {reserveAI} from './budget.ts';
import {reservationBounds,validateUsage,type ModelId,type Usage} from './pricing.ts';
import {buildInput,type LiveContext} from './context.ts';
import {actionPlanSchema,EMPTY_PLAN,proposalTool,unsupportedSuccessClaim,validateActions,type ActionPlan} from './contracts.ts';
import {LiveAIError} from './errors.ts';
export type LiveEvent={type:'delta';text:string}|{type:'actions';plan:ActionPlan}|{type:'usage';charged_paise:number;reservation_id:string;usage:Usage;model:string}|{type:'success'};
export type AITransport={responses:{create:(body:Record<string,unknown>,options:{signal:AbortSignal})=>Promise<AsyncIterable<unknown>>}};
export function createOpenAIClient(key:string,request?:typeof fetch){
 return new OpenAI({apiKey:key,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:25000,logLevel:'off',...(request?{fetch:request}:{})});
}
export function responseUsage(raw:unknown):Usage{
 const r=raw as {input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number;cache_write_tokens?:number;cache_write_tokens_details?:{ttl_30m_tokens?:number;ttl_12h_tokens?:number}};output_tokens_details?:{reasoning_tokens?:number}};
 const d=r.input_tokens_details;const write30=d?.cache_write_tokens_details?.ttl_30m_tokens??0,write12=d?.cache_write_tokens_details?.ttl_12h_tokens??0;
 if((d?.cache_write_tokens??0)!==write30+write12)throw new Error('Unrecognized billable cache usage; keep conservative reservation.');
 const u={input:r.input_tokens!,output:r.output_tokens!,cached:d?.cached_tokens??0,write30,write12,reasoning:r.output_tokens_details?.reasoning_tokens??0};
 if(!validateUsage(u))throw new Error('Final usage is unavailable; keep conservative reservation.');return u;
}
export async function* liveResponse(params:{client:SupabaseClient<Database>;request_id:string;attempt_id:string;key:string;model:ModelId;context:LiveContext;signal:AbortSignal;purpose?:'ordinary'|'evaluation';transport?:AITransport}):AsyncGenerator<LiveEvent>{
 const purpose=params.purpose??'ordinary';const c=params.context;
 const body={model:params.model,...buildInput(c),store:false,stream:true as const,service_tier:'default' as const,reasoning:{effort:'low' as const},max_output_tokens:1024,
  // No explicit breakpoints: disable implicit caching/extra retained prefix state.
  prompt_cache_options:{mode:'explicit' as const,ttl:'30m' as const},parallel_tool_calls:false,tools:c.allowMemory?[proposalTool]:[],tool_choice:c.allowMemory?'auto' as const:'none' as const};
 const bounds=reservationBounds(body,purpose);
 const reservation=await reserveAI(params.client,params.request_id,params.attempt_id,purpose,params.model,bounds);
 let text='',calls=0,plan:ActionPlan=EMPTY_PLAN,completed=false,usageRecorded=false;
 try{
  params.signal.throwIfAborted();
  // Immediately recheck approved revisions before the request leaves the host.
  if(purpose==='ordinary')for(const m of c.memories){const result=await params.client.from('memories').select('id,version').eq('id',m.id).eq('state','active').eq('version',m.version).maybeSingle();if(result.error||!result.data)throw new LiveAIError('context');}
  if(c.conversation_id){const guarded=await params.client.rpc('privacy_context_v1',{p_conversation:c.conversation_id,p_epoch:c.privacy_epoch??null});if(guarded.error)throw new LiveAIError('context');}
  await reservation.dispatch();params.signal.throwIfAborted();
  const stream=params.transport?await params.transport.responses.create(body,{signal:params.signal}):await createOpenAIClient(params.key).responses.create(body,{signal:params.signal});
  for await(const raw of stream){
   params.signal.throwIfAborted();const event=raw as {type:string;delta?:string;item?:{type:string;name:string;arguments:string};response?:{id:string;model:string;usage:unknown;status:string}};
   if(event.type==='response.output_text.delta'||event.type==='response.refusal.delta'){
    const delta=event.delta??'';text+=delta;
    if(text.length>8000||unsupportedSuccessClaim(text))throw new LiveAIError('invalid');
    yield {type:'delta',text:delta};
   }else if(event.type==='response.output_item.done'&&event.item?.type==='function_call'){
    if(++calls>1||event.item.name!=='propose_actions_v1')throw new LiveAIError('invalid');
    try{plan=validateActions(actionPlanSchema.parse(JSON.parse(event.item.arguments)),c.text,!c.allowMemory,c.memories);}catch{throw new LiveAIError('invalid');}
   }else if(event.type==='response.completed'){
    if(!event.response||event.response.status!=='completed')throw new Error('No complete provider result');
    const r=event.response;if(r.model!==params.model&&!r.model.startsWith(params.model+'-'))throw new Error('Unexpected model response');
    const usage=responseUsage(r.usage);const settled=await reservation.settle(usage,r.model,r.id);usageRecorded=true;
    yield {type:'usage',charged_paise:settled.charged_paise,reservation_id:reservation.id,usage,model:r.model};completed=true;
   }else if(['response.failed','response.incomplete','error'].includes(event.type))throw new LiveAIError('incomplete');
  }
  if(!completed)throw new Error('Interrupted provider stream.');
  if(!text.trim()&&!plan.memory&&!plan.reminder&&!plan.clarification)throw new LiveAIError('incomplete');
  yield {type:'actions',plan};yield {type:'success'};
 }catch(error){
  if(error instanceof LiveAIError||params.signal.aborted)throw error;
  if(error instanceof OpenAI.APIConnectionTimeoutError)throw new LiveAIError('timeout');
  if(error instanceof OpenAI.APIError)throw new LiveAIError(error.status===429?'rate_limit':[401,403].includes(error.status??0)?'credentials':'unavailable');
  throw new LiveAIError('incomplete');
 }finally{if(!usageRecorded)await reservation.uncertain();}
}
