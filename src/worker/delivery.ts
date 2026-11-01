import type {LiveConfig} from '../lib/live/config.ts';
import {mockNotification,type MockScenario} from './notification.ts';
import {sendPushover} from './pushover.ts';
export type DispatchAttempt={attempt_id:string;ordinal:number;scenario:MockScenario;channel:'mock'|'pushover';owner_id:string};
// Called only after the database authorizes dispatch. The recorded channel is
// authoritative: enabling live configuration never upgrades an old mock job.
export async function deliverNotification(attempt:DispatchAttempt,live:LiveConfig|null,isolated:boolean,
 record:{mock:(id:string)=>Promise<void>;provider:(id:string,reference:string)=>Promise<void>},
 adapters={mock:mockNotification.send,live:sendPushover}){
 try{
  if(attempt.channel==='mock')return {outcome:await adapters.mock(attempt,record.mock),code:null};
  if(attempt.channel!=='pushover'||isolated||!live?.pushover||attempt.owner_id!==live.owner_id)throw new Error('Live channel unavailable');
  const result=await adapters.live(live.pushover);
  if(result.outcome==='provider_accepted'){
   if(!result.reference)throw new Error('Missing acceptance evidence');
   await record.provider(attempt.attempt_id,result.reference);
  }
  return {outcome:result.outcome,code:result.code};
 }catch{
  // Includes a post-send recording failure. Never classify this as proven
  // rejection or silently fall back to another channel.
  return {outcome:'outcome_unknown' as const,code:null};
 }
}
