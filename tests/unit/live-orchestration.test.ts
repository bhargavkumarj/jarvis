import {beforeEach,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Profile} from '../../src/lib/database.types';
import type {Turn} from '../../src/lib/conversation/types';
import type {ActionPlan} from '../../src/lib/ai/contracts';
const m=vi.hoisted(()=>({config:vi.fn(),response:vi.fn(),review:vi.fn(),series:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../src/lib/live/config',()=>({readLiveConfig:m.config}));
vi.mock('../../src/lib/ai/provider',()=>({liveResponse:m.response}));
vi.mock('../../src/lib/reminders/service',()=>({reviewReminder:m.review}));
vi.mock('../../src/lib/reminders/series-service',()=>({reviewSeries:m.series}));
import {prepareLive,runLive,safeRecentHistory} from '../../src/lib/ai/orchestrate';
const owner=crypto.randomUUID();
const profile:Profile={owner_id:owner,assistant_name:'Assistant',display_name:'Synthetic',tone:'balanced',timezone:'Asia/Kolkata',locale:'en-IN',created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'};
const config={version:1,owner_id:owner,pushover:{token:'t'.repeat(30),user:'u'.repeat(30),device:'synthetic'},openai:{api_key:'NONCREDENTIAL_SENTINEL',model:'gpt-6-luna',enabled:true}};
const turn={id:crypto.randomUUID(),attempt:crypto.randomUUID(),owner_id:owner} as Turn;
const empty:ActionPlan={memory:null,reminder:null,clarification:null};
function client(finishError=false){return {rpc:vi.fn(async(name:string,args?:unknown)=>{void args;return {data:name==='m2c_capabilities_v1'?{ai_enabled:true,pushover_enabled:true}:name==='m2c_finish_turn_v1'?{proposal_id:null}:{},error:finishError&&name==='m2c_finish_turn_v1'?{code:'40001'}:null};})} as unknown as SupabaseClient<Database>;}
function response(plan=empty){m.response.mockImplementation(async function*(){yield {type:'actions',plan};yield {type:'success'};});}
async function input(db=client()){
 return {client:db,profile,turn,request_id:crypto.randomUUID(),text:'Remind me tomorrow at 8 PM to revise.',history:[],memories:[],signal:new AbortController().signal,prepared:await prepareLive(db,profile),emit:vi.fn()};
}
beforeEach(()=>{vi.clearAllMocks();m.config.mockReturnValue(structuredClone(config));response();m.review.mockResolvedValue({reminder:{id:crypto.randomUUID(),state:'draft',local_datetime:'2026-11-01T20:00:00',timezone:'Asia/Kolkata',due_at:'2026-11-01T14:30:00Z'},operation:{id:crypto.randomUUID()}});});
it('rejects a different configured owner before any provider or database orchestration',async()=>{
 m.config.mockReturnValue({...config,owner_id:crypto.randomUUID()});const db=client();await expect(prepareLive(db,profile)).rejects.toMatchObject({status:403});expect(db.rpc).not.toHaveBeenCalled();expect(m.response).not.toHaveBeenCalled();
});
it('does not let local configuration override a disabled account capability',async()=>{
 const db=client();vi.mocked(db.rpc).mockResolvedValueOnce({data:{ai_enabled:false,pushover_enabled:false},error:null} as never);
 await expect(prepareLive(db,profile)).rejects.toMatchObject({status:403});expect(m.response).not.toHaveBeenCalled();
});
it('a natural reminder produces only the same owned review operation and a receipt after commit',async()=>{
 response({...empty,reminder:{title:'Revise',local_datetime:'2026-11-01T20:00:00',timezone:'Asia/Kolkata',disambiguation:null}});
 const i=await input();const result=await runLive(i);
 expect(m.review).toHaveBeenCalledWith(i.client,i.request_id,expect.objectContaining({timezone:'Asia/Kolkata'}),undefined,undefined,'pushover',i.turn!.conversation_id);
 expect(result.receipt).toContain('Open Today to review and confirm');expect(result.receipt).toContain('no notification was sent by the AI');
 expect(vi.mocked(i.client.rpc).mock.calls.some(c=>/approve|confirm|enqueue|send/i.test(c[0]))).toBe(false);
});
it('a failed final commit cannot emit an authoritative operation receipt as response text',async()=>{
 response({...empty,reminder:{title:'Revise',local_datetime:'2026-11-01T20:00:00',timezone:'Asia/Kolkata',disambiguation:null}});
 const i=await input(client(true));await expect(runLive(i)).rejects.toMatchObject({status:409});expect(i.emit).not.toHaveBeenCalled();
});
it('a memory proposal never invokes approval and preserves exact proposed text for review',async()=>{
 const memory={content:'Prefers concise explanations.',conflict_id:null,conflict_version:null};response({...empty,memory});
 const i=await input();i.text='Please remember that I prefer concise explanations.';await runLive(i);
 expect(i.client.rpc).toHaveBeenCalledWith('m2c_finish_turn_v1',expect.objectContaining({p_proposal:memory}));
 expect(vi.mocked(i.client.rpc).mock.calls.some(c=>/approve/i.test(c[0]))).toBe(false);expect(m.review).not.toHaveBeenCalled();
});
it('temporary orchestration passes no approved memories and performs no content mutation even for a hostile plan fixture',async()=>{
 response({...empty,memory:{content:'Must not persist',conflict_id:null,conflict_version:null},reminder:{title:'Must not persist',local_datetime:'2026-11-01T20:00:00',timezone:'UTC',disambiguation:null}});
 const i=await input();const from=vi.fn(()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{owner_id:owner},error:null})})})}));
 const db={from,rpc:vi.fn()} as unknown as SupabaseClient<Database>;
 await runLive({...i,client:db,turn:undefined,memories:[{id:crypto.randomUUID(),version:1,content:'Must not leave temporary mode'}]});
 expect(m.response.mock.calls[0][0].context).toMatchObject({allowMemory:false,memories:[]});expect(db.rpc).not.toHaveBeenCalled();expect(m.review).not.toHaveBeenCalled();
});
it('a provider failure cannot create a draft or finish a saved response',async()=>{
 const i=await input();vi.mocked(i.client.rpc).mockClear();m.response.mockImplementation(async function*(){throw new Error('synthetic provider failure');yield;});
 await expect(runLive(i)).rejects.toThrow('synthetic provider failure');expect(m.review).not.toHaveBeenCalled();expect(i.client.rpc).not.toHaveBeenCalledWith('m2c_finish_turn_v1',expect.anything());
});
it('recent context is explicitly scoped and omits reviewed sources and derived assistant content',async()=>{
 const conversation=crypto.randomUUID(),source=crypto.randomUUID(),plain=crypto.randomUUID(),eq=vi.fn().mockReturnThis();
 const db={from:vi.fn((table:string)=>table==='messages'?{select:()=>({eq,order(){return this;},limit:async()=>({data:[{id:source,user_text:'Rejected memory source'},{id:plain,user_text:'Ordinary synthetic input'}],error:null})})}:{select:()=>({eq,in:async()=>({data:[{source_message_id:source}],error:null})})})};
 const chain={eq,order(){return this;},limit:async()=>({data:[{id:source,user_text:'Rejected memory source'},{id:plain,user_text:'Ordinary synthetic input'}],error:null}),in:async()=>({data:[{source_message_id:source}],error:null})};eq.mockReturnValue(chain);
 const history=await safeRecentHistory(db as unknown as SupabaseClient<Database>,owner,conversation);
 expect(eq).toHaveBeenCalledWith('owner_id',owner);expect(eq).toHaveBeenCalledWith('conversation_id',conversation);expect(history).toEqual([{user_text:'Ordinary synthetic input',assistant_text:''}]);
});

