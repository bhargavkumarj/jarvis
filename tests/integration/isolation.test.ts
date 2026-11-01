import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { localStatus } from "../../scripts/local-runtime.mjs";
import type { Database } from "../../src/lib/database.types";
import { localFixtures } from "../support/local-fixtures";

describe("real local Auth + Postgres RLS (no authorization mocks)", () => {
  let a: SupabaseClient<Database>, b: SupabaseClient<Database>, anon: SupabaseClient<Database>;
  let ownerA: string, ownerB: string;
  let status: ReturnType<typeof localStatus>;
  let credentials: Record<string, { email: string; password: string }>;
  let sql: ReturnType<typeof postgres>;
  let fixtures: Awaited<ReturnType<typeof localFixtures>>;
  let sessionB: string;
  let tokenA: string;
  const client = () => createClient<Database>(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  beforeAll(async () => {
    fixtures = await localFixtures();
    ({ status, users: credentials, sql } = fixtures);
    a = client(); b = client(); anon = client();
    const ra = await a.auth.signInWithPassword(credentials.alex);
    const rb = await b.auth.signInWithPassword(credentials.sam);
    if (ra.error || rb.error || !ra.data.user || !rb.data.user) throw new Error("Synthetic sign-in failed; fixture setup requires review.");
    ownerA = ra.data.user.id; ownerB = rb.data.user.id;
    if (!ra.data.session) throw new Error("Fixture sign-in did not establish a session.");
    tokenA = ra.data.session.access_token;
    const claimsB = await b.auth.getClaims();
    if (claimsB.error || typeof claimsB.data?.claims.session_id !== "string") throw new Error("Could not verify fixture session identity.");
    sessionB = claimsB.data.claims.session_id;
  });
  afterAll(async () => { await fixtures?.close(); });

  it("migration leaves a restricted definer owner without application membership or schema creation", async () => {
    // Catalog inspection validates migration output, not user authorization/RLS.
    const [role] = await sql`select rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname = 'jarvis_auth_guard'`;
    expect(role).toEqual({ rolcanlogin: false, rolinherit: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
    const [privileges] = await sql`select
      has_schema_privilege('jarvis_auth_guard', 'public', 'CREATE') as public_create,
      has_schema_privilege('jarvis_auth_guard', 'private', 'CREATE') as private_create,
      pg_has_role('anon', 'jarvis_auth_guard', 'SET') as anon_set,
      pg_has_role('authenticated', 'jarvis_auth_guard', 'SET') as authenticated_set,
      pg_has_role('authenticator', 'jarvis_auth_guard', 'SET') as authenticator_set`;
    expect(Object.values(privileges)).toEqual([false, false, false, false, false]);
    const functions = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner where r.rolname = 'jarvis_auth_guard'
      and ((n.nspname = 'private' and p.proname in ('has_access', 'admit_user', 'create_profile'))
        or (n.nspname = 'public' and p.proname = 'revoke_current_session')) and p.prosecdef`;
    expect(functions).toHaveLength(4);
    const [bridge] = await sql`select p.prosecdef, r.rolname as owner from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
      where n.nspname = 'private' and p.proname = 'auth_session_is_active'`;
    expect(bridge).toEqual({ prosecdef: true, owner: 'postgres' });
    const [bridgeGrants] = await sql`select
      has_function_privilege('anon', 'private.auth_session_is_active()', 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', 'private.auth_session_is_active()', 'EXECUTE') as authenticated_execute,
      has_function_privilege('jarvis_auth_guard', 'private.auth_session_is_active()', 'EXECUTE') as guard_execute,
      has_table_privilege('jarvis_auth_guard', 'auth.users', 'SELECT') as guard_users,
      has_table_privilege('jarvis_auth_guard', 'auth.sessions', 'SELECT') as guard_sessions`;
    expect(bridgeGrants).toEqual({ anon_execute: false, authenticated_execute: false, guard_execute: true, guard_users: false, guard_sessions: false });
  });

  it("A and B can read/update only their own preferences", async () => {
    expect(ownerA).not.toBe(ownerB);
    const write = await a.from("profiles").update({ assistant_name: "Aster" }).eq("owner_id", ownerA).select("assistant_name").single();
    expect(write.error?.code).toBeUndefined(); expect(write.data?.assistant_name).toBe("Aster");
    const reload = await a.from("profiles").select("assistant_name").eq("owner_id", ownerA).single();
    expect(reload.data?.assistant_name).toBe("Aster");
    const ownB = await b.from("profiles").select("owner_id");
    expect(ownB.data?.map((row) => row.owner_id)).toEqual([ownerB]);
    const writeB = await b.from("profiles").update({ assistant_name: "Birch" }).eq("owner_id", ownerB).select("assistant_name").single();
    expect(writeB.error).toBeNull();
    expect((await b.from("profiles").select("assistant_name").single()).data?.assistant_name).toBe("Birch");
  });
  it("guard helpers deny empty or absent request identity instead of failing Auth schema lookup", async () => {
    // Direct role regression, not a substitute for the ordinary-user RLS tests.
    for (const claims of ["", "{}"]) {
      await sql.begin(async (transaction) => {
        await transaction.unsafe("set local role jarvis_auth_guard");
        await transaction`select set_config('request.jwt.claims', ${claims}, true)`;
        const [result] = await transaction`select private.has_access() as allowed`;
        expect(result.allowed).toBe(false);
      });
    }
    await sql.begin(async (transaction) => {
      await transaction.unsafe("set local role jarvis_auth_guard");
      await transaction`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerA, session_id: sessionB })}, true)`;
      expect((await transaction`select private.has_access() as allowed`)[0].allowed).toBe(false);
    });
    // Invalid SQL context must deny; JSON/UUID errors are not successful access.
    for (const claims of ["{invalid-json", JSON.stringify({ sub: "invalid-uuid", session_id: sessionB })]) {
      let code = "";
      try {
        await sql.begin(async (transaction) => {
          await transaction.unsafe("set local role jarvis_auth_guard");
          await transaction`select set_config('request.jwt.claims', ${claims}, true)`;
          await transaction`select private.has_access()`;
        });
      } catch (error) { code = (error as { code?: string }).code ?? ""; }
      expect(code).toBe("22P02");
    }
  });
  it("the exposed API cannot call private helpers or overwrite authorization context", async () => {
    for (const [name, args] of [
      ["has_access", {}], ["auth_session_is_active", {}],
      ["set_config", { setting_name: "request.jwt.claims", new_value: "{}", is_local: true }],
    ] as const) {
      const response = await (a as SupabaseClient).rpc(name, args);
      expect(response.data).toBeNull(); expect(response.error?.code).toBe("PGRST202");
    }
    expect((await a.from("profiles").select("owner_id")).data?.every((row) => row.owner_id === ownerA)).toBe(true);
  });
  it("session refresh retains verified ownership", async () => {
    const refreshed = await a.auth.refreshSession();
    expect(refreshed.error).toBeNull(); expect(!!refreshed.data.session).toBe(true);
    const own = await a.from("profiles").select("owner_id").single();
    expect(own.error).toBeNull(); expect(own.data?.owner_id === ownerA).toBe(true);
  });
  it("identifier substitution cannot read or update another user's row", async () => {
    const before = await a.from("profiles").select("*").single();
    expect((await b.from("profiles").select("*").eq("owner_id", ownerA)).data).toEqual([]);
    const write = await b.from("profiles").update({ assistant_name: "Stolen" }).eq("owner_id", ownerA).select("owner_id");
    expect(write.data).toEqual([]);
    expect((await a.from("profiles").select("assistant_name").single()).data?.assistant_name).toBe("Aster");
    const after = await a.from("profiles").select("*").single();
    expect(JSON.stringify(after.data) === JSON.stringify(before.data)).toBe(true);
  });
  it("cannot create for another owner, reassign ownership or delete profiles", async () => {
    expect((await a.from("profiles").insert({ owner_id: ownerB })).error).not.toBeNull();
    expect((await a.from("profiles").update({ owner_id: ownerB }).eq("owner_id", ownerA)).error).not.toBeNull();
    expect((await b.from("profiles").delete().eq("owner_id", ownerA)).error).not.toBeNull();
    expect((await a.from("profiles").delete().eq("owner_id", ownerA)).error).not.toBeNull();
    expect((await a.from("profiles").select("assistant_name").single()).data?.assistant_name).toBe("Aster");
    expect((await b.from("profiles").select("assistant_name").single()).data?.assistant_name).toBe("Birch");
  });
  it("anonymous and forged-token database access is denied", async () => {
    expect((await anon.from("profiles").select("*")).error).not.toBeNull();
    expect((await anon.from("profiles").insert({ owner_id: ownerA })).error).not.toBeNull();
    expect((await anon.rpc("revoke_current_session")).error).not.toBeNull();
    const forged = createClient<Database>(status.API_URL, status.ANON_KEY, { global: { headers: { Authorization: "Bearer invalid-token" } }, auth: { persistSession: false } });
    expect((await forged.from("profiles").select("*")).error).not.toBeNull();
    const [header, payload, signature] = tokenA.split(".");
    const tamperedPayload = { ...JSON.parse(Buffer.from(payload, "base64url").toString()), sub: ownerB };
    const tamperedToken = `${header}.${Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url")}.${signature}`;
    const tampered = createClient<Database>(status.API_URL, status.ANON_KEY, { global: { headers: { Authorization: `Bearer ${tamperedToken}` } }, auth: { persistSession: false } });
    const denied = await tampered.from("profiles").select("owner_id");
    expect(denied.data).toBeNull(); expect([401, 403].includes(denied.status)).toBe(true);
  });
  it("database validation applies even when the application is bypassed", async () => {
    const before = await a.from("profiles").select("*").single();
    for (const patch of [{ timezone: "Mars/Olympus" }, { timezone: "EST" }, { assistant_name: " " }, { display_name: "x".repeat(61) }, { display_name: "A\nB" }]) {
      expect((await a.from("profiles").update(patch).eq("owner_id", ownerA)).error).not.toBeNull();
      const after = await a.from("profiles").select("*").single();
      expect(JSON.stringify(after.data) === JSON.stringify(before.data)).toBe(true);
    }
    expect((await a.from("profiles").select("assistant_name").single()).data?.assistant_name).toBe("Aster");
  });
  it("direct signup cannot bypass the admission policy", async () => {
    const denied = await anon.auth.signUp({ email: "not-admitted@example.test", password: credentials.recovery.password });
    expect(denied.error).not.toBeNull(); expect(denied.data.session).toBeNull();
  });
  it("disabled admission immediately blocks an existing user JWT", async () => {
    try {
      await sql`update private.admissions set enabled = false where owner_id = ${ownerB}`;
      expect((await b.from("profiles").select("*")).data).toEqual([]);
    } finally { await sql`update private.admissions set enabled = true where owner_id = ${ownerB}`; }
  });
  it("expired live sessions cannot use a still-signed access token", async () => {
    const original = await sql`select id, not_after from auth.sessions where id = ${sessionB}`;
    try {
      await sql`update auth.sessions set not_after = now() - interval '1 minute' where id = ${sessionB}`;
      expect((await b.from("profiles").select("owner_id")).data).toEqual([]);
    } finally {
      for (const row of original) await sql`update auth.sessions set not_after = ${row.not_after} where id = ${row.id}`;
    }
  });
  it("revocation denies the old signed JWT even before token expiry", async () => {
    const c = client();
    const login = await c.auth.signInWithPassword(credentials.sam);
    if (login.error || !login.data.session) throw new Error("Synthetic session setup failed.");
    const replay = createClient<Database>(status.API_URL, status.ANON_KEY, { global: { headers: { Authorization: `Bearer ${login.data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    expect((await replay.from("profiles").select("owner_id")).data).toHaveLength(1);
    expect((await c.rpc("revoke_current_session")).error?.code).toBeUndefined();
    expect((await replay.from("profiles").select("owner_id")).data).toEqual([]);
    // Refresh must not bypass a revocation attached to the original session ID.
    await c.auth.refreshSession();
    const afterRefresh = await c.from("profiles").select("owner_id");
    if (afterRefresh.error) {
      expect([401, 403].includes(afterRefresh.status)).toBe(true);
      expect(afterRefresh.data).toBeNull();
    } else expect(afterRefresh.data).toEqual([]);
    await c.auth.signOut({ scope: "local" });
    expect((await c.from("profiles").select("*")).error).not.toBeNull();
  });
});
