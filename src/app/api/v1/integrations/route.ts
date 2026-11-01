import {accountFor,contentFailure,databaseResult,ContentError} from '@/lib/conversation/api';
import {readLiveConfig} from '@/lib/live/config';
import {json} from '@/lib/http';
import {availability} from '@/lib/workspace';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 if(new URL(request.url).search)throw new ContentError(400,'Filters are not accepted.');
 const {client,profile}=await accountFor(request);const config=readLiveConfig();
 const caps=databaseResult<{pushover_enabled:boolean;ai_enabled:boolean}>(await client.rpc('m2c_capabilities_v1',{}));
 const bound=config?.owner_id===profile.owner_id;
 const prefs=databaseResult<{text_cloud:boolean;notifications:boolean;retention_days:number}>(await client.from('privacy_preferences').select('text_cloud,notifications,retention_days').eq('owner_id',profile.owner_id).single());
 const summary=bound?await client.rpc("m2c_ai_budget_v1",{}):null;
 const budget=summary&&!summary.error?summary.data:null;
 return json({budget,pushover_available:bound&&!!config?.pushover&&caps.pushover_enabled,openai_available:bound&&!!config?.openai?.enabled&&!!config.openai.model&&caps.ai_enabled,model:bound?config?.openai?.model??null:null,
  text_state:availability(bound&&!!config?.openai,!!config?.openai?.enabled&&!!config.openai.model,prefs.text_cloud,caps.ai_enabled),
  notification_state:availability(bound&&!!config?.pushover,true,prefs.notifications,caps.pushover_enabled),retention_days:prefs.retention_days});
}catch(error){return contentFailure(error);}}
