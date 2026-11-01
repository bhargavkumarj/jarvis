import { z } from "zod";
import { accountFor, contentFailure, databaseResult, ContentError } from "@/lib/conversation/api";
import { json } from "@/lib/http";
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  try {
    const { client, profile } = await accountFor(request);
    const id = z.uuid().parse((await params).id);
    if (new URL(request.url).search) throw new ContentError(400, "Filters are not accepted.");
    const conversation = databaseResult(await client.from("conversations").select("*").eq("id", id).eq("owner_id", profile.owner_id).maybeSingle());
    if (!conversation) throw new ContentError(404, "Conversation not available.");
    const messages = databaseResult(await client.from("messages").select("*").eq("conversation_id", id).eq("owner_id", profile.owner_id).order("created_at").limit(200));
    return json({ conversation, messages });
  } catch (error) { return contentFailure(error); }
}
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { client } = await accountFor(request, true);
    databaseResult(await client.rpc("m2a_delete_conversation_v1", { p_id: z.uuid().parse((await params).id) }));
    return json({ deleted: true, disclosure: "Messages and proposals removed. Independently approved memories remain in Memory; their source links are cleared." });
  } catch (error) { return contentFailure(error); }
}
