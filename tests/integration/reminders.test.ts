import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {localFixtures} from '../support/local-fixtures';
import type {Database} from '../../src/lib/database.types';
import type {OperationReceipt} from '../../src/lib/reminders/types';
import {resolveSchedule} from '../../src/lib/reminders/time';
import {snapshot} from '../../src/lib/reminders/types';
let f:Awaited<ReturnType<typeof localFixtures>>,a:SupabaseClient<Database>,b:SupabaseClient<Database>,ownerA:string,ownerB:string;
function good<T>(r:{data:unknown;error:{code?:string}|null}):T{if(r.error)throw new Error(`Reminder fixture command failed: ${r.error.code??'unclassified'}`);return r.data as T;}
async function review(client=a,id=crypto.randomUUID(),title='Synthetic reminder'){
 const due=new Date(Date.now()+3600_000).toISOString().slice(0,19);
 const {channel:_channel,...s}=resolveSchedule({title,local_datetime:due,timezone:'UTC'});void _channel;
 return good<OperationReceipt>(await client.rpc('m2b_reminder_v1',{p_action:'review',p_request:id,p_data:s}));
}
async function confirm(r:OperationReceipt,client=a,id=crypto.randomUUID()){
 return good<OperationReceipt>(await client.rpc('m2b_reminder_v1',{p_action:'confirm',p_request:id,p_data:{id:r.reminder.id,version:r.reminder.version,snapshot:snapshot(r.reminder)}}));
}
describe('M2B ordinary-identity Data API and real database policies',()=>{
 beforeAll(async()=>{
  f=await localFixtures();const auth={persistSession:false,autoRefreshToken:false};
  a=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});b=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});
  const aa=await a.auth.signInWithPassword(f.users.alex),bb=await b.auth.signInWithPassword(f.users.sam);
  if(!aa.data.user||!bb.data.user)throw new Error('Synthetic sign-in failed; credentials suppressed.');
  ownerA=aa.data.user.id;ownerB=bb.data.user.id;
 });
 afterAll(async()=>{await f?.close();});
 it('keeps the runtime role non-admin, queue private and worker capability unreachable from Data API',async()=>{
  const [p]=await f.sql`select rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit from pg_roles where rolname='jarvis_reminder_worker'`;
  expect(Object.values(p).some(Boolean)).toBe(false);
  const [g]=await f.sql`select has_schema_privilege('jarvis_reminder_worker','jarvis_jobs','CREATE') as ddl,has_table_privilege('jarvis_reminder_worker','auth.users','SELECT') as auth,has_table_privilege('jarvis_reminder_worker','public.profiles','SELECT') as profile,
   has_function_privilege('authenticated','private.m2b_worker_v1(text,jsonb,text)','EXECUTE') as exposed,
   has_schema_privilege('authenticated','jarvis_jobs','USAGE') as queue,
   pg_has_role('authenticated','jarvis_reminder_worker','SET') as user_can_be_worker,
   pg_has_role('jarvis_reminder_worker','jarvis_auth_guard','SET') as worker_can_be_guard,
   has_function_privilege('jarvis_reminder_worker','jarvis_jobs.create_queue(text,jsonb)','EXECUTE') as runtime_installer`;
  expect(Object.values(g).some(Boolean)).toBe(false);
  const [bridge]=await f.sql`select r.rolname as owner,p.prosecdef,p.proconfig from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='private.m2b_account_eligible_v1(uuid)'::regprocedure`;
  expect(bridge.owner).toBe('postgres');expect(bridge.prosecdef).toBe(true);expect(bridge.proconfig).toEqual(['search_path=""']);
 });
 it('A/B can review only their own reminders, with anonymous and direct-write denial',async()=>{
  const ar=await review(),br=await review(b);
  // Installer creates one isolated attempt fixture; ordinary A/B tokens prove visibility.
  await f.sql`insert into public.delivery_attempts(owner_id,reminder_id,ordinal,job_id,schedule_version,state) values(${ownerA},${ar.reminder.id},1,${crypto.randomUUID()},1,'prepared')`;
  expect((await a.from('delivery_attempts').select('id').eq('reminder_id',ar.reminder.id)).data).toHaveLength(1);
  const anon=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth:{persistSession:false}});
  for(const table of ['reminders','reminder_operations','delivery_attempts'] as const){
   expect((await anon.from(table).select('*')).error!==null).toBe(true);
   expect((await b.from(table).select('*').eq('owner_id',ownerA)).data).toEqual([]);
   expect((await a.from(table).insert({owner_id:ownerB})).error!==null).toBe(true);
   expect((await a.from(table).update({owner_id:ownerB}).eq('owner_id',ownerA)).error!==null).toBe(true);
  }
  expect((await a.from('reminders').select('id').eq('id',ar.reminder.id)).data).toHaveLength(1);
  expect((await a.from('reminders').select('id').eq('id',br.reminder.id)).data).toEqual([]);
  expect((await a.from('delivery_attempts').select('owner_id').eq('reminder_id',ar.reminder.id)).data?.[0].owner_id).toBe(ownerA);
  const token=(await a.auth.getSession()).data.session?.access_token;if(!token)throw new Error('Missing synthetic token');
  const privateRead=await fetch(`${f.status.API_URL}/rest/v1/reminder_outbox?select=id`,{headers:{apikey:f.status.ANON_KEY,Authorization:`Bearer ${token}`,'Accept-Profile':'private'}});
  expect(privateRead.ok).toBe(false);expect((await privateRead.json()).code).toBe('PGRST106');
 });
 it('forged reminder IDs cannot be confirmed, edited or cancelled; owner fields are rejected',async()=>{
  const ar=await review();
  for(const action of ['confirm','cancel','review']){
   const data=action==='review'?{...snapshot(ar.reminder),channel:undefined,id:ar.reminder.id}:{id:ar.reminder.id,version:1,snapshot:snapshot(ar.reminder)};
   expect((await b.rpc('m2b_reminder_v1',{p_action:action,p_request:crypto.randomUUID(),p_data:data})).error!==null).toBe(true);
  }
  expect((await a.rpc('m2b_reminder_v1',{p_action:'cancel',p_request:crypto.randomUUID(),p_data:{id:ar.reminder.id,version:1,owner_id:ownerB}})).error?.code).toBe('22023');
  expect((await a.from('reminders').select('state').eq('id',ar.reminder.id)).data?.[0].state).toBe('draft');
 });
 it('an unconfirmed draft has neither a queue event nor dispatch authority',async()=>{
  const r=await review();const [row]=await f.sql`select count(*)::integer as n from private.reminder_outbox where reminder_id=${r.reminder.id}`;expect(row.n).toBe(0);
  expect((await a.from('reminders').select('confirmed_at').eq('id',r.reminder.id)).data?.[0].confirmed_at).toBeNull();
 });
 it('binds confirmation to exact title, UTC instant, local zone and current draft version',async()=>{
  const r=await review();
  for(const changed of [{title:'Changed'},{due_at:new Date(Date.now()+7200_000).toISOString()},{timezone:'Asia/Kolkata'},{version:2}]){
   expect((await a.rpc('m2b_reminder_v1',{p_action:'confirm',p_request:crypto.randomUUID(),p_data:{id:r.reminder.id,version:1,snapshot:{...snapshot(r.reminder),...changed}}})).error?.code).toBe('40001');
  }
  expect((await a.from('reminders').select('state').eq('id',r.reminder.id)).data?.[0].state).toBe('draft');
 });
 it('editing a schedule invalidates old review; exact new values can be confirmed',async()=>{
  const r=await review();const {channel:_channel,version:_version,...fields}=snapshot(r.reminder);void _channel;void _version;
  const edited=good<OperationReceipt>(await a.rpc('m2b_reminder_v1',{p_action:'review',p_request:crypto.randomUUID(),p_data:{...fields,title:'Edited synthetic',id:r.reminder.id,version:1}}));
  expect(edited.reminder.version).toBe(2);
  expect((await a.rpc('m2b_reminder_v1',{p_action:'confirm',p_request:crypto.randomUUID(),p_data:{id:r.reminder.id,version:1,snapshot:snapshot(r.reminder)}})).error?.code).toBe('40001');
  expect((await confirm(edited)).reminder.state).toBe('scheduling_pending');
 });
 it('idempotent confirmation returns the same operation; argument reuse conflicts without duplication',async()=>{
  const r=await review();const key=crypto.randomUUID();const first=await confirm(r,a,key),second=await confirm(r,a,key);
  expect(second.replay).toBe(true);expect(second.operation.id).toBe(first.operation.id);
  expect((await a.rpc('m2b_reminder_v1',{p_action:'cancel',p_request:key,p_data:{id:r.reminder.id,version:1}})).error?.code).toBe('40001');
  const [counts]=await f.sql`select (select count(*)::integer from private.reminder_outbox where reminder_id=${r.reminder.id}) events,(select count(*)::integer from public.reminder_operations where reminder_id=${r.reminder.id} and kind='confirm') operations`;
  expect(counts).toMatchObject({events:1,operations:1});
 });
 it('rolls back reminder mutation and operation if outbox persistence fails',async()=>{
  // Inject a statement-local failure under installer role only, rollback restores it.
  const r=await review();let rolledBack=false;
  try{await f.sql.begin(async tx=>{
   await tx`alter table private.reminder_outbox add constraint m2b_fixture_fail check(false) not valid`;
   const session=(await a.auth.getSession()).data.session;if(!session)throw new Error('Missing synthetic session');
   // Trusted fixture SQL transaction exercises atomic rollback; NOT isolation evidence.
   const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());
   await tx`select set_config('request.jwt.claims',${JSON.stringify(claims)},true)`;
   await tx`select public.m2b_reminder_v1('confirm',${crypto.randomUUID()},${tx.json({id:r.reminder.id,version:1,snapshot:snapshot(r.reminder)})})`;
  });}catch(e){rolledBack=(e as {code?:string}).code==='23514';}
  expect(rolledBack).toBe(true);
  expect((await a.from('reminders').select('state').eq('id',r.reminder.id)).data?.[0].state).toBe('draft');
  const [count]=await f.sql`select count(*)::integer n from public.reminder_operations where reminder_id=${r.reminder.id} and kind='confirm'`;expect(count.n).toBe(0);
 });
 it('rejects local/UTC mismatches and unchosen DST overlaps at the database boundary',async()=>{
  const r=await review();const {channel:_channel,version:_version,...fields}=snapshot(r.reminder);void _channel;void _version;
  expect((await a.rpc('m2b_reminder_v1',{p_action:'review',p_request:crypto.randomUUID(),p_data:{...fields,timezone:'Asia/Kolkata'}})).error?.code).toBe('22023');
  // A fixed future DST fixture (inside the configured 365-day horizon).
  const year=new Date().getUTCFullYear()+1;let overlap:string|null=null;
  // Next New York November overlap; if outside horizon use March gap counterpart.
  for(let day=1;day<=7;day++){if(new Date(Date.UTC(year,10,day)).getUTCDay()===0)overlap=`${year}-11-${String(day).padStart(2,'0')}T01:30:00`;}
  // DB validation checks ambiguity before horizon, so this remains deterministic.
  const resolved=resolveSchedule({title:'DST fixture',local_datetime:overlap!,timezone:'America/New_York',disambiguation:'earlier'},Date.parse(`${year}-01-01T00:00:00Z`));
  expect((await a.rpc('m2b_reminder_v1',{p_action:'review',p_request:crypto.randomUUID(),p_data:{title:resolved.title,local_datetime:resolved.local_datetime,timezone:resolved.timezone,due_at:resolved.due_at,resolution:'unique'}})).error?.code).toBe('22023');
 });
 it('cancel is durable, idempotent, visible only to its owner and prevents unsent work',async()=>{
  const r=await confirm(await review(b),b);const key=crypto.randomUUID();const data={id:r.reminder.id,version:r.reminder.version};
  const cancelled=good<OperationReceipt>(await b.rpc('m2b_reminder_v1',{p_action:'cancel',p_request:key,p_data:data}));expect(cancelled.reminder.state).toBe('cancelled');
  const repeat=good<OperationReceipt>(await b.rpc('m2b_reminder_v1',{p_action:'cancel',p_request:key,p_data:data}));expect(repeat.operation.id).toBe(cancelled.operation.id);
  expect((await a.from('reminder_operations').select('*').eq('id',cancelled.operation.id)).data).toEqual([]);
 });
 it('ownership consistency is enforced even for installer fixture writes',async()=>{
  const ar=await review();let code='';try{await f.sql`insert into public.delivery_attempts(owner_id,reminder_id,ordinal,job_id,schedule_version,state) values(${ownerB},${ar.reminder.id},1,${crypto.randomUUID()},1,'prepared')`;}catch(e){code=(e as {code:string}).code;}expect(code).toBe('23503');
 });
 it('disabled admission denies reminder commands and reads under a previously issued ordinary token',async()=>{
  await f.sql`update private.admissions set enabled=false where owner_id=${ownerB}`;
  try{expect((await b.from('reminders').select('*')).data).toEqual([]);expect((await b.rpc('m2b_reminder_v1',{p_action:'cancel',p_request:crypto.randomUUID(),p_data:{id:crypto.randomUUID(),version:1}})).error?.code).toBe('42501');}
  finally{await f.sql`update private.admissions set enabled=true where owner_id=${ownerB}`;}
 });
});
