// Local operator invitation only. Does NOT create/confirm Auth users or sessions.
import {createInterface} from 'node:readline/promises';
import postgres from 'postgres';
import {localStatus} from './local-runtime.mjs';
import {safeDiagnostic} from './safe-diagnostics.mjs';
let sql;
try{
 if(!process.stdin.isTTY)throw new Error('Use a normal interactive terminal.');
 const {DB_URL}=localStatus();sql=postgres(DB_URL,{max:1,connect_timeout:5,onnotice:()=>{}});
 const rl=createInterface({input:process.stdin,output:process.stdout});const email=(await rl.question('Personal account email to admit locally: ')).trim().toLowerCase();rl.close();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('Use a valid email locally.');
 const existing=await sql`select enabled from private.admissions where email=${email}`;
 if(existing.length&&!existing[0].enabled)throw new Error('Admission is disabled; investigate before enabling it.');
 await sql`insert into private.admissions(email) values(${email}) on conflict(email) do nothing`;
 const [status]=await sql`select exists(select 1 from auth.users where email=${email}) registered,exists(select 1 from auth.users where email=${email} and email_confirmed_at is not null) verified`;
 console.log(JSON.stringify({locally_admitted:true,registered:status.registered,verified:status.verified,next:!status.registered?'Register this same address at http://127.0.0.1:3000/register; verify using local Mailpit http://127.0.0.1:54324':!status.verified?'Request a fresh verification code for this same address; use local Mailpit':'Retry live:configure pushover for this admitted account',notification_sent:false}));
}catch(error){console.error(JSON.stringify({blockedOrFailed:true,...safeDiagnostic(error,'local_personal_admission')}));process.exitCode=1;}
finally{await sql?.end({timeout:2});}
