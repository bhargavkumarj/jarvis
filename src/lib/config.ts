import { z } from "zod";

function localUrl(value: string) {
  try {
    const u = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) &&
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password &&
      u.pathname === "/" && !u.search && !u.hash;
  } catch { return false; }
}
const schema = z.object({
  APP_ORIGIN: z.string().refine(localUrl),
  SUPABASE_URL: z.string().refine(localUrl),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20).refine((key) => {
    if (key.startsWith("sb_publishable_")) return true;
    try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; }
    catch { return false; }
  }),
});
export function parseConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path[0]))].join(", ");
    throw new Error(`Local setup needed: check ${names}. Run pnpm db:start then pnpm local:setup. Only local URLs and a publishable/anon key are accepted.`);
  }
  return { ...parsed.data, APP_ORIGIN: new URL(parsed.data.APP_ORIGIN).origin };
}
export const getConfig = () => parseConfig(process.env);
