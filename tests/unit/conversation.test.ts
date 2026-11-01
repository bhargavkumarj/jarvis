import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { explicitMemory, boundedContext, mockPlan, type Context } from "../../src/lib/conversation/mock-rules";
import { mockProvider } from "../../src/lib/conversation/provider";
import { turnSchema, memoryActionSchema } from "../../src/lib/conversation/validation";
import { encodeEvent, readEvents } from "../../src/lib/conversation/sse";
const base: Context = { text: "hello", assistantName: "Aster", allowMemory: true, history: [], memories: [] };
describe("explicit memory and deterministic demonstration", () => {
  it("recognizes only an anchored explicit request, not guesses/quotes/negation", () => {
    expect(explicitMemory("Remember this: favorite color: blue")).toBe("favorite color: blue");
    for (const text of ["I like blue", "Do not remember: blue", 'She said "Remember: blue"', "Remember:   "]) expect(explicitMemory(text)).toBeNull();
  });
  it("offers a proposal, never approval or an executable action", () => {
    const plan = mockPlan({ ...base, text: "Remember: favorite color: blue" });
    expect(plan.proposal).toBe("favorite color: blue");
    expect(plan.text).toContain("not approved"); expect("approve" in plan).toBe(false);
    expect(mockPlan({ ...base, text: "/mock unauthorized" }).text).toContain("unsupported");
  });
  it("disables saving and memory context in temporary mode", () => {
    const input = { ...base, allowMemory: false, text: "Remember this: synthetic note", memories: [{ id: "synthetic", version: 1, content: "private fixture" }] };
    expect(boundedContext(input).memories).toEqual([]);
    expect(mockPlan(input).proposal).toBeNull(); expect(mockPlan(input).text).toContain("saving is disabled");
  });
  it("bounds history/output and never recirculates derived assistant content", () => {
    const c = boundedContext({ ...base, text: "x".repeat(4000), history: Array.from({ length: 20 }, () => ({ user_text: "u".repeat(2000), assistant_text: "deleted derived memory" })), memories: Array.from({ length: 8 }, () => ({ id: "synthetic", version: 1, content: "m".repeat(2000) })) });
    expect(c.text.length).toBe(2000); expect(c.history.length <= 6).toBe(true);
    expect(c.history.reduce((n, t) => n + t.user_text.length, 0) <= 4000).toBe(true);
    expect(c.history.every((t) => t.assistant_text === "")).toBe(true);
    expect(c.memories.length).toBe(5); expect(c.memories.every((m) => m.content.length <= 1000)).toBe(true);
  });
  it("uses only supplied approved context and labels it", () => {
    expect(mockPlan({ ...base, memories: [{ id: "synthetic", content: "favorite color: blue", version: 1 }] }).text).toContain("Used approved memories: favorite color: blue");
    expect(mockPlan(base).text).not.toContain("Used approved memories");
  });
  it("streams with explicit success and structured proposal events", async () => {
    const events = [];
    for await (const e of mockProvider.stream({ ...base, text: "Remember: synthetic note" }, new AbortController().signal)) events.push(e);
    expect(events.some((e) => e.type === "delta")).toBe(true);
    expect(events.some((e) => e.type === "proposal")).toBe(true);
    expect(events.at(-1)?.type).toBe("success");
  });
  it.each(["/mock fail", "/mock interrupt"])("reports %s without a success event", async (text) => {
    const events = [];
    for await (const e of mockProvider.stream({ ...base, text }, new AbortController().signal)) events.push(e);
    expect(events.at(-1)?.type).toBe("failure"); expect(events.some((e) => e.type === "success")).toBe(false);
  });
  it("honors cancellation without success", async () => {
    const controller = new AbortController();
    const iterator = mockProvider.stream({ ...base, text: "/mock slow" }, controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value.type).toBe("delta"); controller.abort();
    await expect(iterator.next()).rejects.toThrow();
  });
});
describe("client schemas and stream protocol", () => {
  const retained = { mode: "retained", request_id: crypto.randomUUID(), conversation_id: crypto.randomUUID(), text: "synthetic" };
  it("rejects owner, source, approval and unsupported action fields", () => {
    for (const key of ["owner_id", "source_message_id", "approved", "tools"]) expect(turnSchema.safeParse({ ...retained, [key]: true }).success).toBe(false);
    expect(turnSchema.safeParse({ ...retained, mode: "temporary" }).success).toBe(false);
    expect(memoryActionSchema.safeParse({ action: "approve", id: crypto.randomUUID(), version: 1, content: "note", owner_id: crypto.randomUUID() }).success).toBe(false);
  });
  it("accepts bounded temporary history without durable identifiers", () => {
    expect(turnSchema.safeParse({ mode: "temporary", request_id: crypto.randomUUID(), text: "synthetic", history: [] }).success).toBe(true);
  });
  it("requires a terminal event and decodes split Unicode SSE frames", async () => {
    const bytes = encodeEvent({ type: "delta", text: "Test — नमस्ते" });
    const done = encodeEvent({ type: "done", proposal_id: null });
    const frames = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 30)); c.enqueue(bytes.slice(30)); c.enqueue(done); c.close(); } });
    const seen: string[] = []; await readEvents(new Response(frames), (e) => seen.push(e.type));
    expect(seen).toEqual(["delta", "done"]);
    await expect(readEvents(new Response(encodeEvent({ type: "delta", text: "partial" })), () => {})).rejects.toThrow("interrupted");
  });
});
