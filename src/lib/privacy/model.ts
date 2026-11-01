import {z} from 'zod';
export const RETENTION_DAYS=[7,30,90,365] as const;
export const CONFIRMATIONS={history:'DELETE HISTORY',memories:'DELETE MEMORIES',tasks_reminders:'DELETE TASKS AND REMINDERS',account:'DELETE MY ACCOUNT'} as const;
export type Scope=keyof typeof CONFIRMATIONS;
export type PrivacyPreferences={owner_id:string;text_cloud:boolean;notifications:boolean;retention_days:number;epoch:number;version:number;updated_at:string};
export type PrivacyJob={id:string;scope:Scope;state:'queued'|'running'|'waiting_external'|'failed'|'complete';phase:string;counts:Record<string,number>;last_code:string|null;created_at:string;updated_at:string;completed_at:string|null};
export type PrivacyStatus={preferences:PrivacyPreferences;recent_authentication:boolean;jobs:PrivacyJob[];voice:{cloud_transcription:boolean;consent_version:string|null}|null};
const base={request_id:z.uuid()};
export const privacyCommand=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('consent'),...base,version:z.number().int().positive(),text_cloud:z.boolean(),notifications:z.boolean()}),
 z.strictObject({action:z.literal('retention'),...base,version:z.number().int().positive(),days:z.union([z.literal(7),z.literal(30),z.literal(90),z.literal(365)]),confirm_shorter:z.boolean()}),
 z.strictObject({action:z.literal('retry'),...base,id:z.uuid()}),
 z.strictObject({action:z.literal('delete'),...base,scope:z.enum(['history','memories','tasks_reminders','account']),confirmation:z.string().max(40)}),
]);
export function validConfirmation(scope:Scope,text:string){return CONFIRMATIONS[scope]===text;}
export function recentPassword(claims:unknown,now=Date.now()){
 if(!claims||typeof claims!=='object'||!('amr' in claims)||!Array.isArray(claims.amr))return false;
 return claims.amr.some((a:unknown)=>{if(!a||typeof a!=='object'||!('method' in a)||a.method!=='password'||!('timestamp' in a)||typeof a.timestamp!=='number'||!Number.isFinite(a.timestamp))return false;return a.timestamp*1000>=now-300000&&a.timestamp*1000<=now+30000;});
}
export function retentionExpiry(created:string,days:number){if(!RETENTION_DAYS.includes(days as 7))throw new Error('Unsupported retention');return new Date(Date.parse(created)+days*86400000).toISOString();}
export function retentionChange(oldExpiry:string,created:string,days:number,now=Date.now()){return Date.parse(oldExpiry)<=now?oldExpiry:retentionExpiry(created,days);}
export function forgetGuidance(text:string){return /^(?:please\s+)?(?:forget\b|delete (?:this|that|my) (?:memory|information)\b)/i.test(text.trim())?'What should be removed: a saved memory, its source conversation, or both? Nothing has been deleted. Use Memory to review the exact saved note and Delete, or Settings → Privacy Center for a confirmed bulk action. Deleting a memory does not erase retained source text; the assistant may still infer it from that text. Delete the relevant conversation as well if you want that source removed. Account deletion is available only through Settings with recent password authentication.':null;}
export function jobMessage(job:PrivacyJob){if(job.state==='complete')return 'Application cleanup complete. Provider copies, downloaded exports, logs and backups are separate boundaries.';if(job.state==='waiting_external')return 'Application access is blocked. Local credential removal and Auth identity deletion are pending in the isolated privacy finalizer.';if(job.state==='failed')return 'Deletion is incomplete. Access restrictions remain; retry is safe and preserves completed work.';return 'Deletion is pending. New content actions are temporarily blocked; an already authorized provider request cannot be recalled.';}
