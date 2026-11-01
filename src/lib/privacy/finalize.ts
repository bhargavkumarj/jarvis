// Local Node finalizer only. Never import this file into web/client request paths.
import {existsSync,readFileSync,lstatSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
export type FinalizeJob={id:string;owner_id:string;lease:string};
export function removeBoundCredentials(owner:string,root=process.cwd()){
 let removed=false;for(const name of ['live.json','evaluation.json']){const file=resolve(root,'.local',name);if(!existsSync(file))continue;
 if(!lstatSync(file).isFile()||(lstatSync(file).mode&0o077)!==0)throw new Error('Private configuration permissions invalid');
 let value:unknown;try{value=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Private configuration cannot be verified');}
 if(!value||typeof value!=='object'||!('owner_id' in value)||typeof value.owner_id!=='string')throw new Error('Private account binding cannot be verified');
 if(value.owner_id!==owner)continue;unlinkSync(file);removed=true;}return removed;
}
export async function finalizeAccount(job:FinalizeJob,deps:{prepare:(j:FinalizeJob)=>Promise<void>;credentials:(owner:string)=>Promise<unknown>|unknown;deleteIdentity:(owner:string)=>Promise<{error:{code?:string}|null}>;complete:(j:FinalizeJob)=>Promise<void>;fail:(j:FinalizeJob,code:string)=>Promise<void>}){
 let phase='credential_cleanup_failed';
 try{await deps.prepare(job);await deps.credentials(job.owner_id);phase='auth_unavailable';const result=await deps.deleteIdentity(job.owner_id);if(result.error&&result.error.code!=='user_not_found')throw new Error('Auth deletion unconfirmed');await deps.complete(job);return {complete:true};}
 catch{await deps.fail(job,phase);return {complete:false};}
}
