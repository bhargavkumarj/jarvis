import { browserOrigin } from "../support/browser-origin";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { emailCode } from "./mailbox";
import { localFixtures } from "../support/local-fixtures";

let users: Record<string, { email: string; password: string }>;
let fixtures: Awaited<ReturnType<typeof localFixtures>>;
test.beforeAll(async () => {
  fixtures = await localFixtures(); users = fixtures.users;
});
test.afterAll(async () => { await fixtures?.close(); });
async function signIn(page: Page, name: "alex" | "sam") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(users[name].email);
  try { await page.getByLabel("Password", { exact: true }).fill(users[name].password); }
  catch { throw new Error("Password field unavailable; credential suppressed."); }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/assistant$/);
}
test("unauthenticated requests cannot access pages or private APIs", async ({ page, request }) => {
  await page.goto("/settings"); await expect(page).toHaveURL(/\/sign-in/);
  for (const path of ["preferences", "conversations", "memories", "reminders", `reminders/operations/${crypto.randomUUID()}`]) expect((await request.get(`/api/v1/${path}`)).status()).toBe(401);
  expect((await request.post("/api/v1/turns", { headers: { Origin: browserOrigin }, data: { mode: "temporary", request_id: crypto.randomUUID(), text: "synthetic anonymous attempt", history: [] } })).status()).toBe(401);
});

test("invited registration verifies email and recovers a password through the local mailbox", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Email address").fill(users.recovery.email);
  try { await page.getByLabel("Password", { exact: true }).fill(users.recovery.password); }
  catch { throw new Error("Password field unavailable; credential suppressed."); }
  await page.getByRole("button", { name: "Create invited account" }).click();
  await expect(page.getByRole("status")).toContainText("If this address is eligible");
  const originalMail = await emailCode(users.recovery.email, "Confirm your local account");
  const originalCode = originalMail.code;
  await page.goto("/verify");
  await page.getByLabel("Email address").fill(users.recovery.email);
  const [timestamps] = await fixtures.sql`select confirmation_sent_at from auth.users where email = ${users.recovery.email}`;
  try {
    // Expire only this run's disposable fixture; never alter retained accounts.
    await fixtures.sql`update auth.users set confirmation_sent_at = now() - interval '1 day' where email = ${users.recovery.email}`;
    try { await page.getByLabel("Email code").fill(originalCode); } catch { throw new Error("Code field unavailable; credential suppressed."); }
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("invalid, expired, or already used");
  } finally {
    await fixtures.sql`update auth.users set confirmation_sent_at = ${timestamps.confirmation_sent_at} where email = ${users.recovery.email}`;
  }
  // The isolated local Auth config enforces a one-second email resend interval.
  await page.waitForTimeout(1_100);
  await page.getByRole("button", { name: "Request a new code" }).click();
  await expect(page.getByRole("status")).toContainText("If the account is eligible");
  const { code } = await emailCode(users.recovery.email, "Confirm your local account", originalMail.id);
  try { await page.getByLabel("Email code").fill(code); }
  catch { throw new Error("Verification field unavailable; code suppressed."); }
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/verify");
  await page.getByLabel("Email address").fill(users.recovery.email);
  try { await page.getByLabel("Email code").fill(code); } catch { throw new Error("Code field unavailable; credential suppressed."); }
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("invalid, expired, or already used");
  await page.goto("/recover");
  await page.getByLabel("Email address").fill(users.recovery.email);
  await page.getByRole("button", { name: "Send recovery code" }).click();
  await expect(page.getByRole("status")).toContainText("If the account is eligible");
  const { code: recoveryCode } = await emailCode(users.recovery.email, "Reset your local password");
  await page.goto("/verify?mode=recovery");
  await page.getByLabel("Email address").fill(users.recovery.email);
  try { await page.getByLabel("Email code").fill(recoveryCode); }
  catch { throw new Error("Verification field unavailable; code suppressed."); }
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/\/reset-password$/);
  const newPassword = crypto.randomUUID() + crypto.randomUUID();
  try { await page.getByLabel("New password").fill(newPassword); }
  catch { throw new Error("Password field unavailable; credential suppressed."); }
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/notice=password-updated/);
  await page.getByLabel("Email address").fill(users.recovery.email);
  try { await page.getByLabel("Password", { exact: true }).fill(newPassword); }
  catch { throw new Error("Password field unavailable; credential suppressed."); }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/assistant$/);
});
test("real preferences persist, cookies are protected, forms and sign-out work", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", () => errors.push("runtime error"));
  await signIn(page, "alex");
  const cookies = await context.cookies();
  const authCookies = cookies.filter((cookie) => cookie.name.includes("auth-token"));
  expect(authCookies.length > 0).toBe(true);
  expect(authCookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax")).toBe(true);
  expect(authCookies.every((cookie) => !cookie.secure)).toBe(true); // Exact configured HTTP loopback test origin.
  expect(await page.evaluate(() => document.cookie.includes("auth-token"))).toBe(false);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Display name").fill("Alex — synthetic");
  await page.getByLabel("Assistant name").fill("Aster");
  await page.getByLabel("Timezone").fill("Asia/Kolkata");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("form", {name:"Personal and assistant preferences"}).getByRole("status")).toHaveText("Preferences saved.");
  await page.reload(); await expect(page.getByLabel("Display name")).toHaveValue("Alex — synthetic");
  await page.getByLabel("Timezone").fill("Mars/Olympus");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Use an IANA timezone such as Asia/Kolkata or UTC.", { exact: true })).toBeVisible();
  await page.reload();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const response = await page.request.get("/api/v1/preferences");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const beforeLogout = await response.json();
  const forged = await page.request.patch("/api/v1/preferences", { headers: { Origin: browserOrigin }, data: { ...beforeLogout.profile, owner_id: crypto.randomUUID() } });
  expect(forged.status()).toBe(422);
  const csrf = await page.request.patch("/api/v1/preferences", { headers: { Origin: "https://attacker.invalid" }, data: {} });
  expect(csrf.status()).toBe(403);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await page.request.get("/api/v1/preferences")).status()).toBe(401);
  await signIn(page, "sam");
  await page.goto("/settings");
  await expect(page.getByLabel("Display name")).not.toHaveValue("Alex — synthetic");
  const b = await page.request.get("/api/v1/preferences");
  expect((await b.json()).profile.owner_id).not.toBe(beforeLogout.profile.owner_id);
  expect((await page.request.get(`/api/v1/preferences?owner_id=${beforeLogout.profile.owner_id}`)).status()).toBe(400);
  await page.getByLabel("Display name").fill("Sam — synthetic");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("form", {name:"Personal and assistant preferences"}).getByRole("status")).toHaveText("Preferences saved.");
  await page.reload(); await expect(page.getByLabel("Display name")).toHaveValue("Sam — synthetic");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole("button", { name: "Save preferences" }).evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/settings"); await expect(page).toHaveURL(/\/sign-in/);
  expect((await page.request.get("/api/v1/preferences")).status()).toBe(401);
  expect(errors).toEqual([]);
});
