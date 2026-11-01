import {beforeEach,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../src/lib/database.types';
import type {Task,TaskCandidate} from '../../src/lib/tasks/model';
import {resolveTask} from '../../src/lib/tasks/model';
import {taskPlanSchema} from '../../src/lib/tasks/chat-plan';
vi.mock('server-only',()=>({}));
import {taskChat,loadTaskContext} from '../../src/lib/tasks/chat';
import {taskCommand,reviewTaskReminder} from '../../src/lib/tasks/service';
import {buildInput} from '../../src/lib/ai/context';
const owner=crypto.randomUUID(),conversation=crypto.randomUUID(),id=crypto.randomUUID();
const task={...resolveTask({title:'Finish assignment',notes:'Private notes never sent to model',due:{kind:'none'}}),id,owner_id:owner,state:'open',version:3} as Task;
const eq=vi.fn().mockReturnThis(),rpc=vi.fn(),from=vi.fn();
function db(){return {rpc,from} as unknown as SupabaseClient<Database>;}
const candidate=task as TaskCandidate;
const base={client:db(),owner,request:crypto.randomUUID(),text:'Mark assignment task complete',context:{candidates:[candidate],more:false,focus:id},conversation,timezone:'Asia/Kolkata',channel:'mock' as const};
const plan=(operation:string,extra={})=>taskPlanSchema.parse({operation,reference:'assignment',title:null,notes:null,deadline:null,reminder:null,...extra});
beforeEach(()=>{vi.clearAllMocks();eq.mockReturnThis();from.mockImplementation((table:string)=>{const chain={eq:vi.fn().mockImplementation((...args:unknown[])=>{eq(...args);return chain;}),maybeSingle:async()=>({data:table==='task_operations'?null:task,error:null})};return {select:()=>chain};});rpc.mockResolvedValue({data:{task,operation:{id:'operation-fixture'}},error:null});});
it('model completion and deletion generate only an exact pending review under the verified owner',async()=>{
 for(const operation of ['complete','delete']){const text=await taskChat({...base,plan:plan(operation)});expect(text).toContain('Pending');expect(text).toContain('not a confirmed task change');}
 expect(eq).toHaveBeenCalledWith('owner_id',owner);expect(eq).toHaveBeenCalledWith('id',id);
 expect(rpc.mock.calls.every(([name,args])=>name==='privacy_action_v1'&&args.p_kind==='task'&&args.p_action==='review')).toBe(true);
 expect(rpc.mock.calls[0][1].p_data).toEqual({id,version:3,values:null,review_action:'complete',conversation_id:conversation});
});
it('ambiguous references, truncated candidate sets and weekday dates mutate nothing',async()=>{
 for(const context of [{...base.context,candidates:[candidate,{...candidate,id:crypto.randomUUID()}]}, {...base.context,more:true}])expect(await taskChat({...base,context,plan:plan('complete')})).toContain('Several tasks');
 expect(await taskChat({...base,text:'Make it due Friday',plan:plan('edit')})).toContain('Which calendar date');expect(rpc).not.toHaveBeenCalled();
});
it('revalidates the selected owned task version before producing a review',async()=>{
 expect(await taskChat({...base,context:{...base.context,candidates:[{...candidate,version:2}]},plan:plan('complete')})).toContain('task changed');expect(rpc).not.toHaveBeenCalled();
});
it('task create and edit proposals never schedule notifications or copy existing notes into context',async()=>{
 await taskChat({...base,text:'Add a task',plan:plan('create',{title:'Synthetic new task',reference:null})});
 expect(rpc).toHaveBeenCalledWith('privacy_action_v1',expect.objectContaining({p_kind:'task',p_action:'review',p_request:base.request,p_data:expect.objectContaining({review_action:'create',values:expect.objectContaining({due_kind:'none'})})}));
 const context=buildInput({text:'Find my assignment task',assistantName:'Jarvis',timezone:'UTC',tone:'balanced',now:'2026-10-31T00:00:00Z',allowMemory:true,memories:[],history:[],tasks:[candidate]});
 expect(JSON.stringify(context)).not.toContain('Private notes');
 const temporary=buildInput({text:'it',assistantName:'Jarvis',timezone:'UTC',tone:'balanced',now:'2026-10-31T00:00:00Z',allowMemory:false,memories:[],history:[],tasks:[candidate]});expect(JSON.stringify(temporary)).not.toContain('Finish assignment');
});
it('overdue queries use bounded authoritative storage rather than the model inventing overdue state',async()=>{
 rpc.mockResolvedValue({data:{candidates:[candidate],more:true},error:null});expect(await taskChat({...base,plan:plan('list_overdue')})).toContain('bounded list');expect(rpc).toHaveBeenCalledWith('task_context_v1',{p_overdue:true});expect(from).not.toHaveBeenCalled();
});
it('missing live channel cannot silently choose mock or schedule through a different account',async()=>{
 expect(await taskChat({...base,channel:null,plan:plan('remind')})).toContain('No live reminder draft');expect(rpc).not.toHaveBeenCalled();
});
it('task reminder review forces generic content and keeps the explicit selected channel, with no confirmation',async()=>{
 await reviewTaskReminder(db(),base.request,id,3,{title:'Must not be retained',timezone:'UTC',local_datetime:new Date(Date.now()+3600000).toISOString().slice(0,19)},'mock');
 expect(rpc).toHaveBeenCalledWith('task_command_v1',expect.objectContaining({p_action:'review_reminder',p_data:expect.objectContaining({id,version:3,schedule:expect.objectContaining({title:'Task reminder',channel:'mock'})})}));expect(JSON.stringify(rpc.mock.calls)).not.toContain('Must not be retained');
});
it.each([['42501',404],['40001',409],['23505',409],['54000',429],['22023',422],['23514',422]])('sanitizes database %s without leaking row, token or provider errors',async(code,status)=>{
 rpc.mockResolvedValue({data:null,error:{code,message:'SECRET fixture'}});await expect(taskCommand(db(),'complete',base.request,{id,version:3})).rejects.toMatchObject({status});
});
it('context lookup scopes conversation focus to verified owner and bounds the candidate list',async()=>{
 rpc.mockResolvedValue({data:{candidates:Array.from({length:9},()=>candidate),more:true},error:null});const result=await loadTaskContext(db(),owner,'assignment',conversation);expect(result.candidates).toHaveLength(8);expect(result.more).toBe(true);expect(eq).toHaveBeenCalledWith('owner_id',owner);expect(rpc).toHaveBeenCalledWith('task_context_v1',expect.objectContaining({p_query:'assignment'}));
});

it('an interrupted turn recovers its prior domain receipt before rebuilding changed version arguments',async()=>{from.mockReturnValue({select:()=>({eq:vi.fn().mockReturnThis(),maybeSingle:async()=>({data:{id:'prior-operation',kind:'review_reminder',task_ref:id,result:{}},error:null})})});expect(await taskChat({...base,plan:plan('remind')})).toContain('this retry created no new');expect(rpc).not.toHaveBeenCalled();});
