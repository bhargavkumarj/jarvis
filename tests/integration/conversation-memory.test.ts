import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localFixtures } from "../support/local-fixtures";
import type { Database } from "../../src/lib/database.types";
import type { Conversation, Turn, Proposal, Memory, MemorySnippet } from "../../src/lib/conversation/types";
let fixture: Awaited<ReturnType<typeof localFixtures>>, a: SupabaseClient<Database>, b: SupabaseClient<Database>, anon: SupabaseClient<Database>;
let ownerA: string, ownerB: string, conversation: Conversation;
function data<T>(result: { data: unknown; error: { code?: string } | null }): T {
  if (result.error) throw new Error(`Local M2A database operation failed: SQLSTATE ${result.error.code ?? "unknown"}. No raw response printed.`);
  return result.data as T;
}
async function start(text: string, id = conversation.id, request = crypto.randomUUID()) {
  return data<{ turn: Turn; acquired: boolean }>(await a.rpc("m2a_start_turn_v1", { p_conversation: id, p_request: request, p_text: text }));
}
async function finish(turn: Turn, used: MemorySnippet[] = []) {
  return data<{ proposal_id: string | null }>(await a.rpc("m2a_end_turn_v1", { p_id: turn.id, p_attempt: turn.attempt, p_state: "complete", p_text: "Synthetic mock response", p_used: used.map((m) => ({ id: m.id, version: m.version })) }));
}
async function propose(text: string) {
  const { turn } = await start(text); const end = await finish(turn);
  return data<Proposal>(await a.from("memory_proposals").select("*").eq("id", end.proposal_id!).single());
}
async function approve(p: Proposal) {
  return data<Memory>(await a.rpc("m2a_memory_v1", { p_action: "approve", p_id: p.id, p_version: p.version, p_content: p.content }));
}
describe("M2A ordinary-token domain authorization and lifecycle", () => {
  beforeAll(async () => {
    fixture = await localFixtures();
    const client = () => createClient<Database>(fixture.status.API_URL, fixture.status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    a = client(); b = client(); anon = client();
    const aa = await a.auth.signInWithPassword(fixture.users.alex), bb = await b.auth.signInWithPassword(fixture.users.sam);
    if (aa.error || bb.error) throw new Error("Synthetic sign-in failed; credentials suppressed.");
    ownerA = aa.data.user!.id; ownerB = bb.data.user!.id;
    conversation = data<Conversation>(await a.rpc("m2a_create_conversation_v1", {}));
  });
  afterAll(async () => { await fixture?.close(); });
  it("domain definers retain restricted ownership, fixed paths and no default API grants", async () => {
    const functions = await fixture.sql`select n.nspname,p.proname,r.rolname as owner,p.prosecdef,
      p.proconfig=array['search_path=""'] as fixed_path,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
      where n.nspname in ('public','private') and p.proname like 'm2a_%_v1'`;
    expect(functions).toHaveLength(8);
    expect(functions.every((f) => f.owner === "jarvis_auth_guard" && f.fixed_path && !f.anon_execute && !f.service_execute && f.authenticated_execute === (f.nspname === "public") && f.prosecdef === (f.nspname === "public"))).toBe(true);
  });
  it("new tables are owner-filtered and deny direct anonymous or authenticated writes", async () => {
    for (const table of ["conversations", "messages", "memory_proposals", "memories"] as const) {
      expect((await anon.from(table).select("*")).error !== null).toBe(true);
      expect((await b.from(table).select("*").eq("owner_id", ownerA)).data).toEqual([]);
      expect((await b.from(table).insert({ owner_id: ownerA })).error !== null).toBe(true);
      expect((await a.from(table).update({ owner_id: ownerB }).eq("owner_id", ownerA)).error !== null).toBe(true);
    }
    expect((await anon.rpc("m2a_create_conversation_v1", {})).error !== null).toBe(true);
    expect((await b.rpc("m2a_start_turn_v1", { p_conversation: conversation.id, p_request: crypto.randomUUID(), p_text: "attack" })).error !== null).toBe(true);
    expect((await b.rpc("m2a_delete_conversation_v1", { p_id: conversation.id })).error !== null).toBe(true);
    expect((await a.from("conversations").select("id").eq("id", conversation.id)).data?.length).toBe(1);
  });
  it("ordinary messages create no proposal, retries reuse the committed turn", async () => {
    const { turn } = await start("I prefer synthetic blue"); await finish(turn);
    const replay = await start(turn.user_text, conversation.id, turn.request_id);
    expect(replay.acquired).toBe(false); expect(replay.turn.id).toBe(turn.id);
    expect((await a.from("memory_proposals").select("id").eq("source_message_id", turn.id)).data).toEqual([]);
    expect((await a.rpc("m2a_start_turn_v1", { p_conversation: conversation.id, p_request: turn.request_id, p_text: "changed request" })).error?.code).toBe("40001");
  });
  it("only explicit requests create pending proposals; B cannot read source, edit, reject or approve", async () => {
    const p = await propose("Remember this: isolated note: amber");
    expect(p.state).toBe("pending"); expect((await a.from("memories").select("id")).data).toEqual([]);
    expect((await b.from("memory_proposals").select("*").eq("id", p.id)).data).toEqual([]);
    expect((await b.from("memory_proposals").select("*,messages(user_text)").eq("id", p.id)).data).toEqual([]);
    expect((await b.from("messages").select("*").eq("id", p.source_message_id)).data).toEqual([]);
    for (const action of ["approve", "edit_proposal", "reject"]) expect((await b.rpc("m2a_memory_v1", { p_action: action, p_id: p.id, p_version: p.version, p_content: p.content })).error?.code).toBe("42501");
    expect((await a.from("memory_proposals").select("content,state").eq("id", p.id)).data?.[0]?.content).toBe(p.content);
    expect(data<MemorySnippet[]>(await a.rpc("m2a_retrieve_v1", { p_query: "amber" }))).toEqual([]);
  });
  it("edits increment proposal version and stale/content-substituted approvals fail", async () => {
    const p = await propose("Remember: stale fixture: blue");
    const edited = data<Proposal>(await a.rpc("m2a_memory_v1", { p_action: "edit_proposal", p_id: p.id, p_version: p.version, p_content: "stale fixture: green" }));
    expect(edited.version).toBe(p.version + 1);
    expect((await a.rpc("m2a_memory_v1", { p_action: "approve", p_id: p.id, p_version: p.version, p_content: p.content })).error?.code).toBe("40001");
    expect((await a.rpc("m2a_memory_v1", { p_action: "approve", p_id: p.id, p_version: edited.version, p_content: "substituted" })).error?.code).toBe("40001");
    const m = await approve(edited); expect(m.content).toBe(edited.content);
  });
  it("rejected proposals stay excluded and completed-request replay cannot recreate them", async () => {
    const p = await propose("Remember: rejected fixture: chartreuse");
    data(await a.rpc("m2a_memory_v1", { p_action: "reject", p_id: p.id, p_version: p.version }));
    expect(data<MemorySnippet[]>(await a.rpc("m2a_retrieve_v1", { p_query: "chartreuse" }))).toEqual([]);
    const t = data<Turn>(await a.from("messages").select("*").eq("id", p.source_message_id).single());
    await start(t.user_text, conversation.id, t.request_id);
    const after = data<Proposal>(await a.from("memory_proposals").select("*").eq("id", p.id).single());
    expect(after.state).toBe("rejected"); expect(after.content).toBe("");
  });
  it("approved memory crosses conversations only for its owner; deletion redacts derivatives and blocks stale completion", async () => {
    const m = await approve(await propose("Remember: continuity fixture: cobalt"));
    expect((await b.from("memories").select("*").eq("id", m.id)).data).toEqual([]);
    expect(data<MemorySnippet[]>(await b.rpc("m2a_retrieve_v1", { p_query: "cobalt" }))).toEqual([]);
    expect((await b.rpc("m2a_memory_v1", { p_action: "delete_memory", p_id: m.id, p_version: m.version })).error?.code).toBe("42501");
    const c = data<Conversation>(await a.rpc("m2a_create_conversation_v1", {}));
    const selected = data<MemorySnippet[]>(await a.rpc("m2a_retrieve_v1", { p_query: "cobalt" }));
    expect(selected.some((r) => r.id === m.id)).toBe(true);
    const { turn } = await start("cobalt", c.id); await finish(turn, selected);
    const inFlight = (await start("cobalt again", c.id)).turn;
    data(await a.rpc("m2a_memory_v1", { p_action: "delete_memory", p_id: m.id, p_version: m.version }));
    expect(data<MemorySnippet[]>(await a.rpc("m2a_retrieve_v1", { p_query: "cobalt" }))).toEqual([]);
    expect((await a.rpc("m2a_end_turn_v1", { p_id: inFlight.id, p_attempt: inFlight.attempt, p_state: "complete", p_text: "stale", p_used: [{ id: m.id, version: m.version }] })).error?.code).toBe("40001");
    data(await a.rpc("m2a_end_turn_v1", { p_id: inFlight.id, p_attempt: inFlight.attempt, p_state: "failed" }));
    const redacted = data<Turn>(await a.from("messages").select("*").eq("id", turn.id).single());
    expect(redacted.state).toBe("redacted"); expect(redacted.assistant_text).toBe(""); expect(redacted.used_memories).toEqual([]);
    expect((await a.from("messages").select("id").eq("id", m.source_message_id!)).data?.length).toBe(1);
    expect((await a.rpc("m2a_memory_v1", { p_action: "approve", p_id: m.proposal_id!, p_version: 1, p_content: m.content })).error?.code).toBe("40001");
  });
  it("conflicts require explicit owned revision replacement; corrections reject stale versions", async () => {
    const old = await approve(await propose("Remember: conflict fixture: blue"));
    const p = await propose("Remember: conflict fixture: red");
    expect((await a.rpc("m2a_memory_v1", { p_action: "approve", p_id: p.id, p_version: p.version, p_content: p.content })).error?.code).toBe("40001");
    const m = data<Memory>(await a.rpc("m2a_memory_v1", { p_action: "approve", p_id: p.id, p_version: p.version, p_content: p.content, p_replace: old.id, p_replace_version: old.version }));
    expect(m.supersedes_id).toBe(old.id);
    const updated = data<Memory>(await a.rpc("m2a_memory_v1", { p_action: "edit_memory", p_id: m.id, p_version: m.version, p_content: "conflict fixture: violet" }));
    expect(updated.version).toBe(2);
    expect((await a.rpc("m2a_memory_v1", { p_action: "delete_memory", p_id: m.id, p_version: m.version })).error?.code).toBe("40001");
    expect(data<MemorySnippet[]>(await a.rpc("m2a_retrieve_v1", { p_query: "violet" }))[0]?.content).toBe(updated.content);
  });
  it("cancellation/failed retries reuse the user row and stale attempts cannot finish", async () => {
    const first = (await start("cancel fixture")).turn;
    expect((await b.rpc("m2a_end_turn_v1", { p_id: first.id, p_attempt: first.attempt, p_state: "complete", p_text: "attack" })).error?.code).toBe("42501");
    data(await a.rpc("m2a_end_turn_v1", { p_id: first.id, p_attempt: first.attempt, p_state: "cancelled" }));
    const retry = await start(first.user_text, conversation.id, first.request_id);
    expect(retry.turn.id).toBe(first.id); expect(retry.turn.attempt !== first.attempt).toBe(true);
    expect((await a.rpc("m2a_end_turn_v1", { p_id: first.id, p_attempt: first.attempt, p_state: "complete", p_text: "stale" })).error?.code).toBe("40001");
    data(await a.rpc("m2a_end_turn_v1", { p_id: retry.turn.id, p_attempt: retry.turn.attempt, p_state: "failed" }));
    expect((await a.from("messages").select("id").eq("request_id", first.request_id)).data?.length).toBe(1);
  });
  it("expired leases can recover after process loss without duplicating user text", async () => {
    const first = (await start("lease fixture")).turn;
    await fixture.sql`update public.messages set lease_until=now()-interval '1 second' where id=${first.id} and owner_id=${ownerA}`;
    const retry = (await start(first.user_text, conversation.id, first.request_id)).turn;
    expect(retry.id).toBe(first.id); expect(retry.attempt !== first.attempt).toBe(true); await finish(retry);
  });
  it("composite source constraints reject cross-owner links even under fixture administration", async () => {
    // Constraint proof only; all isolation assertions above use ordinary JWTs.
    const result = await fixture.sql.begin(async (tx) => {
      await tx`insert into public.messages(owner_id,conversation_id,request_id,user_text) values(${ownerB},${conversation.id},${crypto.randomUUID()},'synthetic constraint attack')`;
      throw new Error("Cross-owner constraint unexpectedly accepted; rolling back");
    }).then(() => null, (error: { code?: string }) => error.code);
    expect(result).toBe("23503");
  });
  it("forged approved-memory references cannot enter another account's stream commit or replacement", async () => {
    const c = data<Conversation>(await b.rpc("m2a_create_conversation_v1", {}));
    const first = data<{ turn: Turn }>(await b.rpc("m2a_start_turn_v1", { p_conversation: c.id, p_request: crypto.randomUUID(), p_text: "Remember: B-only fixture: vermilion" })).turn;
    const ended = data<{ proposal_id: string }>(await b.rpc("m2a_end_turn_v1", { p_id: first.id, p_attempt: first.attempt, p_state: "complete", p_text: "Synthetic reply" }));
    const p = data<Proposal>(await b.from("memory_proposals").select("*").eq("id", ended.proposal_id).single());
    const m = data<Memory>(await b.rpc("m2a_memory_v1", { p_action: "approve", p_id: p.id, p_version: p.version, p_content: p.content }));
    expect((await a.from("messages").select("*").eq("id", first.id)).data).toEqual([]);
    const own = (await start("foreign reference fixture")).turn;
    expect((await a.rpc("m2a_end_turn_v1", { p_id: own.id, p_attempt: own.attempt, p_state: "complete", p_text: "forged context", p_used: [{ id: m.id, version: m.version }] })).error?.code).toBe("40001");
    data(await a.rpc("m2a_end_turn_v1", { p_id: own.id, p_attempt: own.attempt, p_state: "failed" }));
    const ownProposal = await propose("Remember: forged replacement fixture: vermilion");
    expect((await a.rpc("m2a_memory_v1", { p_action: "approve", p_id: ownProposal.id, p_version: ownProposal.version, p_content: ownProposal.content, p_replace: m.id, p_replace_version: m.version })).error?.code).toBe("40001");
    expect(data<Memory>(await b.from("memories").select("*").eq("id", m.id).single()).content).toBe(m.content);
  });
  it("conversation deletion removes messages/proposals but preserves separately approved memory without source links", async () => {
    const c = data<Conversation>(await a.rpc("m2a_create_conversation_v1", {}));
    const turn = (await start("Remember: survivor fixture: gold", c.id)).turn; const end = await finish(turn);
    const p = data<Proposal>(await a.from("memory_proposals").select("*").eq("id", end.proposal_id!).single());
    const m = await approve(p);
    data(await a.rpc("m2a_delete_conversation_v1", { p_id: c.id }));
    expect((await a.from("messages").select("id").eq("id", turn.id)).data).toEqual([]);
    expect((await a.from("memory_proposals").select("id").eq("id", p.id)).data).toEqual([]);
    const remaining = data<Memory>(await a.from("memories").select("*").eq("id", m.id).single());
    expect(remaining.source_message_id).toBeNull(); expect(remaining.proposal_id).toBeNull(); expect(remaining.state).toBe("active");
  });
  it("admission disablement and session revocation gate every new table and domain RPC", async () => {
    try {
      await fixture.sql`update private.admissions set enabled=false where owner_id=${ownerA}`;
      for (const table of ["conversations", "messages", "memory_proposals", "memories"] as const) expect((await a.from(table).select("id")).data).toEqual([]);
      expect((await a.rpc("m2a_retrieve_v1", { p_query: "fixture" })).error?.code).toBe("42501");
    } finally { await fixture.sql`update private.admissions set enabled=true where owner_id=${ownerA}`; }
    const c = createClient<Database>(fixture.status.API_URL, fixture.status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await c.auth.signInWithPassword(fixture.users.alex);
    if (login.error) throw new Error("Synthetic revocation session unavailable; credential suppressed.");
    data(await c.rpc("revoke_current_session"));
    for (const table of ["conversations", "messages", "memory_proposals", "memories"] as const) expect((await c.from(table).select("id")).data).toEqual([]);
    expect((await c.rpc("m2a_create_conversation_v1", {})).error?.code).toBe("42501");
    expect((await c.rpc("m2a_start_turn_v1", { p_conversation: conversation.id, p_request: crypto.randomUUID(), p_text: "denied after revocation" })).error?.code).toBe("42501");
  });
});
