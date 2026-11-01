import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getConfig } from "./config";
import type { Database } from "./database.types";
import { reportDatabaseFailure } from "./diagnostics";
import { sessionCookieOptions, persistSessionCookies } from "./session-cookies";

export async function supabase({ readOnly = false }: { readOnly?: boolean } = {}) {
  const config = getConfig();
  const jar = await cookies();
  return createServerClient<Database>(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: sessionCookieOptions(config.APP_ORIGIN),
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => persistSessionCookies(values, (name, value, options) => jar.set(name, value, options), readOnly),
    },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) },
  });
}

export async function identity(options: { readOnly?: boolean } = {}) {
  const client = await supabase(options);
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  // RLS also verifies live Auth session, confirmed email, admission, and revocation.
  const { data: profile, error: profileError } = await client.from("profiles").select("*")
    .eq("owner_id", data.claims.sub).maybeSingle();
  if (profileError) {
    reportDatabaseFailure("profile_read", profileError);
    throw new Error("Account service unavailable. Please try again.");
  }
  if (!profile) return null;
  return { client, profile };
}
