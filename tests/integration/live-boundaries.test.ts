import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {randomBytes,createHash} from 'node:crypto';
import {localFixtures} from '../support/local-fixtures';
import type {Database} from '../../src/lib/database.types';
import {liveResponse,type AITransport} from '../../src/lib/ai/provider';
let f:Awaited<ReturnType<typeof localFixtures>>,a:SupabaseClient<Database>,b:SupabaseClient<Database>,oa:string,ob:string;
const run=randomBytes(12).toString('hex');
function value<T>(result:{data:unknown;error:{code?:string}|null}):T{if(result.error)throw new Error(`Live fixture SQLSTATE ${result.error.code??'unclassified'}`);return result.data as T;}
async function reserve(client=a,purpose='ordinary',request=crypto.randomUUID(),attempt=crypto.randomUUID()){
 const token=randomBytes(32).toString('hex');const r=value<{id:string;reserved_paise:number}>(await client.rpc('m2c_ai_reserve_v1',{p_request:request,p_attempt:attempt,p_purpose:purpose,p_model:'gpt-6-luna',p_input:1000,p_output:384,p_hash:createHash('sha256').update(token).digest('hex')}));return {...r,token};
}
const accounting=(id:string,token:string,action:string,client=a,usage:Record<string,number|string>|null=null)=>client.rpc('m2c_ai_account_v1',{p_id:id,p_token:token,p_action:action,p_usage:usage});
beforeAll(async()=>{
 f=await localFixtures();a=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});b=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const aa=await a.auth.signInWithPassword(f.users.alex),bb=await b.auth.signInWithPassword(f.users.sam);if(!aa.data.user||!bb.data.user)throw new Error('Synthetic Auth failed');oa=aa.data.user.id;ob=bb.data.user.id;
 // Separate test policy/ledger scope. Never overwrite the retained personal phone/key binding.
 await f.sql`insert into private.ai_test_policies(owner_id,run_id,ai_enabled,ai_evaluation_enabled) values(${oa},${run},true,true),(${ob},${run},true,true)`;
 // Explicit synthetic consent through the same ordinary-user control as Settings.
 for(const c of [a,b]){const p=value<{preferences:{version:number}}>(await c.rpc('privacy_get_v1',{}));value(await c.rpc('privacy_command_v1',{p_action:'consent',p_request:crypto.randomUUID(),p_data:{version:p.preferences.version,text_cloud:true,notifications:false}}));}
});
beforeEach(async()=>{await f.sql`delete from public.ai_requests where scope_id=${run} and owner_id in (${oa},${ob})`;await f.sql`update private.ai_test_policies set ai_enabled=true,ai_evaluation_enabled=true where run_id=${run} and owner_id in (${oa},${ob})`;});
afterAll(async()=>{await f?.close();});
it('operator-only generic test permission survives helper ownership transfer without granting API or worker access',async()=>{
 // Catalog and actual role-ACL checks, not tenant-isolation evidence or a send.
 const [acl]=await f.sql`select current_user as operator,
  has_function_privilege('postgres','private.m2c_channel_test_v1(uuid)','EXECUTE') as operator_execute,
  has_function_privilege('anon','private.m2c_channel_test_v1(uuid)','EXECUTE') as anon_execute,
  has_function_privilege('authenticated','private.m2c_channel_test_v1(uuid)','EXECUTE') as api_execute,
  has_function_privilege('authenticator','private.m2c_channel_test_v1(uuid)','EXECUTE') as gateway_execute,
  has_function_privilege('service_role','private.m2c_channel_test_v1(uuid)','EXECUTE') as service_execute,
  has_function_privilege('jarvis_reminder_worker','private.m2c_channel_test_v1(uuid)','EXECUTE') as worker_execute,
  (select r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='private.m2c_channel_test_v1(uuid)'::regprocedure) as owner`;
 expect(acl).toEqual({operator:'postgres',operator_execute:true,anon_execute:false,api_execute:false,gateway_execute:false,service_execute:false,worker_execute:false,owner:'jarvis_auth_guard'});
 await expect(f.sql.begin(async tx=>{
  await tx`set local role authenticated`;
  await tx`select private.m2c_channel_test_v1(${oa})`;
 })).rejects.toMatchObject({code:'42501'});
});
it('A/B cannot read/change each other’s accounting or substitute ownership, even with a known settlement capability',async()=>{
 const r=await reserve();expect((await b.from('ai_requests').select('id,state,charged_paise').eq('id',r.id)).data).toEqual([]);
 expect((await accounting(r.id,r.token,'release',b)).error?.code).toBe('42501');
 expect((await a.from('ai_requests').update({owner_id:ob,charged_paise:0}).eq('id',r.id)).error!==null).toBe(true);
 expect((await a.from('ai_requests').select('charged_paise').eq('id',r.id)).data?.[0].charged_paise).toBe(r.reserved_paise);
 expect((await a.from('ai_requests').select('*').eq('id',r.id)).error!==null).toBe(true); // private hash/scope columns not granted
});
it('a forged settlement token cannot refund a legitimate server reservation',async()=>{const r=await reserve();expect((await accounting(r.id,'a'.repeat(64),'release')).error?.code).toBe('42501');expect((await a.from('ai_requests').select('charged_paise').eq('id',r.id)).data?.[0].charged_paise).toBe(r.reserved_paise);});
it('serializes concurrent reservations and prevents allowance bypass',async()=>{
 const seed=await reserve();await f.sql`update public.ai_requests set state='settled',charged_paise=99990 where id=${seed.id} and scope_id=${run}`;
 const outcomes=await Promise.all([a,b].map(client=>reserve(client).then(()=>true,()=>false)));expect(outcomes.filter(Boolean)).toHaveLength(1);
 const [sum]=await f.sql`select sum(charged_paise)::integer n from public.ai_requests where scope_id=${run}`;expect(sum.n).toBeLessThanOrEqual(100000);
});
it('evaluation has a separate lifetime ₹200 sublimit inside the monthly ₹1000 limit',async()=>{
 const seed=await reserve(a,'evaluation');await f.sql`update public.ai_requests set state='settled',charged_paise=20000 where id=${seed.id} and scope_id=${run}`;
 await expect(reserve(a,'evaluation')).rejects.toThrow(/54000/);await expect(reserve(a,'ordinary')).resolves.toHaveProperty('id');
});
it('released pre-dispatch calls cost zero; dispatched uncertain calls retain their conservative charge',async()=>{
 const r=await reserve();value(await accounting(r.id,r.token,'release'));expect((await a.from('ai_requests').select('charged_paise').eq('id',r.id)).data?.[0].charged_paise).toBe(0);
 const sent=await reserve();value(await accounting(sent.id,sent.token,'dispatch'));expect((await accounting(sent.id,sent.token,'release')).error?.code).toBe('40001');value(await accounting(sent.id,sent.token,'unknown'));
 expect((await a.from('ai_requests').select('charged_paise,state').eq('id',sent.id)).data?.[0]).toEqual({charged_paise:sent.reserved_paise,state:'unknown'});
});
it('a reservation from another month cannot dispatch against that expired period',async()=>{
 const r=await reserve();await f.sql`update public.ai_requests set budget_month=(date_trunc('month',now() at time zone 'Asia/Kolkata')-interval '1 month')::date where id=${r.id} and scope_id=${run}`;
 const result=value<{dispatched:boolean;state:string}>(await accounting(r.id,r.token,'dispatch'));expect(result).toMatchObject({dispatched:false,state:'released'});
});
it('settles numeric cache categories and disables AI on an unexpectedly exceeded bound without increasing the cap',async()=>{
 const r=await reserve();value(await accounting(r.id,r.token,'dispatch'));value(await accounting(r.id,r.token,'settle',a,{input:1001,output:10,cached:0,write30:0,write12:0,reasoning:0,model:'gpt-6-luna',response_id:'resp_fixture'}));
 await expect(reserve()).rejects.toThrow(/42501/);
});
it('request/hash conflicts fail before dispatch instead of adopting another caller’s reservation',async()=>{
 const request=crypto.randomUUID(),attempt=crypto.randomUUID();await reserve(a,'ordinary',request,attempt);await expect(reserve(a,'ordinary',request,attempt)).rejects.toThrow(/40001/);
});
it('real accounting wraps streamed HTTP fixtures; no actual OpenAI call or credit is used',async()=>{
 let calls=0;const transport:AITransport={responses:{async create(body){calls++;expect(body.store).toBe(false);expect(body).not.toHaveProperty('previous_response_id');expect(body).not.toHaveProperty('conversation');return (async function*(){yield {type:'response.output_text.delta',delta:'A synthetic reply.'};yield {type:'response.completed',response:{status:'completed',id:'resp_fixture',model:'gpt-6-luna',usage:{input_tokens:100,output_tokens:8,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}}};})();}}};
 for await(const _event of liveResponse({client:a,request_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),key:'unused-fixture-key',model:'gpt-6-luna',purpose:'ordinary',signal:new AbortController().signal,context:{text:'hello',assistantName:'Assistant',allowMemory:true,memories:[],history:[],tone:'balanced',timezone:'Asia/Kolkata',now:new Date().toISOString()},transport})){void _event;}
 expect(calls).toBe(1);expect((await a.from('ai_requests').select('state')).data?.[0].state).toBe('settled');
});
it('interrupted provider fixtures preserve uncertainty rather than refunding or silently retrying',async()=>{
 let calls=0;const transport:AITransport={responses:{async create(){calls++;return (async function*(){yield {type:'response.output_text.delta',delta:'Unconfirmed'};throw new Error('synthetic interruption');})();}}};
 try{for await(const event of liveResponse({client:a,request_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),key:'unused-fixture-key',model:'gpt-6-luna',signal:new AbortController().signal,context:{text:'hello',assistantName:'Assistant',allowMemory:false,memories:[],history:[],tone:'balanced',timezone:'UTC',now:new Date().toISOString()},transport})){void event;}}catch{/* Expected controlled interruption. */}
 expect(calls).toBe(1);const row=(await a.from('ai_requests').select('state,reserved_paise,charged_paise')).data?.[0];expect(row?.state).toBe('unknown');expect(row?.charged_paise).toBe(row?.reserved_paise);
});
it('other synthetic users cannot inherit the configured personal phone or select its live channel',async()=>{
 const caps=value<{pushover_enabled:boolean;ai_enabled:boolean}>(await b.rpc('m2c_capabilities_v1',{}));expect(caps.pushover_enabled).toBe(false);
 const due=new Date(Date.now()+3600_000).toISOString().replace('.000Z','Z');
 expect((await b.rpc('m2b_reminder_v1',{p_action:'review',p_request:crypto.randomUUID(),p_data:{title:'Synthetic',local_datetime:due.slice(0,19),timezone:'UTC',due_at:due,resolution:'unique',channel:'pushover'}})).error?.code).toBe('42501');
 expect((await b.rpc('m2c_observe_phone_v1',{p_attempt:crypto.randomUUID(),p_observed:true,p_at:new Date().toISOString()})).error?.code).toBe('42501');
});
it('natural proposals need exact separate approval; foreign source/conflict IDs and legacy approval bypass are denied',async()=>{
 const c=value<{id:string}>(await a.rpc('m2a_create_conversation_v1',{}));const started=value<{turn:{id:string;attempt:string}}>(await a.rpc('m2a_start_turn_v1',{p_conversation:c.id,p_request:crypto.randomUUID(),p_text:'Please remember that I prefer concise explanations.'}));
 const result=value<{proposal_id:string}>(await a.rpc('m2c_finish_turn_v1',{p_id:started.turn.id,p_attempt:started.turn.attempt,p_text:'Review the exact proposal in Memory.',p_used:[],p_proposal:{content:'Prefers concise explanations.',conflict_id:null,conflict_version:null},p_model:'gpt-6-luna'}));
 expect((await a.from('memories').select('id').eq('proposal_id',result.proposal_id)).data).toEqual([]);
 expect((await b.rpc('m2c_approve_memory_v1',{p_id:result.proposal_id,p_version:1,p_content:'Prefers concise explanations.',p_reviewed:true})).error?.code).toBe('42501');
 expect((await a.rpc('m2a_memory_v1',{p_action:'approve',p_id:result.proposal_id,p_version:1,p_content:'Prefers concise explanations.'})).error?.code).toBe('40001');
 expect((await a.rpc('m2c_approve_memory_v1',{p_id:result.proposal_id,p_version:1,p_content:'Changed content',p_reviewed:true})).error?.code).toBe('40001');
 value(await a.rpc('m2c_approve_memory_v1',{p_id:result.proposal_id,p_version:1,p_content:'Prefers concise explanations.',p_reviewed:true}));
 expect((await a.from('memories').select('id').eq('proposal_id',result.proposal_id)).data).toHaveLength(1);
});
it('expired conversations are hidden, reject further writes and purge sources while preserving independently approved memory',async()=>{
 const c=value<{id:string}>(await a.rpc('m2a_create_conversation_v1',{}));const started=value<{turn:{id:string;attempt:string}}>(await a.rpc('m2a_start_turn_v1',{p_conversation:c.id,p_request:crypto.randomUUID(),p_text:'Remember: retention fixture: synthetic'}));
 const done=value<{proposal_id:string}>(await a.rpc('m2a_end_turn_v1',{p_id:started.turn.id,p_attempt:started.turn.attempt,p_state:'complete',p_text:'Synthetic proposal.'}));
 const memory=value<{id:string}>(await a.rpc('m2a_memory_v1',{p_action:'approve',p_id:done.proposal_id,p_version:1,p_content:'retention fixture: synthetic'}));
 await f.sql`update public.conversations set expires_at=now()-interval '1 second' where id=${c.id} and owner_id=${oa}`;
 expect((await a.from('conversations').select('id').eq('id',c.id)).data).toEqual([]);expect((await a.from('messages').select('id').eq('conversation_id',c.id)).data).toEqual([]);
 expect((await a.rpc('m2a_start_turn_v1',{p_conversation:c.id,p_request:crypto.randomUUID(),p_text:'cannot resurrect'})).error?.code).toBe('42501');
 value(await a.rpc('m2c_cleanup_self_v1',{}));const retained=(await a.from('memories').select('state,source_message_id').eq('id',memory.id)).data?.[0];expect(retained).toEqual({state:'active',source_message_id:null});
});
