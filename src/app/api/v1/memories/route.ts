import { accountFor, contentFailure, databaseResult, ContentError, contentBody } from "@/lib/conversation/api";
import { memoryActionSchema } from "@/lib/conversation/validation";
import { json } from "@/lib/http";
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) throw new ContentError(400, "Filters and owner identifiers are not accepted.");
    const { client, profile } = await accountFor(request);
    const proposals = databaseResult(await client.from("memory_proposals").select("*").eq("owner_id", profile.owner_id).eq("state", "pending").order("created_at", { ascending: false }).limit(50));
    const memories = databaseResult(await client.from("memories").select("*").eq("owner_id", profile.owner_id).eq("state", "active").order("updated_at", { ascending: false }).limit(50));
    const owned=memories as {source_message_id:string|null}[];
    const ids=owned.flatMap(m=>m.source_message_id?[m.source_message_id]:[]);
    const available=ids.length?databaseResult<{id:string}[]>(await client.from("messages").select("id").eq("owner_id",profile.owner_id).in("id",ids)):[];
    const live=new Set(available.map(m=>m.id));
    return json({ proposals, memories:owned.map(m=>({...m,source_message_id:m.source_message_id&&live.has(m.source_message_id)?m.source_message_id:null})) });
  } catch (error) { return contentFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { client } = await accountFor(request, true);
    const parsed = memoryActionSchema.safeParse(await contentBody(request));
    if (!parsed.success) throw new ContentError(422, "Check the exact content and version. Owner and source fields are not accepted.");
    const v = parsed.data;
    if(v.action==="approve"){
      const proposal=databaseResult<{origin:string}|null>(await client.from("memory_proposals").select("origin").eq("id",v.id).maybeSingle());
      if(proposal?.origin==="openai"){
        const result=databaseResult(await client.rpc("m2c_approve_memory_v1",{p_id:v.id,p_version:v.version,p_content:v.content,p_reviewed:v.reviewed,p_replace:v.replace_id,p_replace_version:v.replace_version}));
        return json({result});
      }
    }
    const result = databaseResult(await client.rpc("m2a_memory_v1", { p_action: v.action, p_id: v.id, p_version: v.version, p_content: v.content, p_replace: v.replace_id, p_replace_version: v.replace_version }));
    return json({ result });
  } catch (error) { return contentFailure(error); }
}
