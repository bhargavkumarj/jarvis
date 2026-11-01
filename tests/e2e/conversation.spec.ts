import { browserOrigin } from "../support/browser-origin";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { localFixtures } from "../support/local-fixtures";
let fixture: Awaited<ReturnType<typeof localFixtures>>;
test.beforeAll(async () => { fixture = await localFixtures(); });
test.afterAll(async () => { await fixture?.close(); });
async function login(page: Page, name: "alex" | "sam" = "alex") {
  await page.goto("/sign-in"); await page.getByLabel("Email address").fill(fixture.users[name].email);
  try { await page.getByLabel("Password", { exact: true }).fill(fixture.users[name].password); } catch { throw new Error("Credential input unavailable; value suppressed."); }
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/assistant$/);
}
async function send(page: Page, text: string, temporary = false) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(temporary ? "Temporary response complete" : /Response saved|Response confirmed complete/);
}
test("explicit review, approved continuity, correction and deletion use real persisted state", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", () => errors.push("runtime error"));
  await login(page);
  await send(page, "Remember this: beverage fixture: jasmine");
  await page.getByRole("link", { name: "Memory", exact: true }).click();
  const proposal = page.getByRole("article", { name: "Pending memory proposal" });
  await expect(proposal.getByLabel("Proposed memory content")).toHaveValue("beverage fixture: jasmine");
  await expect(page.getByText("No approved memories yet.", { exact: false })).toBeVisible();
  await proposal.getByRole("button", { name: "Inspect source message" }).click();
  await expect(proposal.locator("blockquote")).toContainText("Remember this: beverage fixture: jasmine");
  await proposal.getByLabel("Proposed memory content").fill("beverage fixture: hibiscus");
  await expect(proposal.getByRole("button", { name: "Approve exact memory" })).toBeDisabled();
  await proposal.getByRole("button", { name: "Save proposal edit" }).click();
  await expect(page.getByRole("status")).toContainText("Change saved");
  await proposal.getByRole("button", { name: "Approve exact memory" }).click();
  await expect(page.getByRole("status")).toContainText("Memory approved and active");
  const memory = page.getByRole("article", { name: "Approved memory", exact: true });
  await memory.getByLabel("Approved memory content").fill("beverage fixture: rose");
  await memory.getByRole("button", { name: "Save approved correction" }).click();
  await expect(page.getByRole("status")).toContainText("Change saved");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
  const saved = await (await page.request.get("/api/v1/memories")).json();
  const source = saved.memories[0].source_message_id;
  await page.getByRole("link", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Retained conversation created");
  await send(page, "Which beverage fixture?");
  await expect(page.locator(".text-turn").last()).toContainText("Used approved memories: beverage fixture: rose");
  await page.reload(); await expect(page.locator(".conversation-history")).toContainText("Conversation");
  // Reload intentionally returns to the empty composer; use history to reopen.
  await page.locator(".history-list button").first().click();
  await expect(page.locator(".text-turn").last()).toContainText("beverage fixture: rose");
  await page.getByRole("link", { name: "Memory", exact: true }).click();
  await memory.getByRole("button", { name: "Delete memory", exact: true }).click();
  await memory.getByRole("button", { name: "Confirm memory deletion" }).click();
  await expect(page.getByRole("status")).toContainText("Memory deleted and excluded");
  expect((await page.request.get(`/api/v1/messages/${source}`)).status()).toBe(200);
  await page.getByRole("link", { name: "Assistant", exact: true }).click();
  await send(page, "beverage fixture");
  await expect(page.locator(".text-turn").last()).not.toContainText("rose");
  await expect(page.locator(".text-turn").last()).not.toContainText("Used approved memories");
  await page.getByRole("button", { name: "Delete conversation", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Conversation removed");
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("region", { name: "Transcript", exact: true }).focus();
  await expect(page.getByRole("region", { name: "Transcript", exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
});
test("temporary content is volatile; failure, interruption and cancellation never complete a partial answer", async ({ page }) => {
  await login(page);
  const owner = (await (await page.request.get("/api/v1/preferences")).json()).profile.owner_id;
  const before = await fixture.sql`select (select count(*) from public.messages where owner_id=${owner}) as turns,(select count(*) from public.conversations where owner_id=${owner}) as conversations`;
  const sentinel = `temporary-${crypto.randomUUID()}`;
  await page.getByRole("button", { name: "Temporary conversation" }).click();
  await send(page, `Remember this: ${sentinel}`, true);
  await expect(page.locator(".text-turn").first()).toContainText("saving is disabled");
  expect(await page.evaluate((s) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(s), sentinel)).toBe(false);
  const after = await fixture.sql`select (select count(*) from public.messages where owner_id=${owner}) as turns,(select count(*) from public.conversations where owner_id=${owner}) as conversations`;
  expect(JSON.stringify(before) === JSON.stringify(after)).toBe(true);
  const [absence] = await fixture.sql`select (select count(*) from public.memory_proposals where content like ${`%${sentinel}%`})+(select count(*) from public.memories where content like ${`%${sentinel}%`})+(select count(*) from public.messages where user_text like ${`%${sentinel}%`} or assistant_text like ${`%${sentinel}%`}) as count`;
  expect(Number(absence.count)).toBe(0);
  await page.reload(); await expect(page.getByText(sentinel, { exact: false })).toHaveCount(0);
  for (const command of ["/mock fail", "/mock interrupt"]) {
    await page.getByLabel("Message", { exact: true }).fill(command); await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator(".transcript-workspace").getByRole("alert")).toContainText("did not complete");
    await expect(page.locator(".text-turn").last()).toContainText("failed");
    const list = await (await page.request.get("/api/v1/conversations")).json();
    const id = list.conversations[0].id;
    const first = await (await page.request.get(`/api/v1/conversations/${id}`)).json();
    await page.getByRole("button", { name: "Retry last request", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
    await expect(page.locator(".transcript-workspace").getByRole("alert")).toContainText("did not complete");
    const retried = await (await page.request.get(`/api/v1/conversations/${id}`)).json();
    expect(retried.messages.length).toBe(first.messages.length);
    expect(retried.messages.every((m: { assistant_text: string; state: string }) => m.state === "complete" || m.assistant_text === "")).toBe(true);
  }
  await page.getByLabel("Message", { exact: true }).fill("/mock slow"); await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Mock assistant · streaming, unconfirmed")).toBeVisible();
  await expect(page.locator(".text-turn").last()).toContainText("Demonstration from");
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("No complete answer");
  await send(page, "/mock unauthorized");
  await expect(page.locator(".text-turn").last()).toContainText("unsupported");
});
test("other-account endpoint IDs, streamed actions and stale approvals are denied without mutation", async ({ page, browser }) => {
  await login(page);
  await send(page, "Remember: browser conflict fixture: blue");
  const first = await (await page.request.get("/api/v1/memories")).json();
  const proposal = first.proposals[0];
  const conversations = await (await page.request.get("/api/v1/conversations")).json();
  const conversation = conversations.conversations[0].id;
  const other = await browser.newContext({ baseURL: browserOrigin });
  try {
    const bp = await other.newPage(); await login(bp, "sam");
    expect((await bp.request.get(`/api/v1/conversations/${conversation}`)).status()).toBe(404);
    expect((await bp.request.get(`/api/v1/messages/${proposal.source_message_id}`)).status()).toBe(404);
    const headers = { Origin: browserOrigin };
    expect((await bp.request.delete(`/api/v1/conversations/${conversation}`, { headers, data: {} })).status()).toBe(404);
    expect((await bp.request.post("/api/v1/turns", { headers, data: { mode: "retained", conversation_id: conversation, request_id: crypto.randomUUID(), text: "foreign stream attempt" } })).status()).toBe(404);
    expect((await bp.request.post("/api/v1/memories", { headers, data: { action: "approve", id: proposal.id, version: proposal.version, content: proposal.content } })).status()).toBe(404);
    expect((await bp.request.get(`/api/v1/memories?owner_id=${proposal.owner_id}`)).status()).toBe(400);
  } finally { await other.close(); }
  await page.getByRole("link", { name: "Memory", exact: true }).click();
  // Wait for the client-side route and data before reloading it. A click alone
  // can return before mobile RSC navigation replaces the previous screen.
  await expect(page).toHaveURL(/\/memory$/);
  await expect(page.getByRole("article", { name: "Pending memory proposal" }).getByLabel("Proposed memory content")).toHaveValue(proposal.content);
  const headers = { Origin: browserOrigin };
  expect((await page.request.post("/api/v1/memories", { headers, data: { action: "edit_proposal", id: proposal.id, version: proposal.version, content: proposal.content } })).status()).toBe(200);
  expect((await page.request.post("/api/v1/memories", { headers, data: { action: "approve", id: proposal.id, version: proposal.version, content: proposal.content } })).status()).toBe(409);
  const afterStale = await (await page.request.get("/api/v1/memories")).json();
  expect(afterStale.proposals.some((p: { id: string; version: number; state: string }) => p.id === proposal.id && p.version === proposal.version + 1 && p.state === "pending")).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/\/memory$/);
  const review = page.getByRole("article", { name: "Pending memory proposal" });
  await expect(review.getByLabel("Proposed memory content")).toHaveValue(proposal.content);
  await expect(review).toContainText(`version ${proposal.version + 1}`);
  await review.getByRole("button", { name: "Approve exact memory" }).click();
  await expect(page.getByRole("status")).toContainText("Memory approved");
  await page.getByRole("link", { name: "Assistant", exact: true }).click();
  await send(page, "Remember: browser conflict fixture: red");
  await page.getByRole("link", { name: "Memory", exact: true }).click();
  const conflicting = page.getByRole("article", { name: "Pending memory proposal" });
  await expect(conflicting).toContainText("Conflicting approved memory");
  await expect(conflicting.getByRole("button", { name: "Approve exact memory" })).toBeDisabled();
  await conflicting.getByRole("checkbox").check();
  await conflicting.getByRole("button", { name: "Approve exact memory" }).click();
  await expect(page.getByRole("status")).toContainText("Memory approved");
});
