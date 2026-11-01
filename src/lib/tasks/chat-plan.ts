import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import type {TaskInput} from './model';
export const taskPlanSchema=z.strictObject({
 operation:z.enum(['create','edit','complete','reopen','cancel','delete','remind','list_overdue']),reference:z.string().max(160).nullable(),title:z.string().trim().min(1).max(120).nullable(),notes:z.string().max(2000).nullable(),
 deadline:z.strictObject({kind:z.enum(['none','date','instant']),date:z.string().max(10).nullable(),local_datetime:z.string().max(19).nullable(),timezone:z.string().max(100).nullable(),disambiguation:z.enum(['earlier','later']).nullable()}).nullable(),
 reminder:z.strictObject({local_datetime:z.string().max(19),timezone:z.string().max(100),disambiguation:z.enum(['earlier','later']).nullable()}).nullable(),
});
export type TaskPlan=z.infer<typeof taskPlanSchema>;
export type ParsedTask={plan:TaskPlan;duePhrase?:string;reminderPhrase?:string}|{clarification:string};
const empty={reference:null,title:null,notes:null,deadline:null,reminder:null};
export function taskRelated(text:string){return /\btasks?\b|\bmake (?:it|that) due\b|\bremind me about\b/i.test(text);}
export function ambiguousTaskDate(text:string){return /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)&&! /\b\d{4}-\d{2}-\d{2}\b|\b(?:today|tomorrow)\b/i.test(text);}
export function parseTaskChat(text:string):ParsedTask|null{
 const s=text.trim().replace(/[.!]$/,'');let m;
 if(/^show (?:my )?overdue tasks$/i.test(s))return {plan:{...empty,operation:'list_overdue'}};
 if((m=s.match(/^(?:please )?add (?:a )?task to (.{1,120})$/i)))return {plan:{...empty,operation:'create',title:m[1]}};
 if((m=s.match(/^make (.+?) due (.+)$/i)))return {plan:{...empty,operation:'edit',reference:m[1]},duePhrase:m[2]};
 if((m=s.match(/^mark (.+?)(?: task)? (?:complete|done)$/i)))return {plan:{...empty,operation:'complete',reference:m[1]}};
 if((m=s.match(/^(reopen|cancel|delete) (?:the )?(.+?)(?: task)?$/i))&&taskRelated(text))return {plan:{...empty,operation:m[1].toLowerCase() as 'reopen'|'cancel'|'delete',reference:m[2]}};
 if((m=s.match(/^remind me about (.+?) ((?:tomorrow|today|(?:on )?\d{4}-\d{2}-\d{2}).+)$/i)))return {plan:{...empty,operation:'remind',reference:m[1]},reminderPhrase:m[2]};
 return null;
}
export function deadlinePhrase(phrase:string,timezone:string,now=Date.now()):TaskInput['due']{
 if(ambiguousTaskDate(phrase))throw new Error('Which calendar date? Specify YYYY-MM-DD, and whether the deadline is date-only or has a specific time. Weekday names are ambiguous; nothing was changed.');
 const m=phrase.trim().match(/^(today|tomorrow|(?:on )?\d{4}-\d{2}-\d{2})(?: at (\d{1,2})(?::([0-5]\d))?\s*(AM|PM))?$/i);
 if(!m)throw new Error('Give YYYY-MM-DD or today/tomorrow. Add an explicit AM/PM time if needed; use Today for DST choices. Nothing was changed.');
 const today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timezone).toPlainDate();const day=m[1].toLowerCase()==='today'?today:m[1].toLowerCase()==='tomorrow'?today.add({days:1}):Temporal.PlainDate.from(m[1].replace(/^on /i,''));
 if(!m[2])return {kind:'date',date:day.toString(),timezone};const hour=Number(m[2]);if(hour<1||hour>12)throw new Error('Choose an hour from 1 to 12 with AM/PM.');
 return {kind:'instant',local_datetime:`${day.toString()}T${String(hour%12+(m[4].toUpperCase()==='PM'?12:0)).padStart(2,'0')}:${m[3]??'00'}:00`,timezone};
}
const nullableString={type:['string','null']};
function toolObject(properties:Record<string,unknown>){return {type:'object',additionalProperties:false,required:Object.keys(properties),properties};}
const nullable=(object:unknown)=>({anyOf:[{type:'null'},object]});
export const taskToolProperty=nullable(toolObject({
 operation:{type:'string',enum:['create','edit','complete','reopen','cancel','delete','remind','list_overdue']},reference:nullableString,title:nullableString,notes:nullableString,
 deadline:nullable(toolObject({kind:{type:'string',enum:['none','date','instant']},date:nullableString,local_datetime:nullableString,timezone:nullableString,disambiguation:{type:['string','null'],enum:['earlier','later',null]}})),
 reminder:nullable(toolObject({local_datetime:{type:'string'},timezone:{type:'string'},disambiguation:{type:['string','null'],enum:['earlier','later',null]}})),
}));
