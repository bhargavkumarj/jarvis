// Node-only shared reader for the web server, local CLI and worker. Never import
// this module into a client component. Status responses contain booleans only.
import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const key=z.string().regex(/^[A-Za-z0-9]{30}$/);
export const liveConfigSchema=z.strictObject({
 version:z.literal(1),owner_id:z.uuid(),
 pushover:z.strictObject({token:key,user:key,device:z.string().regex(/^[A-Za-z0-9_-]{1,25}$/)}).optional(),
 openai:z.strictObject({api_key:z.string().min(20).max(512),model:z.enum(['gpt-6-luna','gpt-6.1-sol']).nullable(),enabled:z.boolean().default(false),transcription_enabled:z.boolean().optional()}).optional(),
});
export type LiveConfig=z.infer<typeof liveConfigSchema>;
export function liveDisabled(){return process.env.JARVIS_MOCK_ONLY==='1';}
export function readLiveConfig():LiveConfig|null{
 if(liveDisabled())return null;
 const file=resolve(process.cwd(),'.local/live.json');if(!existsSync(file))return null;
 try{
  if((statSync(file).mode&0o077)!==0)throw new Error('permissions');
  return liveConfigSchema.parse(JSON.parse(readFileSync(file,'utf8')));
 }catch{throw new Error('Private live configuration is invalid or not mode 0600. Review it locally; never print its values.');}
}
export function pushBinding(config:LiveConfig):string|null{
 return config.pushover?createHash('sha256').update(JSON.stringify({owner:config.owner_id,pushover:config.pushover})).digest('hex'):null;
}
export function maskedLiveStatus(config:LiveConfig|null){return {personal_account_bound:!!config,pushover_configured:!!config?.pushover,openai_configured:!!config?.openai,model_selected:!!config?.openai?.model,openai_enabled:!!config?.openai?.enabled,transcription_configured:!!config?.openai?.transcription_enabled};}
