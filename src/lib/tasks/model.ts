import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import {ScheduleError} from '../reminders/time.ts';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const dueSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('none')}),
 z.strictObject({kind:z.literal('date'),date,timezone:z.string().min(1).max(100)}),
 z.strictObject({kind:z.literal('instant'),local_datetime:z.string().max(19),timezone:z.string().min(1).max(100),disambiguation:z.enum(['earlier','later']).optional()}),
]);
export const taskInputSchema=z.strictObject({title:z.string().trim().min(1).max(120),notes:z.string().max(2000).default(''),due:dueSchema});
export type TaskInput=z.infer<typeof taskInputSchema>;
export type TaskValues={title:string;notes:string;due_kind:'none'|'date'|'instant';due_date:string|null;due_local_datetime:string|null;due_timezone:string|null;due_at:string|null;due_resolution:'unique'|'earlier'|'later'|null};
export type TaskReview={action:'create'|'edit'|'complete'|'reopen'|'cancel'|'delete';values:TaskValues|null};
export type Task=TaskValues&{id:string;owner_id:string;version:number;state:'draft'|'open'|'completed'|'cancelled';review:TaskReview|null;review_version:number;linked_reminder_id:string|null;reminder_review_id:string|null;reminder_review:{reminder_id:string;replaces_id:string|null;replaces_version:number|null}|null;created_at:string;updated_at:string;completed_at:string|null;cancelled_at:string|null};
export type TaskOperation={id:string;owner_id:string;request_id:string;kind:string;request_hash:string;task_id:string|null;task_ref:string;result:{state:string;version:number;review_version:number;in_flight?:boolean;reminder_id?:string|null};created_at:string};
export type TaskReceipt={task:Task|null;operation:TaskOperation;replay:boolean;reminder?:import('../reminders/types').Reminder};
export type TaskCandidate=Omit<TaskValues,'notes'>&{id:string;version:number;state:Task['state']};
export function resolveTask(input:unknown,now=Date.now()):TaskValues{
 const parsed=taskInputSchema.safeParse(input);if(!parsed.success)throw new ScheduleError('invalid','Use a title up to 120 characters, notes up to 2,000 characters and a supported deadline.');
 const {title,notes,due}=parsed.data;
 if(/[\u0000-\u001f\u007f]/.test(title)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes))throw new ScheduleError('invalid','Remove control characters from task text.'); // eslint-disable-line no-control-regex
 const result:TaskValues={title,notes,due_kind:due.kind,due_date:null,due_local_datetime:null,due_timezone:null,due_at:null,due_resolution:null};
 if(due.kind==='none')return result;
 try{
  if(due.timezone!=='UTC'&&(!due.timezone.includes('/')||/^(posix|right)\//.test(due.timezone)))throw new Error();
  const today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(due.timezone).toPlainDate();
  const local=due.kind==='date'?null:Temporal.PlainDateTime.from(due.local_datetime,{overflow:'reject'});
  if(due.kind==='instant'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(due.local_datetime))throw new Error();
  const day=local?local.toPlainDate():Temporal.PlainDate.from(due.kind==='date'?due.date:'');
  if(Temporal.PlainDate.compare(day,today.subtract({years:10}))<0||Temporal.PlainDate.compare(day,today.add({years:10}))>0)throw new Error();
  result.due_timezone=due.timezone;
  if(!local){result.due_date=day.toString();return result;}
  const early=local.toZonedDateTime(due.timezone,{disambiguation:'earlier'}),late=local.toZonedDateTime(due.timezone,{disambiguation:'later'});
  if(!early.toPlainDateTime().equals(local))throw new ScheduleError('gap','This deadline time does not exist. Choose a valid local time.');
  const fold=early.epochMilliseconds!==late.epochMilliseconds;
  if(fold&&due.kind==='instant'&&!due.disambiguation)throw new ScheduleError('ambiguous','This deadline time occurs twice. Choose the earlier or later instant.');
  const chosen=fold&&due.kind==='instant'&&due.disambiguation==='later'?late:early;
  result.due_local_datetime=local.toString({smallestUnit:'second'});result.due_at=chosen.toInstant().toString();result.due_resolution=fold?(due as Extract<TaskInput['due'],{kind:'instant'}>).disambiguation!:'unique';return result;
 }catch(e){if(e instanceof ScheduleError)throw e;throw new ScheduleError('invalid','Check the calendar date, local time and IANA timezone. Deadlines may be up to ten calendar years before or after today.');}
}
export function taskInput(t:TaskValues):TaskInput{return {title:t.title,notes:t.notes,due:t.due_kind==='none'?{kind:'none'}:t.due_kind==='date'?{kind:'date',date:t.due_date!,timezone:t.due_timezone!}:{kind:'instant',local_datetime:t.due_local_datetime!,timezone:t.due_timezone!,...(t.due_resolution!=='unique'?{disambiguation:t.due_resolution!}:{})}};}
export function overdue(t:Pick<Task,'state'|'due_kind'|'due_date'|'due_timezone'|'due_at'>,now=Date.now()){
 if(t.state!=='open'||t.due_kind==='none')return false;
 if(t.due_kind==='instant')return Date.parse(t.due_at!)<=now;
 return Temporal.PlainDate.compare(Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(t.due_timezone!).toPlainDate(),Temporal.PlainDate.from(t.due_date!))>0;
}
export type TaskBucket='Overdue'|'Due today'|'Upcoming'|'No due date'|'Completed'|'Cancelled'|'Drafts';
export function taskBucket(t:Task,now=Date.now()):TaskBucket{
 if(t.state==='draft')return 'Drafts';if(t.state==='completed')return 'Completed';if(t.state==='cancelled')return 'Cancelled';if(overdue(t,now))return 'Overdue';if(t.due_kind==='none')return 'No due date';
 const today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(t.due_timezone!).toPlainDate();const due=t.due_kind==='date'?Temporal.PlainDate.from(t.due_date!):Temporal.Instant.from(t.due_at!).toZonedDateTimeISO(t.due_timezone!).toPlainDate();return due.equals(today)?'Due today':'Upcoming';
}
export function describeDue(t:TaskValues){return t.due_kind==='none'?'No deadline — never overdue':t.due_kind==='date'?`${t.due_date} · whole day in ${t.due_timezone}; overdue from the next local day`:`${t.due_local_datetime?.replace('T',' ')} · ${t.due_timezone}; UTC ${t.due_at} · ${t.due_resolution}`;}
const stop=new Set(['the','a','an','my','task','tasks','to','me','about','please']);
export function resolveReference(candidates:TaskCandidate[],reference:string,focus:string|null,more=false):TaskCandidate{
 const ref=reference.trim().toLowerCase();
 if(['it','that','this','that task','this task'].includes(ref)){const match=candidates.find(t=>t.id===focus);if(match)return match;throw new Error('Which task? Open one in Today or give its title; no current owned task reference is available.');}
 const tokens=ref.split(/[^\p{L}\p{N}]+/u).filter(w=>w&&!stop.has(w));
 const exact=candidates.filter(t=>t.title.trim().toLowerCase()===ref);const matches=exact.length?exact:candidates.filter(t=>tokens.length>0&&tokens.every(w=>t.title.toLowerCase().includes(w)));
 if(matches.length!==1||more)throw new Error(matches.length||more?'Several tasks may match. Give a more specific title or choose the task in Today.':'No matching task is available. Give its title or open Today.');return matches[0];
}
