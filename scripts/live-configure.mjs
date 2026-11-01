import {hidden} from './private-input.mjs';
import {mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import postgres from 'postgres';
import {localStatus,root} from './local-runtime.mjs';
import {readLiveConfig,liveConfigSchema,pushBinding,maskedLiveStatus} from '../src/lib/live/config.ts';
import {validatePushover} from '../src/worker/pushover.ts';
import {safeDiagnostic} from './safe-diagnostics.mjs';
let sql,temp;let reason=null;let stage="local_live_config";
try{
 const command=process.argv[2];if(!['pushover','openai','transcription','status'].includes(command))throw new Error('Choose pushover, openai, transcription or status.');
 const existing=readLiveConfig();if(command==='status'){console.log(JSON.stringify(maskedLiveStatus(existing)));}
 else{
  if(!process.stdin.isTTY)throw new Error('Use your normal terminal. No credentials are accepted in command-line arguments.');
  stage='local_runtime';const status=localStatus();sql=postgres(status.DB_URL,{max:1,connect_timeout:5,onnotice:()=>{}});
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const email=(await rl.question('Existing admitted account email (local lookup only): ')).trim().toLowerCase();rl.close();
  stage='account_lookup';const owners=await sql`select p.owner_id from public.profiles p join private.admissions a on a.owner_id=p.owner_id join auth.users u on u.id=p.owner_id where a.email=${email} and a.enabled and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())`;
  if(owners.length!==1){reason='account_not_admitted_confirmed_and_profiled';throw new Error('Local account prerequisites missing');}
  if(existing&&existing.owner_id!==owners[0].owner_id){reason='different_account_already_bound';throw new Error('Account binding mismatch');}
  stage='credential_entry';
  const config=existing??{version:1,owner_id:owners[0].owner_id};
  if(command==='pushover'){
   const token=await hidden('Pushover application token (hidden)'),user=await hidden('Pushover user key (hidden)'),device=await hidden('Exact Android device name (hidden)');
   config.pushover={token,user,device};liveConfigSchema.parse(config);
   stage='pushover_device_validation';if(!await validatePushover(config.pushover)){reason='device_or_keys_not_validated';throw new Error('Pushover validation failed');}
  }else if(command==='transcription'){
   if(!config.openai)throw new Error('Configure the project OpenAI key locally first.');
   config.openai.transcription_enabled=true;
  }else{
   config.openai={api_key:await hidden('OpenAI project API key (hidden)'),model:existing?.openai?.model??null,enabled:false,transcription_enabled:false};liveConfigSchema.parse(config);
  }
  // The singleton policy prevents synthetic accounts from inheriting the phone/key.
  // Credentials stay only in the local file; DB stores no provider credential.
  const current=await sql`select owner_id,push_binding_hash from private.personal_integrations where singleton`;
  if(current.length&&current[0].owner_id!==config.owner_id)throw new Error('Database binding differs; stop and inspect locally. No automatic rebinding.');
  const hash=pushBinding(config);
  // Stage privately before touching policy. If publication fails after the DB
  // update, the binding check fails closed; never print either configuration.
  mkdirSync(new URL('.local/',root),{recursive:true,mode:0o700});
  temp=new URL(`.local/live-${randomUUID()}.pending`,root);
  writeFileSync(temp,JSON.stringify(config),{mode:0o600,flag:'wx'});
  await sql`insert into private.personal_integrations(owner_id,pushover_enabled,ai_enabled,push_binding_hash,transcription_enabled) values(${config.owner_id},${!!config.pushover},false,${hash},${!!config.openai?.transcription_enabled})
   on conflict(singleton) do update set pushover_enabled=excluded.pushover_enabled,push_binding_hash=excluded.push_binding_hash,
    channel_version=case when private.personal_integrations.push_binding_hash is distinct from excluded.push_binding_hash then gen_random_uuid() else private.personal_integrations.channel_version end,
    transcription_enabled=excluded.transcription_enabled,
    ai_enabled=case when ${command==='openai'} then false else private.personal_integrations.ai_enabled end,configured_at=now()`;
  renameSync(temp,new URL('.local/live.json',root));temp=null;
  console.log(JSON.stringify({...maskedLiveStatus(config),notifications_sent:0,openai_calls:0,restart_web_and_worker:true}));
 }
}catch(error){console.error(JSON.stringify({blockedOrFailed:true,...safeDiagnostic(error,stage),reason}));process.exitCode=1;}
finally{if(temp)try{unlinkSync(temp);}catch{/* Only this invocation's staged file. */}await sql?.end({timeout:2});}
