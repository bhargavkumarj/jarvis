import {it,expect} from 'vitest';
import {assertPrivateDatabaseLogging} from '../../scripts/live-privacy.mjs';
const safe={log_statement:'none',log_duration:'off',log_min_duration_statement:'-1',log_min_duration_sample:'-1',log_parameter_max_length_on_error:'0'};
function sql(settings:Record<string,string>){return async()=>Object.entries(settings).map(([name,setting])=>({name,setting}));}
it('permits only the checked content-minimizing database logging configuration',async()=>{await expect(assertPrivateDatabaseLogging(sql(safe))).resolves.toBeUndefined();});
it('accepts the audited DDL-only setting because runtime requests have no DDL',async()=>{await expect(assertPrivateDatabaseLogging(sql({...safe,log_statement:'ddl'}))).resolves.toBeUndefined();});
it.each(Object.keys(safe))('fails closed when %s could record content or is unverified',async name=>{
 await expect(assertPrivateDatabaseLogging(sql({...safe,[name]:'unsafe'}))).rejects.toThrow('logging preflight');
 const absent={...safe};delete absent[name as keyof typeof safe];await expect(assertPrivateDatabaseLogging(sql(absent))).rejects.toThrow('logging preflight');
});
