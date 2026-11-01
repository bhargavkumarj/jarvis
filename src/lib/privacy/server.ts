import 'server-only';
import {ContentError} from '../conversation/api';
export function privacyResult<T>(result:{data:unknown;error:{code?:string}|null}):T{
 if(result.error){const code=result.error.code;throw new ContentError(code==='42501'?403:code==='40001'||code==='23505'?409:code==='54000'?429:['22023','23514','22P02'].includes(code??'')?422:503,code==='42501'?'Recent password authentication or account access is required.':code==='40001'||code==='23505'?'Privacy state changed or a deletion is already pending. Refresh before retrying.':code==='54000'?'Privacy request limit reached. Wait before trying again.':code==='22023'?'Check the exact confirmation and settings.':'Privacy storage is unavailable. No completion was confirmed.');}
 return result.data as T;
}

export class ExportLimiter {
 private owners=new Set<string>();
 acquire(owner:string){if(this.owners.has(owner)||this.owners.size>=2)throw new ContentError(429,'An export is already running. Wait for it to finish or cancel before retrying.');this.owners.add(owner);let released=false;const timer=setTimeout(()=>release(),125000);const release=()=>{if(released)return;released=true;clearTimeout(timer);this.owners.delete(owner);};return release;}
}