it('recurring model proposals create only an owner-session review and receipt after completion',async()=>{
 m.series.mockResolvedValue({series:{id:crypto.randomUUID()},operation:{id:crypto.randomUUID()}});
 response({...empty,recurrence:{title:'Synthetic study',frequency:'weekly',weekdays:[1,2,3,4,5],local_time:'20:00',timezone:'Asia/Kolkata',start_date:'2026-11-01',end_date:null}});
 const i=await input();i.text='Remind me every weekday at 8 PM to study starting 2026-11-01';const result=await runLive(i);
 expect(m.series).toHaveBeenCalledWith(i.client,i.request_id,expect.objectContaining({channel:'pushover',dst_policy:'shift_gap_forward_fold_earlier_v1',late_minutes:5}),undefined,undefined,i.turn!.conversation_id);
 expect(result.receipt).toContain('separate confirmation');expect(result.receipt).toContain('No schedule was confirmed');
 expect(vi.mocked(i.client.rpc).mock.calls.some(c=>/confirm|enqueue|send|approve/.test(c[0]))).toBe(false);
});
it('a temporary recurring proposal never invokes a persistent review operation',async()=>{
 response({...empty,recurrence:{title:'Not durable',frequency:'daily',weekdays:[],local_time:'20:00',timezone:'UTC',start_date:'2026-11-01',end_date:null}});
 const i=await input();const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{owner_id:owner},error:null})})})}),rpc:vi.fn()} as unknown as SupabaseClient<Database>;
 await runLive({...i,client:db,turn:undefined});expect(m.series).not.toHaveBeenCalled();expect(db.rpc).not.toHaveBeenCalled();
});
