import { accountFor, contentFailure, databaseResult, ContentError, contentBody } from "@/lib/conversation/api";
import { conversationSchema } from "@/lib/conversation/validation";
import { json } from "@/lib/http";
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) throw new ContentError(400, "Filters and owner identifiers are not accepted.");
    const { client, profile } = await accountFor(request);
    return json({ conversations: databaseResult(await client.from("conversations").select("*").eq("owner_id", profile.owner_id).order("created_at", { ascending: false }).limit(50)) });
  } catch (error) { return contentFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { client } = await accountFor(request, true);
    const parsed = conversationSchema.safeParse(await contentBody(request));
    if (!parsed.success) throw new ContentError(422, "Use a title of 1–80 characters, without owner fields.");
    return json({ conversation: databaseResult(await client.rpc("m2a_create_conversation_v1", { p_title: parsed.data.title })) }, 201);
  } catch (error) { return contentFailure(error); }
}
