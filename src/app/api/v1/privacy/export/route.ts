import {accountFor,contentBody,contentFailure,ContentError} from '@/lib/conversation/api';
import {privacyResult,ExportLimiter} from '@/lib/privacy/server';
import {exportChunks,type ExportCategory} from '@/lib/privacy/export';
import type {PrivacyStatus} from '@/lib/privacy/model';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=180;
const limiter=new ExportLimiter();
export async function POST(request:Request){let release:(()=>void)|undefined;try{
 const {client,profile}=await accountFor(request,true);const body=await contentBody(request,64);if(!body||typeof body!=='object'||Object.keys(body).length)throw new ContentError(422,'Export accepts no owner or filters.');
 const status=privacyResult<PrivacyStatus>(await client.rpc('privacy_get_v1',{}));if(!status.recent_authentication)throw new ContentError(403,'Verify your current password before exporting.');
 const user=await client.auth.getUser();if(user.error||user.data.user.id!==profile.owner_id)throw new ContentError(401,'Session unavailable.');
 release=limiter.acquire(profile.owner_id);const at=new Date().toISOString();const abort=new AbortController();const signal=AbortSignal.any([request.signal,abort.signal,AbortSignal.timeout(120000)]);
 const read=async(category:ExportCategory,after:string|null)=>{const rows=privacyResult<{rows:Record<string,unknown>[]}>(await client.rpc('privacy_export_v1',{p_category:category,p_after:after,p_at:at,p_epoch:status.preferences.epoch}).abortSignal(signal)).rows;return category==='profile'?[{...profile,id:profile.owner_id}]:rows;};
 // Check the first page before returning a successful download status.
 const first=await read('profile',null);let firstUsed=false;
 const iterator=exportChunks(async(c,a)=>{if(c==='profile'&&!firstUsed){firstUsed=true;return first;}return read(c,a);},at,{id:profile.owner_id,email:user.data.user.email,created_at:user.data.user.created_at},signal)[Symbol.asyncIterator]();
 const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const r=await iterator.next();if(r.done){release?.();controller.close();}else controller.enqueue(r.value);}catch{release?.();controller.error(new Error('Export did not complete.'));}},async cancel(){release?.();abort.abort();await iterator.return?.();}});
 return new Response(stream,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="jarvis-export-${at.slice(0,10)}.json"`,'Cache-Control':'private, no-store, max-age=0, no-transform','CDN-Cache-Control':'no-store',Pragma:'no-cache',Expires:'0',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
}catch(e){release?.();return contentFailure(e);}}
