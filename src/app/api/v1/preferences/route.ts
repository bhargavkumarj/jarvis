import { identity } from "@/lib/supabase";
import { getConfig } from "@/lib/config";
import { json, readBody, validMutation } from "@/lib/http";
import { preferencesSchema } from "@/lib/validation";
import { reportDatabaseFailure } from "@/lib/diagnostics";

export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return json({ error: "This endpoint accepts no identifiers or filters." }, 400);
    const account = await identity();
    return account ? json({ profile: account.profile }) : json({ error: "Your session has ended. Please sign in again." }, 401);
  } catch { return json({ error: "Account service unavailable. Please check local setup and try again." }, 503); }
}

export async function PATCH(request: Request) {
  try {
    if (!validMutation(request, getConfig().APP_ORIGIN)) return json({ error: "Request origin or format not accepted." }, 403);
    if (new URL(request.url).search) return json({ error: "This endpoint accepts no identifiers or filters." }, 400);
    const account = await identity();
    if (!account) return json({ error: "Your session has ended. Please sign in again." }, 401);
    let body: unknown;
    try { body = await readBody(request); } catch { return json({ error: "Use a valid request smaller than 4 KB." }, 400); }
    const parsed = preferencesSchema.safeParse(body);
    if (!parsed.success) return json({ error: "Check the highlighted fields.", fields: parsed.error.flatten().fieldErrors }, 422);
    const { data, error } = await account.client.from("profiles").update(parsed.data)
      .eq("owner_id", account.profile.owner_id).select("*").single();
    if (error) { reportDatabaseFailure("profile_write", error); return json({ error: "Preferences were not confirmed saved. Reload to check before retrying." }, 503); }
    return json({ profile: data });
  } catch { return json({ error: "Account service unavailable. Please check local setup and try again." }, 503); }
}
