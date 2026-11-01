import {it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../src/lib/database.types';
import {reserveAI} from '../../src/lib/ai/budget';
import {LiveAIError,liveFailureMessage} from '../../src/lib/ai/errors';
function db(rpc:ReturnType<typeof vi.fn>){return {rpc} as unknown as SupabaseClient<Database>;}
it('parallel callers independently await the atomic database reservation; denied calls cannot dispatch',async()=>{
 let count=0;const rpc=vi.fn(async(name:string)=>name==='m2c_ai_reserve_v1'?(++count===1?{data:{id:crypto.randomUUID(),acquired:true,reserved_paise:20},error:null}:{data:null,error:{code:'54000'}}):{data:{dispatched:true},error:null});
 const result=await Promise.allSettled([0,1].map(()=>reserveAI(db(rpc),crypto.randomUUID(),crypto.randomUUID(),'ordinary','gpt-6-luna',{input:1000,output:1024})));
 expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(rpc).toHaveBeenCalledTimes(2);
 // This verifies delegation/gating, not database locking. Real concurrency proof
 // remains the ordinary-identity integration suite on the new machine.
});
it('keeps the settlement capability private and releases only requests that were never dispatched',async()=>{
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{void args;return {data:name==='m2c_ai_reserve_v1'?{id:crypto.randomUUID(),acquired:true,reserved_paise:20}:{dispatched:true},error:null};});
 const r=await reserveAI(db(rpc),crypto.randomUUID(),crypto.randomUUID(),'ordinary','gpt-6-luna',{input:1000,output:1024});
 expect(r).not.toHaveProperty('token');expect(r).not.toHaveProperty('hash');
 await r.uncertain();expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_action:'release'});
 const sent=await reserveAI(db(rpc),crypto.randomUUID(),crypto.randomUUID(),'ordinary','gpt-6-luna',{input:1000,output:1024});await sent.dispatch();await sent.uncertain();expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_action:'unknown'});
});
it('never treats unknown provider or driver messages as safe public text',()=>{
 expect(liveFailureMessage(new Error('DO_NOT_REFLECT_KEY_OR_CONTENT'))).not.toContain('DO_NOT_REFLECT');
 expect(liveFailureMessage(new LiveAIError('allowance'))).toContain('Manual reminders remain available');
});
