import "server-only";
import { ZodError } from "zod";
import { identity } from "../supabase";
import { getConfig } from "../config";
import { json, validMutation, readBody } from "../http";
export class ContentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function accountFor(request: Request, mutation = false) {
  if (mutation && !validMutation(request, getConfig().APP_ORIGIN)) throw new ContentError(403, "Request origin or format not accepted.");
  const account = await identity();
  if (!account) throw new ContentError(401, "Your session has ended. Please sign in again.");
  return account;
}
export function databaseResult<T>(result: { data: unknown; error: { code?: string } | null }): T {
  if (result.error) {
    const code = result.error.code;
    if (code === "42501") throw new ContentError(404, "This record is not available.");
    if (code === "40001" || code === "23505") throw new ContentError(409, "This record changed, conflicts with an approved memory, or is still running. Reload and review before retrying.");
    if (code === "54000") throw new ContentError(429, "The local account limit was reached. Remove unneeded conversations or proposals before retrying.");
    if (code === "22023" || code === "23514" || code === "22P02") throw new ContentError(422, "Check the content, version and identifiers.");
    throw new ContentError(503, "Local storage is unavailable or its schema is not ready. No result was confirmed. Check the setup and migration steps in the machine handoff.");
  }
  return result.data as T;
}
export function contentFailure(error: unknown) {
  if (error instanceof ZodError) return json({ error: "Use a valid record identifier." }, 422);
  return error instanceof ContentError ? json({ error: error.message }, error.status) : json({ error: "The request could not be completed. Check local services and try again." }, 503);
}
export async function contentBody(request: Request, maxBytes = 4096) {
  try { return await readBody(request, maxBytes); }
  catch { throw new ContentError(400, `Use valid JSON smaller than ${maxBytes} bytes.`); }
}
