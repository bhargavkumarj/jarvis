// A separate named stack/ports; NEVER reset the retained jarvis-foundation DB.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, rmSync, statfsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { root, localStatus, assertLocalUrl, assertLocalDockerEndpoint } from "./local-runtime.mjs";
import { safeDiagnostic } from "./safe-diagnostics.mjs";

let directory, sql, retainedSql, retainedBefore, reconstruction, started = false, cleanupFailed = false;
let operation = "disposable_preflight";
const project = `jarvis-m1-rebuild-${randomBytes(12).toString("hex")}`;
const binary = new URL("node_modules/.bin/supabase", root).pathname;
function cli(args) {
  return execFileSync(binary, ["--workdir", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024, env: { ...process.env, DO_NOT_TRACK: "1" } });
}
async function retainedFingerprint() {
  // Read only; values/hashes never printed. Quiesce normal app/tests during this
  // check: concurrent preference/admission changes legitimately change the hash.
  // Volatile Auth sessions/last-sign-in timestamps are deliberately out of scope.
  return retainedSql.begin("isolation level repeatable read read only", async (tx) => {
    const state = [
      await tx`select to_jsonb(p) as row from public.profiles p order by owner_id`,
      await tx`select to_jsonb(a) as row from private.admissions a order by email`,
      await tx`select to_jsonb(r) as row from private.revoked_sessions r order by session_id`,
      await tx`select id, email, email_confirmed_at, created_at, banned_until from auth.users order by id`,
      await tx`select version from supabase_migrations.schema_migrations order by version`,
    ];
    // Fixed allowlist only; pre-M2 retained databases may not have these tables.
    for (const [schema,name,key] of [
      ...["conversations","messages","memory_proposals","memories","reminders","reminder_operations","delivery_attempts","ai_requests","reminder_series","series_operations","tasks","task_operations"].map(name=>["public",name,"id"]),
      ...["reminder_outbox","mock_notification_receipts","notification_acceptances"].map(name=>["private",name,"id"]),
      ["private","personal_integrations","singleton"],["private","ai_prices","model"],["private","ai_test_policies","owner_id"],
      ["public","voice_preferences","owner_id"],["public","privacy_preferences","owner_id"],
      ["private","reminder_test_controls","reminder_id"],["private","series_test_controls","series_id"],
      ["private","privacy_jobs","id"],["private","privacy_events","id"],["private","privacy_budget_totals","scope_id"],["private","privacy_requests","owner_id"],
      ["jarvis_jobs","job","id"],["jarvis_jobs","queue","name"],["jarvis_jobs","version","version"],
    ]) {
      const [exists] = await tx`select to_regclass(${`${schema}.${name}`}) is not null as present`;
      if (exists.present) {
        if(schema==="private"&&name==="privacy_requests")state.push(await tx`select to_jsonb(t) as row from private.privacy_requests t order by owner_id,request_id`);
        else if(schema==="private"&&name==="privacy_budget_totals")state.push(await tx`select to_jsonb(t) as row from private.privacy_budget_totals t order by scope_id,budget_month`);
        else state.push(await tx`select to_jsonb(t) as row from ${tx(`${schema}.${name}`)} t order by ${tx(key)}`);
      }
    }
    return createHash("sha256").update(JSON.stringify(state)).digest("hex");
  });
}
try {
  if (process.env.DOCKER_HOST) assertLocalDockerEndpoint(process.env.DOCKER_HOST);
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assertLocalDockerEndpoint(endpoint);
  const disk = statfsSync(tmpdir());
  if (disk.bavail * disk.bsize < 5 * 1024 ** 3) throw new Error("REBUILD_DISK_HEADROOM");
  operation = "retained_readonly_baseline";
  const retained = localStatus();
  retainedSql = postgres(retained.DB_URL, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  retainedBefore = await retainedFingerprint();
  directory = mkdtempSync(join(tmpdir(), "jarvis-m1-rebuild-"));
  mkdirSync(join(directory, "supabase/migrations"), { recursive: true });
  let config = readFileSync(new URL("supabase/config.toml", root), "utf8");
  if (!config.includes('project_id = "jarvis-foundation"')) throw new Error("REBUILD_CONFIG");
  config = config.replace('project_id = "jarvis-foundation"', `project_id = "${project}"`);
  for (const [from, to] of [[54320,55320],[54321,55321],[54322,55322],[54323,55323],[54324,55324]]) config = config.replaceAll(String(from), String(to));
  writeFileSync(join(directory, "supabase/config.toml"), config, { mode: 0o600 });
  for (const folder of ["migrations", "templates"]) {
    mkdirSync(join(directory, "supabase", folder), { recursive: true });
    for (const file of readdirSync(new URL(`supabase/${folder}/`, root))) copyFileSync(new URL(`supabase/${folder}/${file}`, root), join(directory, "supabase", folder, file));
  }
  copyFileSync(new URL("supabase/seed.sql", root), join(directory, "supabase/seed.sql"));
  console.log(JSON.stringify({disposableProject:project,ports:"55320–55324",retainedDatabaseTargeted:false}));
  started = true;
  operation = "disposable_start";
  cli(["start", "-x", "realtime,studio,postgres-meta,edge-runtime,storage-api,imgproxy,logflare,vector,supavisor"]);
  operation = "disposable_status";
  const status = JSON.parse(cli(["status", "-o", "json"]));
  assertLocalUrl(status.API_URL,55321); assertLocalUrl(status.DB_URL,55322);
  sql = postgres(status.DB_URL, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  operation = "disposable_migrations_and_grants";
  const versions = (await sql`select version from supabase_migrations.schema_migrations order by version`).map((r) => r.version);
  const expected = readdirSync(new URL("supabase/migrations/", root)).filter((f) => f.endsWith(".sql")).sort().map((f) => f.split("_")[0]);
  if (JSON.stringify(versions) !== JSON.stringify(expected)) throw new Error("REBUILD_HISTORY");
  const [guard] = await sql`select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='jarvis_auth_guard'`;
  if (!guard || guard.rolcanlogin || guard.rolsuper || guard.rolbypassrls) throw new Error("REBUILD_PRIVILEGE");
  const admin = createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  operation = "disposable_user_profiles";
  for (const name of ["alex","sam"]) {
    const credentials = { email:`${name}@example.test`, password:randomBytes(24).toString("base64url") };
    if ((await admin.auth.admin.createUser({...credentials,email_confirm:true})).error) throw new Error("REBUILD_FIXTURE");
    const user = createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const login = await user.auth.signInWithPassword(credentials);
    if (login.error || !login.data.user) throw new Error("REBUILD_LOGIN");
    const own = await user.from("profiles").select("owner_id").single();
    if (own.error || own.data?.owner_id !== login.data.user.id) throw new Error("REBUILD_PROFILE");
    await user.auth.signOut({scope:"local"});
  }
  reconstruction = { freshReconstruction: true, migrations: versions, ordinaryUserProfileChecks: 2 };
} catch (error) {
  const reasons = {REBUILD_DISK_HEADROOM:"insufficient_disk_headroom",REBUILD_CONFIG:"unexpected_project_config",REBUILD_HISTORY:"migration_history_mismatch",REBUILD_PRIVILEGE:"unexpected_guard_privileges",REBUILD_FIXTURE:"fixture_creation_failed",REBUILD_LOGIN:"ordinary_login_failed",REBUILD_PROFILE:"ordinary_profile_failed"};
  console.error(JSON.stringify({ blockedOrFailed:true, ...safeDiagnostic(error,operation), reason:reasons[error?.message],diskHeadroomRequiredGiB:error?.message==="REBUILD_DISK_HEADROOM"?5:undefined }));
  process.exitCode = 1;
} finally {
  try { await sql?.end({timeout:2}); } catch { /* Stop the owned stack even if its connection cannot close. */ }
  if (started) {
    try { cli(["stop","--project-id",project,"--no-backup"]); }
    catch { console.error(JSON.stringify({cleanupUnconfirmed:true,disposableProject:project,retainedStackTargeted:false})); cleanupFailed=true; process.exitCode=1; }
  }
  if (directory && !cleanupFailed) rmSync(directory,{recursive:true,force:true});
  if (reconstruction && !cleanupFailed) {
    operation = "retained_readonly_comparison";
    try {
      const unchanged = retainedBefore === await retainedFingerprint();
      console.log(JSON.stringify({ ...reconstruction, disposableCleanupConfirmed: true, retainedSnapshotUnchanged: unchanged,
        retainedSnapshotScope: "profiles, conversation/memory/reminder/series/voice/task domain and private receipt/outbox/test tables, queue jobs/config/version when present, admissions, revocations, Auth account metadata and migrations; excludes volatile sessions/stats" }));
      if (!unchanged) {
        console.error(JSON.stringify({ operation, reason: "retained_snapshot_changed_or_concurrent_activity", attributionEstablished: false }));
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(JSON.stringify({ ...safeDiagnostic(error, operation), retainedComparisonConfirmed: false }));
      process.exitCode = 1;
    }
  }
  try { await retainedSql?.end({ timeout: 2 }); } catch { process.exitCode = 1; }
}
