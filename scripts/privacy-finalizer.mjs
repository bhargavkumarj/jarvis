// Explicit isolated local operator process. No owner IDs, URLs or credentials in CLI args.
import postgres from 'postgres';
import {createClient} from '@supabase/supabase-js';
import {localStatus} from './local-runtime.mjs';
import {safeDiagnostic} from './safe-diagnostics.mjs';
import {finalizeAccount,removeBoundCredentials} from '../src/lib/privacy/finalize.ts';
let sql;let stopped=false;
try{
 const args=process.argv.slice(2);let retry=null;
 if(args[0]==='--retry'){retry=args[1];if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(retry??''))throw new Error('A deletion job UUID is required');args.splice(0,2);}
 if(args.some(x=>x!=='--once')||args.length>1)throw new Error('Use --once, or --retry JOB_UUID with optional --once');
 const status=localStatus();sql=postgres(status.DB_URL,{max:1,connect_timeout:5,onnotice:()=>{}});
 const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)})}});
 const rpc=async(action,job=null,code=null)=>{const [r]=await sql`select private.privacy_finalize_v1(${action},${job?.id??null},${job?.lease??null},${code}) value`;return r.value;};
 if(retry)await rpc('retry',{id:retry});
 process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
 do{
  const job=await rpc('claim',retry?{id:retry}:null);
  if(job){const result=await finalizeAccount(job,{prepare:j=>rpc('prepare',j),credentials:owner=>removeBoundCredentials(owner),deleteIdentity:owner=>admin.auth.admin.deleteUser(owner,false),complete:j=>rpc('complete',j),fail:(j,code)=>rpc('failed',j,code)});console.log(JSON.stringify({operation:'account_deletion_finalizer',job_id:job.id,complete:result.complete}));}
  if(process.argv.includes('--once'))break;
  for(let i=0;i<5&&!stopped;i++)await new Promise(r=>setTimeout(r,1000));
 }while(!stopped);
}catch(error){console.error(JSON.stringify({blockedOrFailed:true,...safeDiagnostic(error,'privacy_finalizer')}));process.exitCode=1;}
finally{await sql?.end({timeout:2});}
