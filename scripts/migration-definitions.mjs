// Source comparison aid only, not a SQL parser or deployed-schema verification.
export function migrationDefinitions(sources){
 const expected=new Map();
 for(const source of sources){
  const events=[...source.matchAll(/create(?: or replace)? function ((?:private|public)\.[a-z0-9_]+)\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/gi)].map(m=>({index:m.index,kind:'create',name:m[1],value:m[2].trim()}));
  for(const m of source.matchAll(/alter function ((?:private|public)\.[a-z0-9_]+)\([^)]*\) (rename to ([a-z0-9_]+)|set schema (private|public));/gi))events.push({index:m.index,kind:m[3]?'rename':'schema',name:m[1],value:m[3]??m[4]});
  for(const e of events.sort((a,b)=>a.index-b.index)){
   if(e.kind==='create'){expected.set(e.name,e.value);continue;}
   const body=expected.get(e.name);expected.delete(e.name);
   if(body!==undefined)expected.set(e.kind==='rename'?e.name.split('.')[0]+'.'+e.value:e.value+'.'+e.name.split('.')[1],body);
  }
 }
 return expected;
}
// Narrow source-contract aid for this migration style, not a PostgreSQL parser.
// Balances default expressions (notably default now()) before splitting arguments.
export function migrationSignatures(sources){
 const definitions=new Map();
 for(const source of sources){
  const events=[];
  for(const m of source.matchAll(/^\s*create(?: or replace)? function ((?:private|public)\.[a-z0-9_]+)\(/gim)){
   let depth=1,quoted=false,part='',parts=[];
   for(let i=m.index+m[0].length;i<source.length&&depth;i++){
    const c=source[i];
    if(c==="'"){if(quoted&&source[i+1]==="'"){part+="''";i++;continue;}quoted=!quoted;}
    if(!quoted){if(c==='(')depth++;if(c===')')depth--;if(c===','&&depth===1){parts.push(part);part='';continue;}}
    if(depth)part+=c;
   }
   if(part.trim())parts.push(part);
   events.push({index:m.index,kind:'create',name:m[1],value:parts.map(p=>({name:p.trim().split(/\s+/)[0],optional:/\bdefault\b/i.test(p)}))});
  }
  for(const m of source.matchAll(/alter function ((?:private|public)\.[a-z0-9_]+)\([^)]*\) (rename to ([a-z0-9_]+)|set schema (private|public));/gi))events.push({index:m.index,kind:m[3]?'rename':'schema',name:m[1],value:m[3]??m[4]});
  for(const e of events.sort((a,b)=>a.index-b.index)){
   if(e.kind==='create'){definitions.set(e.name,e.value);continue;}
   const value=definitions.get(e.name);definitions.delete(e.name);
   if(value)definitions.set(e.kind==='rename'?e.name.split('.')[0]+'.'+e.value:e.value+'.'+e.name.split('.')[1],value);
  }
 }
 return definitions;
}
