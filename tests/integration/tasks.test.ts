// Written—not executed: real local Auth/Data API/Postgres is deliberately deferred.
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {localFixtures} from '../support/local-fixtures';
import type {Database} from '../../src/lib/database.types';
import type {Json} from '../../src/lib/database.generated';
import {resolveTask,type TaskReceipt,type Task} from '../../src/lib/tasks/model';
import {resolveSchedule} from '../../src/lib/reminders/time';
import {snapshot} from '../../src/lib/reminders/types';
let f:Awaited<ReturnType<typeof localFixtures>>,a:SupabaseClient<Database>,b:SupabaseClient<Database>,oa:string,ob:string;
function good(r:{data:unknown;error:{code:string}|null}){if(r.error)throw new Error(`Task fixture SQLSTATE ${r.error.code}`);return r.data as TaskReceipt;}
async function command(action:string,data:Record<string,unknown>,client=a,key=crypto.randomUUID()){return good(await client.rpc('task_command_v1',{p_action:action,p_request:key,p_data:data as Json}));}
const values=()=>resolveTask({title:'Synthetic assignment',notes:'Synthetic private task notes',due:{kind:'none'}});
async function create(client=a){return (await command('save',{values:values()},client)).task!;}
async function attach(t:Task){const schedule=resolveSchedule({title:'Must not copy this content',local_datetime:new Date(Date.now()+3600000).toISOString().slice(0,19),timezone:'UTC'});const reviewed=await command('review_reminder',{id:t.id,version:t.version,schedule});return command('confirm_reminder',{id:t.id,version:reviewed.task!.version,reminder_snapshot:snapshot(reviewed.reminder!),reminder_review:reviewed.task!.reminder_review});}
beforeAll(async()=>{f=await localFixtures();const auth={persistSession:false,autoRefreshToken:false};a=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});b=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});const aa=await a.auth.signInWithPassword(f.users.alex),bb=await b.auth.signInWithPassword(f.users.sam);if(!aa.data.user||!bb.data.user)throw new Error('Synthetic sign-in failed');oa=aa.data.user.id;ob=bb.data.user.id;});
beforeEach(async()=>{for(const table of ['task_operations','reminder_operations'])await f.sql.unsafe(`update public.${table} set created_at=now()-interval '2 minutes' where owner_id=$1 or owner_id=$2`,[oa,ob]);});
afterAll(async()=>{await f?.close();});
it('A/B and anonymous reads, direct writes and forged task/operation owners are denied',async()=>{
 const ta=await create(),tb=await create(b);const anon=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth:{persistSession:false}});
 for(const table of ['tasks','task_operations'] as const){expect((await b.from(table).select('*').eq('owner_id',oa)).data).toEqual([]);expect((await anon.from(table).select('*')).error).not.toBeNull();expect((await a.from(table).insert({owner_id:ob})).error).not.toBeNull();expect((await a.from(table).update({owner_id:ob}).eq('owner_id',oa)).error).not.toBeNull();}
 expect((await a.from('tasks').select('id').eq('id',tb.id)).data).toEqual([]);
 expect((await b.rpc('task_command_v1',{p_action:'complete',p_request:crypto.randomUUID(),p_data:{id:ta.id,version:ta.version}})).error?.code).toBe('42501');
 expect((await a.rpc('task_command_v1',{p_action:'save',p_request:crypto.randomUUID(),p_data:{values:values(),owner_id:ob}})).error?.code).toBe('22023');for(const action of ['confirm','review_reminder','confirm_reminder','delete'])expect((await b.rpc('task_command_v1',{p_action:action,p_request:crypto.randomUUID(),p_data:{id:ta.id,version:ta.version,confirm_delete:true}})).error?.code).toBe('42501');expect((await a.from('tasks').select('state').eq('id',ta.id)).data?.[0].state).toBe('open');
});
it('restricts private task helpers and runtime role access without schema creation privileges',async()=>{
 const [r]=await f.sql`select has_function_privilege('authenticated','private.task_cancel_links_v1(uuid)','EXECUTE') helper,has_table_privilege('jarvis_reminder_worker','public.tasks','SELECT') worker_read,has_function_privilege('jarvis_reminder_worker','private.m2b_worker_before_tasks_v1(text,jsonb,text)','EXECUTE') bypass,has_schema_privilege('jarvis_auth_guard','public','CREATE') ddl`;
 expect(Object.values(r).some(Boolean)).toBe(false);
 const rows=await f.sql`select p.prosecdef,p.proconfig,r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid in ('public.task_command_v1(text,uuid,jsonb)'::regprocedure,'public.task_context_v1(text,boolean,uuid)'::regprocedure)`;expect(rows).toHaveLength(2);for(const r of rows){expect(r.prosecdef).toBe(true);expect(r.rolname).toBe('jarvis_auth_guard');expect(r.proconfig).toEqual(['search_path=""']);}
});
it('a model proposal needs exact content/version approval; edited reviews invalidate old confirmation',async()=>{
 const draft=await command('review',{review_action:'create',values:values()});expect(draft.task!.state).toBe('draft');
 const newer=await command('review',{id:draft.task!.id,version:draft.task!.version,review_action:'edit',values:{...values(),title:'Changed synthetic task'}});
 const stale=await a.rpc('task_command_v1',{p_action:'confirm',p_request:crypto.randomUUID(),p_data:{id:draft.task!.id,version:draft.task!.version,review_version:draft.task!.review_version,review:draft.task!.review}});expect(stale.error?.code).toBe('40001');
 const t=newer.task!;const confirmed=await command('confirm',{id:t.id,version:t.version,review_version:t.review_version,review:t.review});expect(confirmed.task!.state).toBe('open');expect(confirmed.task!.title).toBe('Changed synthetic task');
 expect((await f.sql`select count(*)::int n from private.reminder_outbox where owner_id=${oa} and reminder_id in(select id from public.reminders where task_id=${t.id})`)[0].n).toBe(0);
});
it('duplicate operations replay while changed arguments conflict; concurrent completion has one winner',async()=>{
 const key=crypto.randomUUID(),first=await command('save',{values:values()},a,key),repeat=await command('save',{values:values()},a,key);expect(repeat.operation.id).toBe(first.operation.id);expect(repeat.replay).toBe(true);
 expect((await a.rpc('task_command_v1',{p_action:'save',p_request:key,p_data:{values:{...values(),title:'Different'}}})).error?.code).toBe('40001');
 const t=first.task!;const results=await Promise.all([1,2].map(()=>a.rpc('task_command_v1',{p_action:'complete',p_request:crypto.randomUUID(),p_data:{id:t.id,version:t.version}})));expect(results.filter(r=>!r.error)).toHaveLength(1);expect(results.find(r=>r.error)?.error?.code).toBe('40001');
});
it('deadline edits do not schedule or move a reminder; task closure cancels unsent work and reopen emits no schedule',async()=>{
 const linked=await attach(await create()),t=linked.task!,r=linked.reminder!;expect(r.title).toBe('Task reminder');expect(r.state).toBe('scheduling_pending');
 const changed=await command('save',{id:t.id,version:t.version,values:resolveTask({title:t.title,notes:t.notes,due:{kind:'date',date:new Date().toISOString().slice(0,10),timezone:'Asia/Kolkata'}})});expect((await a.from('reminders').select('due_at,version').eq('id',r.id)).data?.[0]).toMatchObject({due_at:r.due_at,version:r.version});
 const done=await command('complete',{id:t.id,version:changed.task!.version});expect(done.task!.state).toBe('completed');expect((await a.from('reminders').select('state').eq('id',r.id)).data?.[0].state).toBe('cancelled');
 const before=(await f.sql`select count(*)::int n from private.reminder_outbox where reminder_id=${r.id}`)[0].n;await command('reopen',{id:t.id,version:done.task!.version});expect((await f.sql`select count(*)::int n from private.reminder_outbox where reminder_id=${r.id}`)[0].n).toBe(before);expect((await a.from('reminders').select('state').eq('id',r.id)).data?.[0].state).toBe('cancelled');
});
it('exact linked reminder confirmation rejects stale task versions and mock/live channel substitution',async()=>{
 const t=await create();const schedule=resolveSchedule({title:'Private task title',local_datetime:new Date(Date.now()+3600000).toISOString().slice(0,19),timezone:'UTC'});const review=await command('review_reminder',{id:t.id,version:t.version,schedule});
 for(const patch of [{version:t.version},{reminder_snapshot:{...snapshot(review.reminder!),channel:'pushover'}}])expect((await a.rpc('task_command_v1',{p_action:'confirm_reminder',p_request:crypto.randomUUID(),p_data:{id:t.id,version:review.task!.version,reminder_review:review.task!.reminder_review,reminder_snapshot:snapshot(review.reminder!),...patch}})).error?.code).toBe('40001');
 expect((await a.from('reminders').select('state,channel').eq('id',review.reminder!.id)).data?.[0]).toMatchObject({state:'draft',channel:'mock'});
});
it('owner-consistent foreign keys reject cross-user links even for installer fixtures',async()=>{
 const ar=await attach(await create()),tb=await create(b);let code='';try{await f.sql`update public.tasks set linked_reminder_id=${ar.reminder!.id} where id=${tb.id}`;}catch(e){code=(e as {code:string}).code;}expect(code).toBe('23503');
 code='';try{await f.sql`update public.reminders set task_id=${tb.id} where id=${ar.reminder!.id}`;}catch(e){code=(e as {code:string}).code;}expect(code).toBe('23503');
});
it('cancel/remove reminder keeps task open; physical generic-history cleanup leaves task intact',async()=>{
 let linked=await attach(await create());const r=linked.reminder!,t=linked.task!;const cancelled=await a.rpc('m2b_reminder_v1',{p_action:'cancel',p_request:crypto.randomUUID(),p_data:{id:r.id,version:r.version}});expect(cancelled.error).toBeNull();expect((await a.from('tasks').select('state').eq('id',t.id)).data?.[0].state).toBe('open');
 linked=await command('remove_reminder',{id:t.id,version:t.version});expect(linked.task!.linked_reminder_id).toBeNull();expect(linked.task!.state).toBe('open');
 // Installer physical cleanup exercises SET NULL, not user-isolation evidence.
 await f.sql`delete from public.reminders where id=${r.id}`;expect((await a.from('tasks').select('id').eq('id',t.id)).data).toHaveLength(1);
});
it('explicit delete removes task content, cancels pending work, preserves only generic history and minimal receipts',async()=>{
 const linked=await attach(await create()),t=linked.task!,r=linked.reminder!;expect((await a.rpc('task_command_v1',{p_action:'delete',p_request:crypto.randomUUID(),p_data:{id:t.id,version:t.version}})).error?.code).toBe('22023');
 const key=crypto.randomUUID();const deleted=await command('delete',{id:t.id,version:t.version,confirm_delete:true},a,key);expect(deleted.task).toBeNull();expect((await a.from('tasks').select('*').eq('id',t.id)).data).toEqual([]);
 expect((await a.from('reminders').select('title,state,task_id').eq('id',r.id)).data?.[0]).toMatchObject({title:'Task reminder',state:'cancelled',task_id:null});const ops=(await a.from('task_operations').select('*').eq('task_ref',t.id)).data;expect(JSON.stringify(ops)).not.toContain(t.title);expect(JSON.stringify(ops)).not.toContain(t.notes);expect((await command('delete',{id:t.id,version:t.version,confirm_delete:true},a,key)).replay).toBe(true);
});
it('atomic closure rolls back the task if durable cancellation cannot be persisted',async()=>{
 const linked=await attach(await create()),t=linked.task!,r=linked.reminder!;await f.sql`update public.reminders set queue_job_id=${crypto.randomUUID()} where id=${r.id}`;let code='';const token=(await a.auth.getSession()).data.session!.access_token;const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
 try{await f.sql.begin(async tx=>{await tx`alter table private.reminder_outbox add constraint task_fixture_failure check(false) not valid`;await tx`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`;await tx`select public.task_command_v1('complete',${crypto.randomUUID()},${tx.json({id:t.id,version:t.version})})`;});}catch(e){code=(e as {code:string}).code;}expect(code).toBe('23514');expect((await a.from('tasks').select('state').eq('id',t.id)).data?.[0].state).toBe('open');expect((await a.from('reminders').select('state').eq('id',r.id)).data?.[0].state).toBe('scheduling_pending');
});
it('context is bounded, owned, content-minimized; profile timezone changes do not rewrite saved deadlines',async()=>{
 const t=(await command('save',{values:resolveTask({title:'Synthetic overdue assignment',notes:'Notes must not enter retrieval',due:{kind:'date',date:'2026-01-01',timezone:'Asia/Kolkata'}})})).task!;
 const result=await a.rpc('task_context_v1',{p_query:'assignment',p_overdue:true});expect(result.error).toBeNull();expect(JSON.stringify(result.data)).not.toContain('Notes must not');expect(JSON.stringify((await b.rpc('task_context_v1',{p_query:'assignment',p_focus:t.id})).data)).not.toContain(t.id);
 await f.sql`update public.profiles set timezone='America/Los_Angeles' where owner_id=${oa}`;expect((await a.from('tasks').select('due_date,due_at,due_timezone').eq('id',t.id)).data?.[0]).toMatchObject({due_date:'2026-01-01',due_at:null,due_timezone:'Asia/Kolkata'});
});
it('disabled accounts cannot read tasks or mutate under a captured ordinary session',async()=>{
 const t=await create(b);await f.sql`update private.admissions set enabled=false where owner_id=${ob}`;try{expect((await b.from('tasks').select('*')).data).toEqual([]);expect((await b.rpc('task_command_v1',{p_action:'complete',p_request:crypto.randomUUID(),p_data:{id:t.id,version:t.version}})).error?.code).toBe('42501');}finally{await f.sql`update private.admissions set enabled=true where owner_id=${ob}`;}
});
