// Shared by server/CLI; no privileged DB client, provider key or content storage.
import {randomBytes,createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../database.types';
import type {Json} from '../database.generated';
import type {Usage,ModelId} from './pricing.ts';
import {LiveAIError} from './errors.ts';
export async function reserveAI(client:SupabaseClient<Database>,request:string,attempt:string,purpose:'ordinary'|'evaluation',model:ModelId,bounds:{input:number;output:number}){
 const token=randomBytes(32).toString('hex');
 const result=await client.rpc('m2c_ai_reserve_v1',{p_request:request,p_attempt:attempt,p_purpose:purpose,p_model:model,p_input:bounds.input,p_output:bounds.output,p_hash:createHash('sha256').update(token).digest('hex')});
 if(result.error)throw new LiveAIError(result.error.code==='54000'?'allowance':result.error.code==='42501'?'disabled':'accounting');
 const r=result.data as {id:string;acquired:boolean;reserved_paise:number};if(!r.acquired)throw new Error('This provider attempt already has a reservation; no duplicate dispatch.');
 let dispatched=false,closed=false;
 const account=async(action:string,usage:Json|null=null)=>{
  const response=await client.rpc('m2c_ai_account_v1',{p_action:action,p_id:r.id,p_token:token,p_usage:usage});
  if(response.error)throw new LiveAIError('accounting');return response.data as {dispatched?:boolean;state:string;charged_paise:number};
 };
 return {id:r.id,reserved_paise:r.reserved_paise,
  async dispatch(){const result=await account('dispatch');if(!result.dispatched)throw new Error('Budget period changed or attempt is unavailable. Retry without sending this request.');dispatched=true;},
  async settle(usage:Usage,model:string,response_id:string){const value=await account('settle',{...usage,model,response_id});closed=true;return value;},
  async uncertain(){if(closed)return;try{await account(dispatched?'unknown':'release');closed=true;}catch{/* Full reservation remains; never silently refund. */}},
 };
}
