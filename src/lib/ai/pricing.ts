// Reviewed official Standard / short-context USD rates, 2026-10-29.
// INR/USD 150 is a conservative accounting conversion, not a spot-rate claim.
export const PRICE_VERSION='2026-10-29-standard-v1';
export const INR_PER_USD=150;
export const MONTHLY_AI_PAISE=100000,EVALUATION_PAISE=20000,ALERT_PAISE=80000;
export const models={
 'gpt-6-luna':{input:.10,cached:.01,write30:.125,write12:.25,output:.50},
 'gpt-6.1-sol':{input:2,cached:.10,write30:2.50,write12:5,output:10},
} as const;
export type ModelId=keyof typeof models;
export type Usage={input:number;output:number;cached:number;write30:number;write12:number;reasoning:number};
export function validateUsage(u:Usage){return Object.values(u).every(n=>Number.isSafeInteger(n)&&n>=0)&&u.cached+u.write30+u.write12<=u.input&&u.reasoning<=u.output;}
export function estimatePaise(model:ModelId,u:Usage){
 if(!validateUsage(u))throw new Error('Invalid numeric usage');const p=models[model];
 return Math.ceil(((u.input-u.cached-u.write30-u.write12)*p.input+u.cached*p.cached+u.write30*p.write30+u.write12*p.write12+u.output*p.output)/1e6*INR_PER_USD*100);
}
export function reservationBounds(requestBody:unknown,purpose:'ordinary'|'evaluation'){
 void purpose;const bytes=Buffer.byteLength(JSON.stringify(requestBody),'utf8');if(bytes>24000)throw new Error('The bounded AI request exceeds 24,000 UTF-8 bytes. Shorten context.');
 return {input:bytes+4096,output:1024};
}
export function worstCasePaise(model:ModelId,input:number,output:number){return estimatePaise(model,{input,output,cached:0,write30:0,write12:input,reasoning:output});}
