import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { ScheduleError, resolveSchedule } from './time.ts';

export const DST_POLICY = 'shift_gap_forward_fold_earlier_v1' as const;
export const recurrenceSchema = z.strictObject({
 title:z.string().trim().min(1).max(120), frequency:z.enum(['daily','weekly']),
 weekdays:z.array(z.number().int().min(1).max(7)).max(7),
 start_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
 local_time:z.string().regex(/^\d{2}:\d{2}$/), timezone:z.string().min(1).max(100),
 channel:z.enum(['mock','pushover']), dst_policy:z.literal(DST_POLICY), late_minutes:z.number().int().min(1).max(60),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type OccurrencePreview = { date:string; local_datetime:string; due_at:string; offset:string; adjustment:'none'|'gap_shifted_forward'|'fold_earlier'; resolution:'unique'|'earlier' };
export type ReminderSeries = {id:string;owner_id:string;version:number;state:'draft'|'active'|'paused'|'cancelled'|'ended';schedule:Recurrence;review: {schedule:Recurrence;preview:OccurrencePreview[]}|null;review_version:number;cursor_date:string|null;cursor_due_at:string|null;created_at:string;updated_at:string;reconciled_at:string|null};

// ISO calendar dates, never elapsed 24-hour durations. Monday=1, Sunday=7.
export function normalizeRecurrence(value:unknown, now=Date.now()):Recurrence {
 const parsed=recurrenceSchema.safeParse(value);
 if(!parsed.success)throw new ScheduleError('invalid','Choose daily or weekly, explicit dates, HH:mm time, IANA timezone, channel and lateness of 1–60 minutes. Monthly/yearly and arbitrary recurrence rules are unsupported.');
 const s=parsed.data;
 try {
  if(/[\u0000-\u001f\u007f]/.test(s.title))throw new Error(); // eslint-disable-line no-control-regex
  if(s.timezone!=='UTC'&&(!s.timezone.includes('/')||/^(posix|right)\//.test(s.timezone)))throw new Error();
  const today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(s.timezone).toPlainDate();
  const start=Temporal.PlainDate.from(s.start_date),end=s.end_date?Temporal.PlainDate.from(s.end_date):null;
  Temporal.PlainTime.from(s.local_time,{overflow:'reject'});
  if(Temporal.PlainDate.compare(start,today)<0||Temporal.PlainDate.compare(start,today.add({days:365}))>0)throw new Error();
  if(end&&(Temporal.PlainDate.compare(end,start)<0||Temporal.PlainDate.compare(end,start.add({years:10}))>0))throw new Error();
  if(new Set(s.weekdays).size!==s.weekdays.length||(s.frequency==='daily'?s.weekdays.length!==0:s.weekdays.length===0))throw new Error();
  return {...s,weekdays:[...s.weekdays].sort((a,b)=>a-b)};
 }catch{throw new ScheduleError('invalid','Check the IANA timezone and calendar values. Start today or within 365 days; an optional inclusive end date must be within ten years of the start. Weekly schedules need distinct weekdays; daily schedules use none.');}
}
export function occurrenceOn(s:Recurrence,date:string):OccurrencePreview {
 const local=Temporal.PlainDate.from(date).toPlainDateTime(Temporal.PlainTime.from(s.local_time));
 const early=local.toZonedDateTime(s.timezone,{disambiguation:'earlier'}),late=local.toZonedDateTime(s.timezone,{disambiguation:'later'});
 const gap=!early.toPlainDateTime().equals(local),fold=!gap&&early.epochNanoseconds!==late.epochNanoseconds;
 const chosen=gap?late:early;
 return {date,local_datetime:chosen.toPlainDateTime().toString({smallestUnit:'second'}),due_at:chosen.toInstant().toString(),offset:chosen.offset,adjustment:gap?'gap_shifted_forward':fold?'fold_earlier':'none',resolution:fold?'earlier':'unique'};
}
export function nextOccurrences(s:Recurrence,from:string,count=3,after=-Infinity):OccurrencePreview[] {
 if(!Number.isInteger(count)||count<1||count>32)throw new Error('Bounded occurrence count required');
 let date=Temporal.PlainDate.from(from);const start=Temporal.PlainDate.from(s.start_date);
 if(Temporal.PlainDate.compare(date,start)<0)date=start;
 const results:OccurrencePreview[]=[];
 // Caller cursor is close to the target date. Bounded even with corrupt input.
 for(let days=0;days<400&&results.length<count;days++,date=date.add({days:1})) {
  if(s.end_date&&Temporal.PlainDate.compare(date,Temporal.PlainDate.from(s.end_date))>0)break;
  if(s.frequency==='weekly'&&!s.weekdays.includes(date.dayOfWeek))continue;
  const item=occurrenceOn(s,date.toString());
  if(Date.parse(item.due_at)>after)results.push(item);
 }
 return results;
}
export function reviewRecurrence(value:unknown,now=Date.now()) {
 const schedule=normalizeRecurrence(value,now);
 const preview=nextOccurrences(schedule,schedule.start_date,3,now+5000);
 if(!preview.length)throw new ScheduleError('range','No future occurrence remains before the inclusive end date.');
 return {schedule,preview};
}
export function generationBatch(series:Pick<ReminderSeries,'schedule'|'cursor_date'>,now=Date.now()) {
 const from=series.cursor_date?Temporal.PlainDate.from(series.cursor_date).add({days:1}).toString():series.schedule.start_date;
 const candidates=nextOccurrences(series.schedule,from,32);const batch:OccurrencePreview[]=[];
 for(const c of candidates){batch.push(c);if(Date.parse(c.due_at)>now)break;}
 return batch;
}
export function classifyOccurrence(due:string,lateMinutes:number,now=Date.now()) {
 return Date.parse(due)+lateMinutes*60000<=now?'missed':'scheduling_pending';
}
export function resumePreview(s:Recurrence,now=Date.now()) {
 const today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(s.timezone).toPlainDate().toString();
 return nextOccurrences(s,today,3,now+5000);
}
export function resolveSnooze(reminder:{title:string;timezone:string;due_at:string},input:{minutes?:10|60;local_datetime?:string;disambiguation?:'earlier'|'later'},now=Date.now(),nextDue?:string) {
 let resolved;
 if(input.minutes){
  const due=Temporal.Instant.fromEpochMilliseconds(Math.floor(Math.max(now,Date.parse(reminder.due_at))/1000)*1000).add({minutes:input.minutes});
  const zoned=due.toZonedDateTimeISO(reminder.timezone);
  resolved={title:reminder.title,local_datetime:zoned.toPlainDateTime().toString({smallestUnit:'second'}),timezone:reminder.timezone,due_at:due.toString({smallestUnit:'second'}),resolution:(zoned.toPlainDateTime().toZonedDateTime(reminder.timezone,{disambiguation:'earlier'}).epochMilliseconds===zoned.epochMilliseconds?'earlier':'later') as 'earlier'|'later'};
  // Resolve again to report unique/fold correctly (and strip milliseconds).
  resolved=resolveSchedule({...resolved,disambiguation:resolved.resolution},now);
 }else resolved=resolveSchedule({title:reminder.title,timezone:reminder.timezone,local_datetime:input.local_datetime??'',disambiguation:input.disambiguation},now);
 if(Date.parse(resolved.due_at)<=Date.parse(reminder.due_at))throw new ScheduleError('range','Snooze must move this occurrence later than its current time.');
 if(nextDue&&Date.parse(resolved.due_at)>=Date.parse(nextDue))throw new ScheduleError('range','Snooze must finish before the next occurrence. Skip this occurrence instead; the series is unchanged.');
 return resolved;
}
export const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export function describeRecurrence(s:Recurrence){return `${s.frequency==='daily'?'Daily':s.weekdays.map(d=>weekdays[d-1]).join(', ')} at ${s.local_time} · ${s.timezone} · ${s.start_date}${s.end_date?' through '+s.end_date+' (inclusive)':' until cancelled'}`;}
// Deliberately narrow local demonstration grammar, not a general date interpreter.
export function parseRecurringRequest(text:string,timezone:string,now=Date.now()):{schedule?:Recurrence;clarification?:string}|null {
 const match=text.trim().match(/^remind me every (day|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday) at (\d{1,2})(?::([0-5]\d))?\s*(AM|PM) to (.{1,120}?)(?: starting (\d{4}-\d{2}-\d{2})(?: through (\d{4}-\d{2}-\d{2}))?)?\.?$/i);
 if(!match){if(/\b(?:every|daily|weekly|monthly|yearly|recurr)/i.test(text)&&/\b(?:remind|reminder|notify)/i.test(text))return {clarification:'Use daily or selected weekly weekdays. Choose a start date, local time with AM/PM, fixed IANA timezone and optional inclusive end date in Today. Monthly/yearly and arbitrary rules are unsupported.'};return null;}
 if(!match[6])return {clarification:`What start date (YYYY-MM-DD) should this series use in ${timezone}? You can also choose it in Today. Nothing has been scheduled.`};
 const hour=Number(match[2]);if(hour<1||hour>12)return {clarification:'Use an hour from 1 to 12 with AM or PM, or use the 24-hour Today form.'};
 const day=match[1].toLowerCase();const schedule:Recurrence={title:match[5],frequency:day==='day'?'daily':'weekly',weekdays:day==='day'?[]:day==='weekday'?[1,2,3,4,5]:[weekdays.findIndex(d=>d.toLowerCase()===day)+1],start_date:match[6],end_date:match[7]??null,local_time:String(hour%12+(match[4].toUpperCase()==='PM'?12:0)).padStart(2,'0')+':'+(match[3]??'00'),timezone,channel:'mock',dst_policy:DST_POLICY,late_minutes:5};
 try{return {schedule:normalizeRecurrence(schedule,now)};}catch(e){return {clarification:e instanceof Error?e.message:'Check the schedule in Today.'};}
}
