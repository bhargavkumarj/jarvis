import { describe, expect, it } from "vitest";
import { preferencesSchema } from "../../src/lib/validation";
import { parseConfig } from "../../src/lib/config";
import { readBody, validMutation } from "../../src/lib/http";

const valid = { display_name: "Alex", assistant_name: "Pip", tone: "warm", timezone: "Asia/Kolkata", locale: "en-IN" };
describe("preferences boundary", () => {
  it("accepts supported values and trims names", () => expect(preferencesSchema.parse({ ...valid, display_name: " Alex " })).toEqual(valid));
  it.each(["owner_id", "user_id", "created_at", "role"])("rejects authority field %s", (key) => expect(preferencesSchema.safeParse({ ...valid, [key]: "other-user" }).success).toBe(false));
  it.each(["Mars/Olympus", "+05:30", "EST", "posix/Europe/London"])("rejects unsupported timezone %s", (timezone) => expect(preferencesSchema.safeParse({ ...valid, timezone }).success).toBe(false));
  it("rejects overlong names, blank assistant names, control characters, unknown tone and locale", () => {
    for (const patch of [{ display_name: "x".repeat(61) }, { assistant_name: " " }, { display_name: "A\nB" }, { tone: "unbounded" }, { locale: "xx" }]) expect(preferencesSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
describe("request integrity", () => {
  const request = (origin: string | null, type = "application/json", site = "same-origin") => new Request("http://127.0.0.1:3000/api/v1/preferences", { method: "PATCH", headers: { ...(origin ? { origin } : {}), "content-type": type, "sec-fetch-site": site } });
  it("allows same-origin JSON only", () => expect(validMutation(request("http://127.0.0.1:3000"), "http://127.0.0.1:3000")).toBe(true));
  it("denies missing/cross-site origins and form posts", () => {
    for (const r of [request(null), request("https://attacker.invalid"), request("null"), request("http://127.0.0.1:3000", "text/plain"), request("http://127.0.0.1:3000", "application/json", "cross-site")]) expect(validMutation(r, "http://127.0.0.1:3000")).toBe(false);
  });
  it("caps actual body bytes without Content-Length", async () => {
    await expect(readBody(new Request("http://localhost", { method: "POST", body: '"' + "x".repeat(4096) + '"' }))).rejects.toThrow("too large");
    await expect(readBody(new Request("http://localhost", { method: "POST", body: '{"tone":"warm"}' }))).resolves.toEqual({ tone: "warm" });
  });
});
describe("configuration fail closed", () => {
  // Noncredential sentinel; no actual signing key or provider token in fixtures.
  const env = { APP_ORIGIN: "http://127.0.0.1:3000", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_noncredential_test_sentinel" };
  it("allows local configuration", () => expect(parseConfig(env).APP_ORIGIN).toBe(env.APP_ORIGIN));
  it("rejects external endpoints and credential-shaped secrets without reflecting them", () => {
    const sensitive = "sb_secret_do_not_print_this_value";
    for (const patch of [{ SUPABASE_URL: "https://remote.supabase.co" }, { APP_ORIGIN: "https://attacker.invalid" }, { SUPABASE_PUBLISHABLE_KEY: sensitive }, { APP_ORIGIN: "http://user:password@localhost:3000" }]) {
      let message = ""; try { parseConfig({ ...env, ...patch }); } catch (e) { message = (e as Error).message; }
      expect(message).toContain("Local setup needed"); expect(message).not.toContain(sensitive); expect(message).not.toContain("password@");
    }
  });
});
