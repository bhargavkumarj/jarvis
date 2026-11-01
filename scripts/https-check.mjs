// Runs real browser/DB checks with synthetic per-run identities. No artifacts.
import { execFileSync, fork } from "node:child_process";
import { mkdtempSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { get } from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { clearTimeout } from "node:timers";
import { chromium, expect } from "@playwright/test";
import { localFixtures } from "../tests/support/local-fixtures.ts";
import { root } from "./local-runtime.mjs";
import { safeDiagnostic } from "./safe-diagnostics.mjs";

const origin = "https://127.0.0.1:3443";
let operation = "https_listener_preflight";
let directory, child, fixtures, browser, context, succeeded = false;
const checks = [];
async function check(name, action) {
  operation = name;
  await action();
  checks.push(name);
}
async function listenPreflight() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(3443, "127.0.0.1", () => probe.close(resolve));
  });
}
try {
  await listenPreflight();
  operation = "https_build_prerequisite";
  if (!existsSync(new URL(".next/BUILD_ID", root))) throw new Error("Production build required");
  operation = "https_isolated_fixtures";
  fixtures = await localFixtures();
  operation = "https_ephemeral_certificate";
  directory = mkdtempSync(join(tmpdir(), "jarvis-m1-https-"));
  chmodSync(directory, 0o700);
  const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
  chmodSync(key, 0o600); chmodSync(cert, 0o600);
  operation = "https_server_start";
  child = fork(new URL("https-server.mjs", import.meta.url), [], {
    cwd: root, stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { ...process.env, NODE_ENV: "production", JARVIS_MOCK_ONLY: "1", APP_ORIGIN: origin, M1_TLS_KEY: key, M1_TLS_CERT: cert, NEXT_TELEMETRY_DISABLED: "1" },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("TLS test server timeout")), 30_000);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("TLS test server unavailable")); });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error("TLS test server exited")); });
    child.once("message", (message) => {
      clearTimeout(timeout);
      if (message?.ready === true) resolve(); else reject(new Error("Unexpected test server state"));
    });
  });
  await check("https_certificate_and_transport", () => new Promise((resolve, reject) => {
    // Trust only this ephemeral certificate for this one Node request.
    const request = get(`${origin}/sign-in`, { ca: readFileSync(cert), timeout: 5000 }, (response) => {
      response.resume();
      response.on("end", () => response.statusCode === 200 ? resolve() : reject(new Error("HTTPS not ready")));
    });
    request.on("timeout", () => request.destroy(new Error("HTTPS timeout")));
    request.on("error", reject);
  }));
  operation = "https_chromium_start";
  browser = await chromium.launch();
  // No OS trust-store change or global TLS bypass. Only this synthetic context
  // accepts the self-signed certificate; Node above validates it explicitly.
  context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let runtimeErrors = 0;
  page.on("pageerror", () => { runtimeErrors++; });
  await check("https_unauthenticated_denial", async () => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
    expect((await page.request.get("/api/v1/preferences")).status()).toBe(401);
  });
  const owners = [];
  for (const name of ["alex", "sam"]) {
    await check(`https_${name}_signin_cookie_flags`, async () => {
      await page.goto("/sign-in");
      await page.getByLabel("Email address").fill(fixtures.users[name].email);
      await page.getByLabel("Password", { exact: true }).fill(fixtures.users[name].password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/assistant$/);
      const cookies = (await context.cookies()).filter((cookie) => cookie.name.includes("auth-token"));
      expect(cookies.length > 0).toBe(true);
      expect(cookies.every((cookie) => cookie.secure && cookie.httpOnly && cookie.sameSite === "Lax" && cookie.path === "/")).toBe(true);
      expect(await page.evaluate(() => globalThis.document.cookie.includes("auth-token"))).toBe(false);
    });
    await check(`https_${name}_preferences_persistence`, async () => {
      await page.goto("/settings");
      await page.getByLabel("Display name").fill(`HTTPS ${name} — synthetic`);
      await page.getByRole("button", { name: "Save preferences" }).click();
      await expect(page.getByRole("form", {name:"Personal and assistant preferences"}).getByRole("status")).toHaveText("Preferences saved.");
      await page.reload();
      await expect(page.getByLabel("Display name")).toHaveValue(`HTTPS ${name} — synthetic`);
      const response = await page.request.get("/api/v1/preferences");
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"].includes("no-store")).toBe(true);
      owners.push((await response.json()).profile.owner_id);
      expect((await page.request.patch("/api/v1/preferences", { headers: { Origin: "https://attacker.invalid" }, data: {} })).status()).toBe(403);
    });
    await check(`https_${name}_signout_denial`, async () => {
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/sign-in/);
      expect((await page.request.get("/api/v1/preferences")).status()).toBe(401);
      await page.goto("/settings"); await expect(page).toHaveURL(/\/sign-in/);
    });
  }
  await check("https_no_cross_user_or_runtime_leak", async () => {
    expect(owners.length === 2 && owners[0] !== owners[1]).toBe(true);
    expect(runtimeErrors).toBe(0);
  });
  succeeded = true;
} catch (error) {
  console.error(JSON.stringify({ httpsRuntime: "blocked_or_failed", ...safeDiagnostic(error, operation), passedChecks: checks, credentialDetailsSuppressed: true }));
  process.exitCode = 1;
} finally {
  operation = "https_cleanup";
  let clean = true;
  try { await context?.close(); await browser?.close(); } catch { clean = false; }
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      for (let i = 0; i < 10 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
      if (child.exitCode === null && child.signalCode === null) clean = false;
    }
  }
  try { await fixtures?.close(); } catch { clean = false; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  if (!clean) { console.error(JSON.stringify({ operation, cleanupConfirmed: false })); process.exitCode = 1; }
  if (succeeded && clean) console.log(JSON.stringify({ httpsRuntime: "passed", origin, passedChecks: checks, checksPassed: checks.length, selfSignedBrowserContext: true, systemTrustChanged: false, cleanupConfirmed: true }));
}
