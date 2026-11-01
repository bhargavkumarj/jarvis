// Static migration/application contract review. This does not parse PL/pgSQL,
// connect to PostgreSQL or prove privileges, FK behavior or runtime locks.
import {it,expect} from 'vitest';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {migrationSignatures} from '../../scripts/migration-definitions.mjs';
const migrationFiles=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
const signatures=migrationSignatures(migrationFiles.map(f=>readFileSync(`supabase/migrations/${f}`,'utf8')));
function source(file:string){return ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);}
function prop(node:ts.TypeLiteralNode,name:string){return node.members.find((m):m is ts.PropertySignature=>ts.isPropertySignature(m)&&!!m.name&&m.name.getText().replaceAll(/["']/g,'')===name)?.type as ts.TypeLiteralNode;}
it('handles nested SQL default expressions and preserves renamed signatures in order',()=>{
 expect(signatures.get('public.privacy_export_v1')).toEqual([{name:'p_category',optional:false},{name:'p_after',optional:true},{name:'p_at',optional:true},{name:'p_epoch',optional:true}]);
 expect(signatures.get('private.task_command_before_privacy_v1')).toEqual(signatures.get('public.task_command_v1'));
});
it('every provisional public RPC argument contract matches the final ordered SQL source',()=>{
 const db=source('src/lib/database.types.ts').statements.find((s):s is ts.TypeAliasDeclaration=>ts.isTypeAliasDeclaration(s)&&s.name.text==='Database')!;
 const functions=prop(prop(db.type as ts.TypeLiteralNode,'public'),'Functions');const issues:string[]=[];
 for(const f of functions.members){if(!ts.isPropertySignature(f))continue;const name=f.name.getText();const args=prop(f.type as ts.TypeLiteralNode,'Args');const sql=signatures.get('public.'+name);
  if(!sql){issues.push(name+': missing SQL');continue;}
  const declared=ts.isTypeLiteralNode(args)?args.members.filter(ts.isPropertySignature).map(a=>({name:a.name.getText(),optional:!!a.questionToken})):[];
  if(JSON.stringify(declared)!==JSON.stringify(sql))issues.push(name+': argument names/defaults differ');
 }
 expect(issues).toEqual([]);
});
it('literal application RPC calls target existing functions with valid argument keys',()=>{
 const files:string[]=[];const scan=(dir:string)=>{for(const d of readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+d.name;if(d.isDirectory())scan(p);else if(/\.tsx?$/.test(p)&&!p.endsWith('database.generated.ts'))files.push(p);}};scan('src');const issues:string[]=[];let calls=0;
 for(const file of files){const sf=source(file);const walk=(n:ts.Node)=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='rpc'&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])){calls++;const name=n.arguments[0].text;const sql=signatures.get('public.'+name);if(!sql)issues.push(file+': '+name+' missing');else if(n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1]))for(const a of n.arguments[1].properties){if(a.name&&!ts.isComputedPropertyName(a.name)&&!sql.some((p:{name:string})=>p.name===a.name!.getText(sf).replaceAll(/["']/g,'')))issues.push(file+': '+name+' unknown '+a.name.getText(sf));}}ts.forEachChild(n,walk);};walk(sf);}
 expect(calls).toBeGreaterThan(40);expect(issues).toEqual([]);
});
