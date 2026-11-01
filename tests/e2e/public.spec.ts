import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public sign-in is accessible, responsive and keyboard navigable", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", () => errors.push("runtime error"));
  // A fast user must not lose input/clicks while client handlers are absent.
  let releaseScripts!: () => void;
  const scripts = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => { await scripts; await route.continue(); });
  try {
    await page.goto("/sign-in", { waitUntil: "commit" });
    await expect(page.getByLabel("Email address")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  } finally { releaseScripts(); }
  await expect(page.getByLabel("Email address")).toBeEnabled();
  await expect(page.getByRole("heading", { name: "A little space for you." })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  expect(await page.getByRole("link", { name: "Skip to content" }).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("registration and recovery explain access without fake capabilities", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByText("Only an email approved by the operator", { exact: false })).toBeVisible();
  await page.goto("/recover");
  await expect(page.getByRole("button", { name: "Send recovery code" })).toBeVisible();
  await page.goto("/verify?mode=recovery");
  await expect(page.getByLabel("Email code")).toBeVisible();
  await expect(page.getByText("Password recovery: use the newest", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a new code" })).toBeVisible();
  await page.getByRole("link", { name: "Use an account confirmation code instead" }).click();
  await expect(page.getByText("Account confirmation: use the newest", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
