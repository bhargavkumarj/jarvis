export const PUSHOVER_TITLE='Personal assistant';
export const PUSHOVER_MESSAGE='You have a reminder. Open your assistant on your computer to view it.';
export type PushCredentials={token:string;user:string;device:string};
export type PushResult={outcome:'provider_accepted'|'retryable_rejection'|'permanent_rejection'|'outcome_unknown';code:string|null;reference:string|null};
const unknown=():PushResult=>({outcome:'outcome_unknown',code:'pushover_outcome_unknown',reference:null});
export async function validatePushover(credentials:PushCredentials,request:typeof fetch=fetch):Promise<boolean>{
 try{
  const response=await request('https://api.pushover.net/1/users/validate.json',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(credentials),signal:AbortSignal.timeout(8000)});
  const data=await response.json();return response.status===200&&data.status===1&&Array.isArray(data.devices)&&data.devices.includes(credentials.device);
 }catch{return false;}
}
export async function sendPushover(credentials:PushCredentials,request:typeof fetch=fetch):Promise<PushResult>{
 try{
  const response=await request('https://api.pushover.net/1/messages.json',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({...credentials,title:PUSHOVER_TITLE,message:PUSHOVER_MESSAGE,priority:'0'}),signal:AbortSignal.timeout(8000)});
  let data:{status?:number;request?:string};try{data=await response.json();}catch{return unknown();}
  if(response.status===200&&data.status===1&&typeof data.request==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(data.request)&&data.request!==credentials.token&&data.request!==credentials.user)return {outcome:'provider_accepted',code:null,reference:data.request};
  // Explicit status=0 proves non-acceptance. An unparseable/ambiguous response
  // or a transport failure may follow acceptance: do not blindly replay.
  if(data.status===0){
   if(response.status>=500)return {outcome:'retryable_rejection',code:'pushover_temporarily_rejected',reference:null};
   return {outcome:'permanent_rejection',code:response.status===429?'pushover_rate_limited':'pushover_rejected_or_credentials_invalid',reference:null};
  }
  return unknown();
 }catch{return unknown();}
}
