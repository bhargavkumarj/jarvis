import {it,expect,vi} from 'vitest';
import {deliverNotification,type DispatchAttempt} from '../../src/worker/delivery';
import type {LiveConfig} from '../../src/lib/live/config';
import type {NotificationAdapter} from '../../src/worker/notification';
const owner=crypto.randomUUID();
const live:LiveConfig={version:1,owner_id:owner,pushover:{token:'t'.repeat(30),user:'u'.repeat(30),device:'synthetic_android'}};
const attempt:DispatchAttempt={attempt_id:crypto.randomUUID(),ordinal:1,scenario:'accept',channel:'mock',owner_id:owner};
function harness(){return {record:{mock:vi.fn().mockResolvedValue(undefined),provider:vi.fn().mockResolvedValue(undefined)},adapters:{mock:vi.fn(async(_a:Parameters<NotificationAdapter['send']>[0],receipt:(id:string)=>Promise<void>)=>{await receipt(attempt.attempt_id);return 'simulated_acceptance' as const;}),live:vi.fn(async()=>({outcome:'provider_accepted' as const,code:null,reference:'synthetic_reference'}))}};}
it('a previously queued mock stays mock even with live credentials enabled',async()=>{
 const h=harness();expect((await deliverNotification(attempt,live,false,h.record,h.adapters)).outcome).toBe('simulated_acceptance');expect(h.adapters.live).not.toHaveBeenCalled();expect(h.record.provider).not.toHaveBeenCalled();expect(h.record.mock).toHaveBeenCalledOnce();
});
it.each(['foreign_owner','isolated_test','missing_config'])('cannot send live for %s and does not fall back to mock',async scenario=>{
 const h=harness();const a={...attempt,channel:'pushover' as const,owner_id:scenario==='foreign_owner'?crypto.randomUUID():owner};
 expect((await deliverNotification(a,scenario==='missing_config'?null:live,scenario==='isolated_test',h.record,h.adapters)).outcome).toBe('outcome_unknown');
 expect(h.adapters.live).not.toHaveBeenCalled();expect(h.adapters.mock).not.toHaveBeenCalled();expect(h.record.provider).not.toHaveBeenCalled();
});
it('records only valid live acceptance and never a mock receipt for live jobs',async()=>{
 const h=harness();expect((await deliverNotification({...attempt,channel:'pushover'},live,false,h.record,h.adapters)).outcome).toBe('provider_accepted');
 expect(h.record.provider).toHaveBeenCalledWith(attempt.attempt_id,'synthetic_reference');expect(h.record.mock).not.toHaveBeenCalled();
});
it('a post-send receipt write failure remains unknown without a second send',async()=>{
 const h=harness();h.record.provider.mockRejectedValueOnce(new Error('DO_NOT_REFLECT'));
 const result=await deliverNotification({...attempt,channel:'pushover'},live,false,h.record,h.adapters);
 expect(result.outcome).toBe('outcome_unknown');expect(h.adapters.live).toHaveBeenCalledOnce();expect(h.adapters.mock).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('DO_NOT_REFLECT');
});
