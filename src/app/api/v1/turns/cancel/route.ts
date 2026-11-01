import { accountFor, contentFailure, databaseResult, ContentError, contentBody } from "@/lib/conversation/api";
import { cancelSchema } from "@/lib/conversation/validation";
import { json } from "@/lib/http";
export async function POST(request: Request) {
  try {
    const { client } = await accountFor(request, true);
    const v = cancelSchema.safeParse(await contentBody(request));
    if (!v.success) throw new ContentError(422, "A turn and its current attempt are required.");
    databaseResult(await client.rpc("m2a_end_turn_v1", { p_id: v.data.id, p_attempt: v.data.attempt, p_state: "cancelled" }));
    return json({ cancelled: true });
  } catch (error) { return contentFailure(error); }
}
