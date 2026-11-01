import { describe, expect, it } from "vitest";
import { persistSessionCookies, sessionCookieOptions } from "../../src/lib/session-cookies";

describe("session cookie persistence boundary", () => {
  it.each([["http://127.0.0.1:3000", false], ["https://localhost:3000", true]] as const)("applies safe flags for %s", (origin, secure) => {
    expect(sessionCookieOptions(origin)).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure });
  });
  const changes = [{ name: "fixture", value: "NONCREDENTIAL_SENTINEL", options: sessionCookieOptions("http://127.0.0.1:3000") }];
  it("propagates Route Handler write failure so login cannot report cookie persistence", () => {
    expect(() => persistSessionCookies(changes, () => { throw new Error("cookie write failed"); }, false)).toThrow("cookie write failed");
  });
  it("explicitly read-only Server Components do not attempt cookie writes", () => {
    let called = false;
    persistSessionCookies(changes, () => { called = true; throw new Error("not writable"); }, true);
    expect(called).toBe(false);
  });
});
