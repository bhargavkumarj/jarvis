// Check effective database logging settings; never return content or credentials.
// Covers ordinary SQL statement/parameter logs, not forensic disk erasure,
// infrastructure backups, extension logs, or operator access.
export async function assertPrivateDatabaseLogging(sql){
 const rows=await sql`select name,setting from pg_settings where name in
  ('log_statement','log_duration','log_min_duration_statement','log_min_duration_sample','log_parameter_max_length_on_error')`;
 const settings=Object.fromEntries(rows.map(row=>[row.name,row.setting]));
 // Supabase's audited `ddl` default does not log ordinary app SELECT/DML.
 // Operator-written DDL remains within the operator trust boundary.
 if(!['none','ddl'].includes(settings.log_statement))throw new Error('Database statement logging preflight failed; no settings were changed.');
 const expected={log_duration:'off',log_min_duration_statement:'-1',log_min_duration_sample:'-1',log_parameter_max_length_on_error:'0'};
 if(Object.entries(expected).some(([name,value])=>settings[name]!==value))throw new Error('Database logging preflight failed; review local:audit settings privately before live AI. No settings were changed.');
}
