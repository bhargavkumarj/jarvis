import { mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { randomBytes,pbkdf2Sync,createHmac,createHash } from 'node:crypto';
import postgres from 'postgres';
import { PgBoss } from 'pg-boss';
import { root,localStatus } from './local-runtime.mjs';
import { readWorkerConfig } from './worker-config.mjs';
import { safeDiagnostic } from './safe-diagnostics.mjs';
let sql,boss;
try {
 const status=localStatus();
 sql=postgres(status.DB_URL,{max:1,onnotice:()=>{},connect_timeout:5});
 const [{ready}]=await sql`select exists(select 1 from supabase_migrations.schema_migrations where version='202610290003') as ready`;
 if(!ready) throw new Error('Apply the M2B migrations before worker setup.');
 let connection;
 if(existsSync(new URL('.local/worker.json',root))) connection=readWorkerConfig();
 else {
  const password=randomBytes(32).toString('base64url');
  const salt=randomBytes(16),salted=pbkdf2Sync(password,salt,4096,32,'sha256');
  const client=createHmac('sha256',salted).update('Client Key').digest();
  const stored=createHash('sha256').update(client).digest('base64');
  const server=createHmac('sha256',salted).update('Server Key').digest('base64');
  const verifier=`SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
  // Only a generated SCRAM verifier enters the DDL; never log SQL or raw errors.
  await sql.unsafe(`alter role jarvis_reminder_worker password '${verifier}'`);
  const u=new URL(status.DB_URL);u.username='jarvis_reminder_worker';u.password=password;connection=u.toString();
  mkdirSync(new URL('.local/',root),{recursive:true,mode:0o700});
  writeFileSync(new URL('.local/worker.json',root),JSON.stringify({connection}),{mode:0o600,flag:'wx'});
 }
 boss=new PgBoss({connectionString:status.DB_URL,schema:'jarvis_jobs',migrate:false,createSchema:false,schedule:false,supervise:false,registerInstance:false});
 boss.on('error',()=>{});await boss.start();
 await boss.createQueue('reminders_v1',{policy:'standard',partition:false,retryLimit:2,retryDelay:10,retryBackoff:true,retryDelayMax:30,expireInSeconds:30,retentionSeconds:367*86400,deleteAfterSeconds:86400});
 const check=postgres(connection,{max:1,onnotice:()=>{},connect_timeout:5});
 try {
  const [r]=await check`select current_user as name,has_schema_privilege(current_user,'jarvis_jobs','CREATE') as can_create,has_table_privilege(current_user,'public.profiles','SELECT') as profiles`;
  if(r.name!=='jarvis_reminder_worker'||r.can_create||r.profiles) throw new Error('Unexpected worker privileges.');
  await check`select private.m2b_worker_v1('recover','{}',null)`;
 } finally {await check.end({timeout:2});}
 console.log('Local mock worker configured with a restricted runtime principal. No web credentials changed; no live notification provider enabled.');
}catch(error){console.error(JSON.stringify({blockedOrFailed:true,...safeDiagnostic(error,'local_worker_setup')}));process.exitCode=1;}
finally {await boss?.stop({graceful:true,timeout:3000}).catch(()=>{});await sql?.end({timeout:2});}
