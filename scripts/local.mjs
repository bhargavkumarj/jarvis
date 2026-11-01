import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localStatus, runLocalCli, root, diagnosticFetch } from "./local-runtime.mjs";

function privateFile(relative, value) {
  const path = new URL(relative, root);
  writeFileSync(path, value, { mode: 0o600 }); chmodSync(path, 0o600);
}
try {
  const command = process.argv[2];
  if (command === "start") { runLocalCli(["start"]); console.log("Local Supabase started. Run pnpm local:setup; credentials are not printed."); }
  else if (command === "stop") { runLocalCli(["stop"]); console.log("Local Supabase stopped; data retained."); }
  else if (command === "reset") {
    localStatus();
    runLocalCli(["db", "reset", "--local"]);
    console.log("Isolated local database recreated from migrations and synthetic admission seed. Run pnpm local:users.");
  } else if (command === "migrate") {
    localStatus();
    runLocalCli(["migration", "up", "--local"]);
    console.log("Pending local migrations applied. Existing accounts, preferences and domain records preserved.");
  } else if (command === "setup") {
    const status = localStatus();
    if (existsSync(new URL(".env.local", root))) throw new Error(".env.local already exists; preserving it. Review it locally or run pnpm local:users.");
    privateFile(".env.local", `APP_ORIGIN=http://127.0.0.1:3000\nSUPABASE_URL=${status.API_URL}\nSUPABASE_PUBLISHABLE_KEY=${status.ANON_KEY}\n`);
    console.log("Wrote .env.local with local-only application configuration. Run pnpm local:users.");
  } else if (command === "users") {
    const status = localStatus();
    const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const directory = new URL(".local/", root); mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const path = new URL(".local/users.json", root);
    const credentials = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : Object.fromEntries(["alex", "sam", "recovery"].map((name) => [name, { email: `${name}@example.test`, password: randomBytes(24).toString("base64url") }]));
    // Persist before account creation so a partial failure cannot lose a generated password.
    privateFile(".local/users.json", JSON.stringify(credentials, null, 2) + "\n");
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) throw new Error("Could not inspect synthetic local users.");
    for (const name of ["alex", "sam"]) {
      if (credentials[name]?.email !== `${name}@example.test`) throw new Error("Unexpected fixture identity. Refusing to modify users.");
      const existing = data.users.find((u) => u.email === credentials[name].email);
      if (existing) {
        const check = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
        const login = await check.auth.signInWithPassword(credentials[name]);
        if (login.error) throw new Error("Existing synthetic account differs from saved credentials; preserving it. Use password recovery or explicitly reset the isolated local database.");
        await check.auth.signOut({ scope: "local" });
        continue;
      }
      const result = await admin.auth.admin.createUser({ ...credentials[name], email_confirm: true });
      if (result.error) throw new Error("Could not create admitted synthetic user; verify migrations and seed.");
    }
    privateFile(".local/users.json", JSON.stringify(credentials, null, 2) + "\n");
    console.log("Synthetic accounts ready. View .local/users.json privately on this computer for passwords; never paste them into chat or commit them.");
  } else if (command === "diagnose") {
    // Local operator tooling only; never an application route or an auth bypass.
    console.log("Checking local Docker context and Supabase status (read-only; bounded waits)…");
    const status = localStatus();
    console.log("Runtime status available. Checking local Auth account states (5-second request timeout)…");
    const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: diagnosticFetch } });
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) throw new Error("Local Auth account inspection failed or timed out. Account/password state is unknown. No credentials were changed or provider details printed.");
    for (const name of ["alex", "sam", "recovery"]) {
      const account = data.users.find((user) => user.email === `${name}@example.test`);
      console.log(`${name}@example.test: ${!account ? "not found in this returned account page; registration state is unconfirmed" : account.email_confirmed_at ? "email confirmed; use password sign-in or recovery" : "email unconfirmed; request an account confirmation code"}`);
    }
    console.log("Checking local Mailpit (5-second request timeout)…");
    try {
      const response = await fetch("http://127.0.0.1:54324/api/v1/messages", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Mailbox API unavailable");
      const mailbox = await response.json();
      const synthetic = (mailbox.messages ?? []).filter((message) => message.To?.some((to) => to.Address === "recovery@example.test"));
      console.log(`Mailpit reachable; recovery fixture messages in current result: ${synthetic.length}.`);
      const subjects = new Set(synthetic.map((message) => message.Subject));
      console.log(`Recovery fixture email kinds present: confirmation=${subjects.has("Confirm your local account")}, password-recovery=${subjects.has("Reset your local password")}.`);
    } catch { console.log("Mailpit API unavailable or unrecognized; check http://127.0.0.1:54324 locally."); }
    console.log("Read-only diagnostic finished. No passwords, keys, tokens, email bodies or account IDs printed.");
  } else if (command === "types") {
    localStatus();
    const types = runLocalCli(["gen", "types", "typescript", "--local", "--schema", "public"]);
    writeFileSync(new URL("src/lib/database.generated.ts", root), types);
    console.log("Generated src/lib/database.generated.ts. Review schema differences against database.types.ts before replacing its contract.");
  } else throw new Error("Choose start, stop, reset, migrate, setup, users, diagnose, or types.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local setup failed.");
  process.exitCode = 1;
}
