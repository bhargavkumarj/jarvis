import { describe,it,expect } from 'vitest';
import { resolveSchedule,ScheduleError,parseReminderCommand } from '../../src/lib/reminders/time';
import { confirmSchema,reviewSchema } from '../../src/lib/reminders/validation';
import { mockNotification,GENERIC_PAYLOAD,type MockScenario } from '../../src/worker/notification';
const now=Date.parse('2026-01-01T00:00:00Z');
const input={title:'Synthetic reminder',local_datetime:'2026-02-01T12:00',timezone:'Asia/Kolkata'};
describe('explicit reminder time interpretation',()=>{
 it('resolves a local time using its explicit zone, independently of server zone',()=>{expect(resolveSchedule(input,now)).toMatchObject({due_at:'2026-02-01T06:30:00Z',local_datetime:'2026-02-01T12:00:00',resolution:'unique'});});
 it.each(['2026-02-30T12:00','2026-02-01T24:00','2026-02-01T12:00Z','tomorrow at noon'])('rejects invalid or unsupported input %s',local_datetime=>{expect(()=>resolveSchedule({...input,local_datetime},now)).toThrow(ScheduleError);});
 it('rejects nonexistent clock-gap times without shifting them',()=>{expect(()=>resolveSchedule({...input,local_datetime:'2026-03-08T02:30',timezone:'America/New_York'},now)).toThrow(/does not exist/);});
 it('requires an explicit overlap choice and distinguishes both instants',()=>{
  const overlap={...input,local_datetime:'2026-11-01T01:30',timezone:'America/New_York'};
  expect(()=>resolveSchedule(overlap,now)).toThrow(/occurs twice/);
  expect(resolveSchedule({...overlap,disambiguation:'earlier'},now).due_at).toBe('2026-11-01T05:30:00Z');
  expect(resolveSchedule({...overlap,disambiguation:'later'},now).due_at).toBe('2026-11-01T06:30:00Z');
 });
 it('handles a half-hour clock change',()=>{expect(()=>resolveSchedule({...input,local_datetime:'2026-04-05T01:45',timezone:'Australia/Lord_Howe'},now)).toThrow(/occurs twice/);});
 it('rejects past, far-future and under-five-second schedules',()=>{for(const local_datetime of ['2025-12-31T23:59','2027-01-02T12:00','2026-01-01T00:00:04'])expect(()=>resolveSchedule({...input,timezone:'UTC',local_datetime},now)).toThrow(/five seconds/);});
 it('requires IANA zones and bounded plain titles',()=>{for(const timezone of ['EST','+05:30','No/SuchZone'])expect(()=>resolveSchedule({...input,timezone},now)).toThrow();for(const title of ['', 'x'.repeat(121),'x\ny'])expect(()=>resolveSchedule({...input,title},now)).toThrow();});
 it('recognizes only the documented mock grammar',()=>{expect(parseReminderCommand('/remind 2026-11-01T01:30 America/New_York later | Synthetic')).toMatchObject({disambiguation:'later',title:'Synthetic'});expect(parseReminderCommand('/remind tomorrow at noon')).toBeNull();});
 it('rejects injected owner, mock fault and confirmation fields at the request boundary',()=>{
  expect(reviewSchema.safeParse({request_id:crypto.randomUUID(),schedule:input,owner_id:crypto.randomUUID()}).success).toBe(false);
  expect(reviewSchema.safeParse({request_id:crypto.randomUUID(),schedule:{...input,scenario:'accept'}}).success).toBe(false);
  expect(confirmSchema.safeParse({request_id:crypto.randomUUID(),id:crypto.randomUUID(),version:1,snapshot:{...resolveSchedule(input,now),version:1,approved:true}}).success).toBe(false);
 });
});
describe('mock notification contract, not durable scheduling evidence',()=>{
 it.each(['accept','retry_once','always_retry','permanent','timeout_unknown'] as MockScenario[])('records acceptance only when established: %s',async scenario=>{
  let receipts=0;const outcome=await mockNotification.send({attempt_id:crypto.randomUUID(),ordinal:1,scenario},async()=>{receipts++;});
  expect(receipts).toBe(scenario==='accept'?1:0);
  expect(outcome).toBe(scenario==='accept'?'simulated_acceptance':scenario==='permanent'?'permanent_rejection':scenario==='timeout_unknown'?'outcome_unknown':'retryable_rejection');
 });
 it('accepts the next attempt after a proven temporary rejection, with generic payload',async()=>{let calls=0;expect(await mockNotification.send({attempt_id:crypto.randomUUID(),ordinal:2,scenario:'retry_once'},async()=>{calls++;})).toBe('simulated_acceptance');expect(calls).toBe(1);expect(GENERIC_PAYLOAD).toBe('You have a reminder. Open the app to view it.');});
});
