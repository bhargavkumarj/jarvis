import {z} from 'zod';
import {taskPlanSchema,taskToolProperty,taskRelated} from '../tasks/chat-plan';
export const recurringProposalSchema=z.strictObject({title:z.string().trim().min(1).max(120),frequency:z.enum(['daily','weekly']),weekdays:z.array(z.number().int().min(1).max(7)).max(7),start_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),end_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),local_time:z.string().regex(/^\d{2}:\d{2}$/),timezone:z.string().min(1).max(100)});
export const actionPlanSchema=z.strictObject({
 memory:z.strictObject({content:z.string().trim().min(1).max(1000),conflict_id:z.uuid().nullable(),conflict_version:z.number().int().positive().nullable()}).nullable(),
 reminder:z.strictObject({title:z.string().trim().min(1).max(120),local_datetime:z.string().max(19),timezone:z.string().min(1).max(100),disambiguation:z.enum(['earlier','later']).nullable()}).nullable(),
 task:taskPlanSchema.nullable().optional(),
 recurrence:recurringProposalSchema.nullable().optional(),
 clarification:z.string().max(500).nullable(),
});
export type ActionPlan=z.infer<typeof actionPlanSchema>;
export const EMPTY_PLAN:ActionPlan={memory:null,reminder:null,clarification:null};
// Model clarifications stay model text, never become authoritative app receipts.
export function composeLiveResult(preview:string,clarification:string|null,operationReceipt:string){
 const suffix=clarification?`${preview.trim()?'\n\n':''}Clarification: ${clarification}`:'';
 const modelText=preview+suffix;
 const text=modelText.trim()?(modelText+(operationReceipt?'\n\n'+operationReceipt:'')):(operationReceipt||'No action was executed. Please clarify what you need.');
 return {text,receipt:operationReceipt,completionDelta:preview.trim()?suffix:text};
}
export function explicitSaveIntent(text:string){
 return /^(?:please\s+)?(?:remember(?:\s+(?:this|that))?|save\s+(?:this|a)\s+(?:memory|note))\b/i.test(text.trim())&&!/(?:\b(?:pretend|roleplay|hypothetical|quotation|quote)\b|(?:do not|don't|never)\s+(?:remember|save)\b|["“”])/i.test(text);
}
export function unsupportedSuccessClaim(text:string){return /\btask\s+(?:created|updated|completed|reopened|deleted|cancelled)\b/i.test(text)||/\b(?:task)\s+(?:has been|is now|was)\s+(?:created|updated|completed|reopened|deleted|cancelled)\b/i.test(text)||/\bI(?:'ve| have)?\s+(?:created|updated|completed|reopened)\s+(?:(?:your|the|a)\s+)?task\b/i.test(text)||/\b(?:app|server)\s+(?:operation\s+)?receipt:/i.test(text)||/\b(?:I(?:'ve| have)?|we(?:'ve| have)?)\s+(?:(?:successfully|already|just)\s+)?(?:saved|scheduled|sent|approved|deleted|cancelled|canceled|paused|resumed|snoozed|skipped|set\s+(?:up\s+)?(?:your|the)\s+reminder)\b|\b(?:reminder|notification|memory|account|history)\s+(?:has been|is now|was)\s+(?:saved|scheduled|sent|approved|deleted|paused|resumed|snoozed|skipped)\b/i.test(text);}
export function validateActions(plan:ActionPlan,text:string,temporary:boolean,approved:{id:string;version:number}[]):ActionPlan{
 if(plan.clarification&&unsupportedSuccessClaim(plan.clarification))throw new Error('Unsupported action claim in clarification.');
 if(temporary&&(plan.memory||plan.reminder||plan.recurrence||plan.task))return {...EMPTY_PLAN,clarification:'Persistent actions are disabled in temporary chat. Use a retained conversation or Today; saving there creates application data.'};
 if(plan.task&&!taskRelated(text))throw new Error('Task proposals require a current explicit task request.');
 if(plan.task&&(plan.memory||plan.reminder||plan.recurrence))throw new Error('Review one task operation separately from other actions.');
 if(plan.memory&&!explicitSaveIntent(text))throw new Error('Memory proposal requires an explicit current save request.');
 if(plan.memory?.conflict_id&&!approved.some(m=>m.id===plan.memory!.conflict_id&&m.version===plan.memory!.conflict_version))throw new Error('Conflict reference is not an included owned approved revision.');
 if(plan.recurrence&&(!/\b(?:remind|reminder|notify)\b/i.test(text)||!/\b(?:every|daily|weekly|recurr)/i.test(text)))throw new Error('Recurrence requires an explicit current recurring reminder request.');
 if(plan.recurrence&&!text.includes(plan.recurrence.start_date)&&! /\b(?:start|starting|from)\s+(?:today|tomorrow)\b/i.test(text))return {...EMPTY_PLAN,clarification:'What start date should this recurring reminder use? Specify YYYY-MM-DD or explicitly start today/tomorrow, then review it in Today.'};
 if(plan.recurrence&&plan.reminder)throw new Error('Propose a series or a one-time reminder, never both.');
 if(plan.reminder&&!/\b(?:remind|reminder|notify)\b/i.test(text))throw new Error('Reminder proposal requires a current reminder request.');
 if(plan.clarification&&(plan.memory||plan.reminder||plan.recurrence||plan.task))throw new Error('Clarify before proposing persistent actions.');
 return plan;
}
export const proposalTool={type:'function' as const,name:'propose_actions_v1',description:'Propose only; never approve, save a confirmed schedule, enqueue or send. Use current explicit requests. Ask a text clarification when needed.',strict:true,
 parameters:{type:'object',additionalProperties:false,required:['memory','reminder','recurrence','task','clarification'],properties:{
  memory:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['content','conflict_id','conflict_version'],properties:{content:{type:'string'},conflict_id:{type:['string','null']},conflict_version:{type:['integer','null']}}}]},
  reminder:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['title','local_datetime','timezone','disambiguation'],properties:{title:{type:'string'},local_datetime:{type:'string'},timezone:{type:'string'},disambiguation:{type:['string','null'],enum:['earlier','later',null]}}}]},
  recurrence:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['title','frequency','weekdays','start_date','end_date','local_time','timezone'],properties:{title:{type:'string'},frequency:{type:'string',enum:['daily','weekly']},weekdays:{type:'array',items:{type:'integer',enum:[1,2,3,4,5,6,7]}},start_date:{type:'string'},end_date:{type:['string','null']},local_time:{type:'string'},timezone:{type:'string'}}}]},
  task:taskToolProperty,
  clarification:{type:['string','null']},
 }}};
