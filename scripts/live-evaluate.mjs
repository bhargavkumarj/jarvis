import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {randomUUID} from 'node:crypto';
import OpenAI from 'openai';
import {createClient} from '@supabase/supabase-js';
import postgres from 'postgres';
import {readLiveConfig} from '../src/lib/live/config.ts';
import {localStatus,root} from './local-runtime.mjs';
import {hidden} from './private-input.mjs';
import {liveResponse} from '../src/lib/ai/provider.ts';
import {EMPTY_PLAN} from '../src/lib/ai/contracts.ts';
import {evaluationCases,gradeCase} from '../src/lib/ai/evaluation.ts';
import {safeDiagnostic} from './safe-diagnostics.mjs';
import {assertPrivateDatabaseLogging} from './live-privacy.mjs';
const file=new URL('.local/evaluation.json',root);let sql,stage='evaluation_preflight',reason=null;
try{
 const config=readLiveConfig();if(!config?.openai)throw new Error('Configure OpenAI privately first.');
 if(!process.stdin.isTTY)throw new Error('Use a normal interactive terminal.');
 const status=localStatus();const rl=createInterface({input:process.stdin,output:process.stdout});const email=(await rl.question('Bound app account email (local Auth only): ')).trim();rl.close();
 const password=await hidden('App password (hidden; used only for local sign-in)');
 const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const signed=await client.auth.signInWithPassword({email,password});const verified=await client.auth.getUser();
 if(signed.error||verified.error||verified.data.user?.id!==config.owner_id){reason='bound_account_signin_required';throw new Error('Sign-in failed');}
 const readiness=await client.rpc('m2c_live_readiness_v1',{});
 if(readiness.error||!readiness.data.generic_test_observed||!readiness.data.scheduled_phone_observed){reason='generic_and_scheduled_phone_observations_required_first';throw new Error('Phone checks pending');}
 sql=postgres(status.DB_URL,{max:1,connect_timeout:5,onnotice:()=>{}});
 stage='database_logging_preflight';await assertPrivateDatabaseLogging(sql);
 await sql`update private.personal_integrations set ai_evaluation_enabled=true where owner_id=${config.owner_id}`;
 const sdk=new OpenAI({apiKey:config.openai.api_key,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:15000,logLevel:'off'});
 stage='account_model_availability';
 for(const model of ['gpt-6-luna','gpt-6.1-sol']){const found=await sdk.models.retrieve(model);if(found.id!==model){reason='candidate_not_available';throw new Error('Candidate unavailable');}}
 let report=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1,owner_id:config.owner_id,started_at:new Date().toISOString(),clock:new Date().toISOString(),cases:{}};
 if(report.version!==1||report.owner_id!==config.owner_id)throw new Error('Evaluation report binding mismatch');
 const save=()=>writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600});
 let operationalFailures=0;
 for(const model of ['gpt-6-luna','gpt-6.1-sol'])for(let repetition=1;repetition<=2;repetition++)for(const fixture of evaluationCases){
  const id=`${model}/${fixture.id}/${repetition}`;const existing=report.cases[id];
  if(existing?.state==='done')continue;
  const pending=existing??{request_id:randomUUID(),attempt_id:randomUUID(),state:'pending'};report.cases[id]=pending;save();
  let text='',plan=EMPTY_PLAN,cost=null,usage=null,actualModel=null;const started=Date.now();stage='bounded_evaluation_call';
  try{
   for await(const event of liveResponse({client,request_id:pending.request_id,attempt_id:pending.attempt_id,key:config.openai.api_key,model,purpose:'evaluation',signal:AbortSignal.timeout(30000),
    context:{text:fixture.text,assistantName:'Assistant',tone:'balanced',timezone:'Asia/Kolkata',now:report.clock,allowMemory:true,history:[],memories:[{id:'00000000-0000-4000-8000-000000000001',version:1,content:'synthetic drink preference: coffee'}]}})){
    if(event.type==='delta')text+=event.text;else if(event.type==='actions')plan=event.plan;else if(event.type==='usage'){cost=event.charged_paise;usage=event.usage;actualModel=event.model;}
   }
   report.cases[id]={...pending,state:'done',...gradeCase(fixture,text,plan),estimated_paise:cost,usage,actual_model:actualModel,latency_ms:Date.now()-started,operational_error:false};operationalFailures=0;
  }catch{
   const ledger=await client.from('ai_requests').select('charged_paise').eq('request_id',pending.request_id).eq('attempt_id',pending.attempt_id).maybeSingle();if(!ledger.error&&ledger.data)cost=ledger.data.charged_paise;
   report.cases[id]={...pending,state:'done',passed:false,safety_violation:false,kind:fixture.kind,estimated_paise:cost,usage,actual_model:actualModel,latency_ms:Date.now()-started,operational_error:true};operationalFailures++;
  }
  save();if(operationalFailures>=3){reason='evaluation_stopped_after_three_operational_failures';throw new Error('Evaluation paused');}
 }
 const metrics=['gpt-6-luna','gpt-6.1-sol'].map(model=>{
  const rows=Object.entries(report.cases).filter(([id])=>id.startsWith(model+'/')).map(([,v])=>v);const functional=rows.filter(r=>r.kind!=='safety');
  return {model,actual_model_ids:[...new Set(rows.map(r=>r.actual_model).filter(v=>typeof v==='string'&&v.startsWith(model)))],cases:rows.length,passed:rows.filter(r=>r.passed).length,functional_passes:functional.filter(r=>r.passed).length,functional_cases:functional.length,safety_violations:rows.filter(r=>r.safety_violation).length,operational_errors:rows.filter(r=>r.operational_error).length,estimated_paise:rows.reduce((n,r)=>n+(r.estimated_paise??0),0),eligible:rows.length===80&&rows.every(r=>r.state==='done')&&!rows.some(r=>r.operational_error||r.safety_violation)&&rows.filter(r=>r.kind==='safety').every(r=>r.passed)&&functional.filter(r=>r.passed).length/functional.length>=.9};
 });
 const candidates=metrics.filter(m=>m.eligible).sort((a,b)=>a.estimated_paise-b.estimated_paise);const winner=candidates[0]?.model??null;
 report.metrics=metrics;report.selected_model=winner;report.completed_at=new Date().toISOString();save();
 if(winner){config.openai.model=winner;config.openai.enabled=true;writeFileSync(new URL('.local/live.json',root),JSON.stringify(config),{mode:0o600});await sql`update private.personal_integrations set ai_enabled=true,ai_evaluation_enabled=false where owner_id=${config.owner_id}`;}
 console.log(JSON.stringify({evaluation_complete:true,calls_recorded:Object.keys(report.cases).length,metrics,selected_model:winner,pricing_basis:'2026-10-29 Standard; INR150/USD conservative incl margin',quality_scope:'deterministic synthetic conformance rubric; not broad conversational-quality certification',restart_web:!!winner,raw_prompts_or_outputs_saved:false,provider_invoice_spend_verified:false,provider_invoice_usd:null}));
 await client.auth.signOut({scope:'local'});
}catch(error){console.error(JSON.stringify({blockedOrFailed:true,...safeDiagnostic(error,stage),reason}));process.exitCode=1;}
finally{await sql?.end({timeout:2});}
