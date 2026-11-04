import {migrationDefinitions} from "./migration-definitions.mjs";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { localStatus, root } from "./local-runtime.mjs";
import { safeDiagnostic } from "./safe-diagnostics.mjs";

let sql;
let operation = "local_runtime_status";
try {
  const status = localStatus();
  sql = postgres(status.DB_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const report = { date: new Date().toISOString(), purpose: "read-only local schema diagnostic; not isolation evidence" };
  // All SQL, names and output fields are fixed; no credentials or Auth rows returned.
  await sql.begin("read only", async (tx) => {
    operation = "migration_history";
    report.migrations = (await tx`select version from supabase_migrations.schema_migrations order by version`).map((row) => row.version);
    operation = "schema_privilege_audit";
    report.roles = await tx`select rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      from pg_roles where rolname in ('jarvis_auth_guard', 'jarvis_reminder_worker', 'postgres', 'anon', 'authenticated', 'authenticator') order by rolname`;
    report.memberships = await tx`select parent.rolname as role, member.rolname as member, m.admin_option, m.inherit_option, m.set_option
      from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member
      where parent.rolname='jarvis_auth_guard' or member.rolname='jarvis_auth_guard' order by parent.rolname,member.rolname`;
    report.schemaPrivileges = await tx`select n.nspname as schema,
      has_schema_privilege('jarvis_auth_guard', n.oid, 'USAGE') as guard_usage,
      has_schema_privilege('jarvis_auth_guard', n.oid, 'CREATE') as guard_create,
      has_schema_privilege('authenticated', n.oid, 'CREATE') as authenticated_create,
      has_schema_privilege('anon', n.oid, 'CREATE') as anon_create
      from pg_namespace n where n.nspname in ('public','private','auth') order by n.nspname`;
    report.tables = await tx`select n.nspname as schema,c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
      has_table_privilege('jarvis_auth_guard', c.oid, 'SELECT') as guard_select
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where (n.nspname='auth' and c.relname in ('users','sessions')) or
        (n.nspname='private' and c.relname in ('admissions','revoked_sessions','reminder_outbox','mock_notification_receipts','reminder_test_controls','personal_integrations','notification_acceptances','ai_prices','ai_test_policies','series_test_controls','privacy_jobs','privacy_events','privacy_budget_totals','privacy_requests')) or (n.nspname='public' and c.relname in ('profiles','conversations','messages','memory_proposals','memories','reminders','reminder_operations','delivery_attempts','ai_requests','reminder_series','series_operations','voice_preferences','tasks','task_operations','privacy_preferences'))`;
    report.policies = await tx`select schemaname,tablename,policyname,roles,cmd,qual,with_check
      from pg_policies where (schemaname='public' and tablename in ('profiles','conversations','messages','memory_proposals','memories','reminders','reminder_operations','delivery_attempts','ai_requests','reminder_series','series_operations','voice_preferences','tasks','task_operations','privacy_preferences')) or
        (schemaname='private' and tablename in ('admissions','revoked_sessions','reminder_outbox','mock_notification_receipts','reminder_test_controls','personal_integrations','notification_acceptances','ai_prices','ai_test_policies','series_test_controls','privacy_jobs','privacy_events','privacy_budget_totals','privacy_requests')) order by schemaname,tablename,policyname`;
    const expected=migrationDefinitions(readdirSync(new URL('supabase/migrations/',root)).filter(f=>f.endsWith('.sql')).sort().map(file=>readFileSync(new URL(`supabase/migrations/${file}`,root),'utf8')));
    report.databaseLogging = await tx`select name,setting from pg_settings where name in ('log_statement','log_duration','log_min_duration_statement','log_min_duration_sample','log_parameter_max_length_on_error','log_min_error_statement') order by name`;
    operation = "deployed_function_audit";
    const functions = await tx`select n.nspname as schema,p.proname as name,r.rolname as owner,p.prosecdef as security_definer,
      p.proconfig as settings,p.pronargs as arguments,p.prosrc as body,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
      has_function_privilege('authenticator',p.oid,'EXECUTE') as authenticator_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
      has_function_privilege('postgres',p.oid,'EXECUTE') as operator_execute,
      has_function_privilege('jarvis_auth_guard',p.oid,'EXECUTE') as guard_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
      where n.nspname='private' or (n.nspname='public' and (p.proname='revoke_current_session' or p.proname like 'm2a_%_v1' or p.proname like 'm2b_%_v1' or p.proname like 'm2c_%_v1' or p.proname in ('reminder_series_v1','reminder_snooze_v1') or p.proname like 'voice_%_v1' or p.proname like 'task_%_v1' or p.proname like 'privacy_%_v1' or p.proname like 'computer\\_%')) order by n.nspname,p.proname`;
    // Definitions inspected in memory: share hashes/match flags, never arbitrary bodies.
    report.functions = functions.map(({body, ...metadata}) => ({...metadata,
      bodySha256: createHash('sha256').update(body).digest('hex'),
      matchesLatestSource: expected.get(`${metadata.schema}.${metadata.name}`) === body.trim(),
    }));
    const [worker] = await tx`select
      has_schema_privilege('jarvis_reminder_worker','jarvis_jobs','CREATE') as queue_create,
      has_table_privilege('jarvis_reminder_worker','public.profiles','SELECT') as profile_read,
      has_table_privilege('jarvis_reminder_worker','auth.users','SELECT') as auth_read,
      has_function_privilege('jarvis_reminder_worker','private.m2b_worker_v1(text,jsonb,text)','EXECUTE') as dispatch_capability,
      has_function_privilege('authenticated','private.m2b_worker_v1(text,jsonb,text)','EXECUTE') as client_dispatch,
      pg_has_role('authenticated','jarvis_reminder_worker','SET') as client_can_set_worker,
      pg_has_role('jarvis_reminder_worker','jarvis_auth_guard','SET') as worker_can_set_guard,
      has_function_privilege('jarvis_reminder_worker','jarvis_jobs.create_queue(text,jsonb)','EXECUTE') as runtime_queue_install,
      (select version from jarvis_jobs.version) as queue_schema_version`;
    report.workerPrivileges = worker;
    report.exposedRoutines = await tx`select p.proname as name,p.pronargs as arguments,p.prosecdef as security_definer
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname`;
    operation = "synthetic_account_diagnostic";
    report.synthetic = await tx`select a.email, a.enabled, a.owner_id is not null as admission_claimed,
      u.id is not null as auth_exists,u.email_confirmed_at is not null as confirmed,p.owner_id is not null as profile_exists
      from private.admissions a left join auth.users u on u.id=a.owner_id left join public.profiles p on p.owner_id=u.id
      where a.email in ('alex@example.test','sam@example.test','recovery@example.test') order by a.email`;
  });
  operation = "configuration_match";
  const envFile = new URL('.env.local', root);
  if (existsSync(envFile)) {
    const env = parseEnv(readFileSync(envFile, 'utf8'));
    report.configuration = { apiMatchesRuntime: env.SUPABASE_URL === status.API_URL, keyMatchesRuntime: env.SUPABASE_PUBLISHABLE_KEY === status.ANON_KEY, loopbackOrigin: env.APP_ORIGIN === 'http://127.0.0.1:3000' };
  } else report.configuration = { present: false };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ blocked: true, ...safeDiagnostic(error, operation) }));
  process.exitCode = 1;
} finally { await sql?.end({ timeout: 2 }); }
