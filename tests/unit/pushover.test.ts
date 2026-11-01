import {it,expect,vi} from 'vitest';
import {sendPushover,validatePushover,PUSHOVER_MESSAGE,PUSHOVER_TITLE} from '../../src/worker/pushover';
import {maskedLiveStatus,pushBinding,liveConfigSchema} from '../../src/lib/live/config';
const credentials={token:'t'.repeat(30),user:'u'.repeat(30),device:'synthetic_android'};
function http(status:number,body:unknown){return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body),{status}));}
it('normal-priority generic acceptance has no content, URL, emergency fields or arbitrary recipient',async()=>{
 const request=http(200,{status:1,request:'synthetic-provider-reference'});const result=await sendPushover(credentials,request);
 expect(result.outcome).toBe('provider_accepted');const [url,options]=request.mock.calls[0];expect(url).toBe('https://api.pushover.net/1/messages.json');
 const form=options!.body as URLSearchParams;expect(Object.fromEntries(form)).toEqual({...credentials,priority:'0',title:PUSHOVER_TITLE,message:PUSHOVER_MESSAGE});expect(options!.redirect).toBe('error');expect(options!.signal).toBeInstanceOf(AbortSignal);
});
it.each([400,401,403,429])('does not blindly retry explicit rejection %s',async status=>{const r=await sendPushover(credentials,http(status,{status:0,errors:['SENSITIVE_SENTINEL']}));expect(r.outcome).toBe('permanent_rejection');expect(JSON.stringify(r)).not.toContain('SENSITIVE_SENTINEL');if(status===429)expect(r.code).toBe('pushover_rate_limited');});
it('only proven pre-acceptance transient rejection is retryable',async()=>{expect((await sendPushover(credentials,http(503,{status:0}))).outcome).toBe('retryable_rejection');expect((await sendPushover(credentials,http(503,{error:'unclear'}))).outcome).toBe('outcome_unknown');});
it('timeouts, transport failure, malformed or incomplete acceptance preserve uncertainty',async()=>{
 for(const request of [vi.fn<typeof fetch>().mockRejectedValue(new Error('SENSITIVE_SENTINEL')),http(200,{status:1}),vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON'))]){
  const result=await sendPushover(credentials,request);expect(result.outcome).toBe('outcome_unknown');expect(JSON.stringify(result)).not.toContain('SENSITIVE_SENTINEL');
 }
});
it('validates the configured device without sending a message',async()=>{const request=http(200,{status:1,devices:['synthetic_android']});expect(await validatePushover(credentials,request)).toBe(true);expect(request.mock.calls[0][0]).toBe('https://api.pushover.net/1/users/validate.json');expect(await validatePushover(credentials,http(200,{status:1,devices:['another_device']}))).toBe(false);});
it('owner/device/key binding changes explicitly; status contains booleans only',()=>{
 const config=liveConfigSchema.parse({version:1,owner_id:crypto.randomUUID(),pushover:credentials});
 expect(pushBinding(config)).not.toBe(pushBinding({...config,owner_id:crypto.randomUUID()}));expect(pushBinding(config)).not.toBe(pushBinding({...config,pushover:{...credentials,device:'different'}}));
 const status=maskedLiveStatus(config);expect(Object.values(status).every(v=>typeof v==='boolean')).toBe(true);expect(JSON.stringify(status)).not.toContain(credentials.token);
});
