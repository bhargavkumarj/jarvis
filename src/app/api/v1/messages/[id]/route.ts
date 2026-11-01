import { z } from "zod";
import { accountFor, contentFailure, databaseResult, ContentError } from "@/lib/conversation/api";
import { json } from "@/lib/http";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { client, profile } = await accountFor(request);
    if (new URL(request.url).search) throw new ContentError(400, "Filters are not accepted.");
    const source = databaseResult(await client.from("messages").select("id,conversation_id,user_text,created_at").eq("id", z.uuid().parse((await params).id)).eq("owner_id", profile.owner_id).maybeSingle());
    if (!source) throw new ContentError(404, "Source not available.");
    return json({ source });
  } catch (error) { return contentFailure(error); }
}
