import postgres from 'postgres';
import {localStatus} from './local-runtime.mjs';
import {readLiveConfig,pushBinding} from '../src/lib/live/config.ts';
import {startWorker} from '../src/worker/runtime.ts';
import {readWorkerConfig} from './worker-config.mjs';
import {safeDiagnostic} from './safe-diagnostics.mjs';
let sql,worker;let operation='generic_pushover_preflight';
try{
 if(process.argv.slice(2).some(arg=>arg!=='--check')||process.argv.slice(2).length>1)throw new Error('Use no arguments, or --check for a read-only diagnostic.');
 const config=readLiveConfig();if(!config?.pushover)throw new Error('Configure Pushover locally first.');
 operation='generic_pushover_local_runtime';
 const status=localStatus();sql=postgres(status.DB_URL,{max:1,connect_timeout:5,onnotice:()=>{}});
 if(process.argv.includes('--check')){
  operation='generic_pushover_privilege_diagnostic';
  const diagnostic=await sql.begin('read only',async tx=>{
  const [access]=await tx`select current_user as operator_role,
   has_schema_privilege(current_user,'private','USAGE') as operator_schema_usage,
   has_function_privilege(current_user,'private.m2c_channel_test_v1(uuid)','EXECUTE') as operator_can_create_test,
   has_function_privilege('authenticated','private.m2c_channel_test_v1(uuid)','EXECUTE') as api_can_create_test,
   has_function_privilege('jarvis_reminder_worker','private.m2c_channel_test_v1(uuid)','EXECUTE') as worker_can_create_test,
   (select r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='private.m2c_channel_test_v1(uuid)'::regprocedure) as test_function_owner`;
  const [policy]=await tx`select push_binding_hash from private.personal_integrations where owner_id=${config.owner_id} and pushover_enabled`;
  const [eligible]=await tx`select private.m2b_account_eligible_v1(${config.owner_id}) as account_eligible`;
  return {read_only:true,...access,configuration_matches:policy?.push_binding_hash===pushBinding(config),account_eligible:eligible.account_eligible,notifications_sent_by_diagnostic:0};
  });
  console.log(JSON.stringify(diagnostic));
 }else{
 operation='generic_pushover_binding_lookup';
 const [binding]=await sql`select push_binding_hash from private.personal_integrations where owner_id=${config.owner_id} and pushover_enabled`;
 if(binding?.push_binding_hash!==pushBinding(config))throw new Error('Channel binding mismatch; reconfigure safely.');
 operation='generic_pushover_create_or_inspect_test';
 const [{reminder}]=await sql`select private.m2c_channel_test_v1(${config.owner_id}) reminder`;
 operation='generic_pushover_worker_start';
 worker=await startWorker(readWorkerConfig());
 operation='generic_pushover_observe_attempt';
 const deadline=Date.now()+45000;let r;
 do{[r]=await sql`select state,id from public.reminders where id=${reminder.id} and owner_id=${config.owner_id}`;if(['provider_accepted','outcome_unknown','failed','expired','cancelled'].includes(r.state))break;await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<deadline);
 const attempts=await sql`select state,started_at,finished_at,error_code from public.delivery_attempts where reminder_id=${reminder.id} and owner_id=${config.owner_id} order by ordinal`;
 console.log(JSON.stringify({generic_channel_test:r.state,reminder_id:r.id,attempts,phone_arrival:'requires_user_observation',repeating_command:'inspects_same_test_does_not_create_another'}));
 }
}catch(error){console.error(JSON.stringify({blockedOrFailed:true,...safeDiagnostic(error,operation)}));process.exitCode=1;}
finally{await worker?.stop().catch(()=>{});await sql?.end({timeout:2});}
