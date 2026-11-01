import type { CookieOptions } from "@supabase/ssr";

export function sessionCookieOptions(origin: string): CookieOptions {
  return { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/" };
}
export function persistSessionCookies(
  values: { name: string; value: string; options: CookieOptions }[],
  set: (name: string, value: string, options: CookieOptions) => void,
  readOnly: boolean,
) {
  // Only Server Components opt out; Proxy refreshes cookies for their requests.
  // Route Handlers must propagate write failures instead of reporting success.
  if (!readOnly) values.forEach(({ name, value, options }) => set(name, value, options));
}
