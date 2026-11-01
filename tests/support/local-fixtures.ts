import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { localStatus } from "../../scripts/local-runtime.mjs";
import { safeDiagnostic } from "../../scripts/safe-diagnostics.mjs";

// Each suite owns new, random synthetic identities. Never reset or reuse the
// user's alex/sam/recovery accounts or .local/users.json.
export async function localFixtures() {
  let status: ReturnType<typeof localStatus>;
  try { status = localStatus(); }
  catch { throw new Error("BLOCKED: real local Supabase is required. Check pnpm local:audit in a permitted terminal. No database reset is needed."); }
  const sql = postgres(status.DB_URL, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = randomBytes(12).toString("hex");
  const fixture = (name: string) => ({ email: `m1-${run}-${name}@example.test`, password: randomBytes(24).toString("base64url") });
  const users = { alex: fixture("alex"), sam: fixture("sam"), recovery: fixture("recovery") };
  async function close() {
    let failed = false;
    // Exact aliases from THIS run only, no prefix-based bulk deletion.
    for (const { email } of Object.values(users)) {
      try {
        const rows = await sql`select id from auth.users where email = ${email}`;
        for (const row of rows) {
          const { error } = await admin.auth.admin.deleteUser(row.id);
          if (error) failed = true;
          if(!error){
            // Only this run's deleted fixture identity; no retained-account sweep.
            for(const table of ['privacy_jobs','privacy_events','privacy_requests']){
              const [exists]=await sql`select to_regclass(${`private.${table}`}) is not null as present`;
              if(exists.present)await sql.unsafe(`delete from private.${table} where owner_id=$1`,[row.id]);
            }
          }
        }
        await sql`delete from private.admissions where email = ${email} and owner_id is null`;
      } catch { failed = true; }
    }
    await sql.end({ timeout: 2 });
    if (failed) throw new Error("Local test fixture cleanup incomplete; retained development accounts were not targeted. Inspect only this suite's synthetic fixtures locally.");
  }
  try {
    for (const { email } of Object.values(users)) await sql`insert into private.admissions(email) values (${email})`;
    for (const user of [users.alex, users.sam]) {
      const { error } = await admin.auth.admin.createUser({ ...user, email_confirm: true });
      if (error) throw new Error("Synthetic fixture Auth creation failed.");
    }
    return { users, status, sql, close };
  } catch (error) {
    const diagnostic = safeDiagnostic(error, "isolated_fixture_setup");
    await close().catch(() => {});
    // eslint-disable-next-line preserve-caught-error -- Raw SQL/Auth causes may include credentials or request bodies.
    throw new Error(`Real local fixture setup failed: ${JSON.stringify(diagnostic)}. No mocks or retained-database reset substitute for this check.`);
  }
}
