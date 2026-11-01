import type { MemorySnippet } from "./types";
export type Context = {
  text: string; assistantName: string; allowMemory: boolean;
  history: { user_text: string; assistant_text: string }[]; memories: MemorySnippet[];
};
export const MOCK_VERSION = "deterministic-mock-v1";
export function explicitMemory(text: string): string | null {
  const match = text.match(/^remember(?: this)?:\s*(\S[\s\S]*)$/i);
  return match ? match[1].trim() : null;
}
export function boundedContext(input: Context): Context {
  // Context is data, never instructions/tools. No summaries or embeddings.
  let remaining = 4000;
  const history = input.history.slice(-6).reverse().flatMap((turn) => {
    const user_text = turn.user_text.slice(0, Math.min(1000, remaining)); remaining -= user_text.length;
    // Do not recirculate assistant text derived from possibly deleted memories.
    return user_text ? [{ user_text, assistant_text: "" }] : [];
  }).reverse();
  return { ...input, text: input.text.slice(0, 2000), assistantName: input.assistantName.slice(0, 40), history,
    memories: input.allowMemory ? input.memories.slice(0, 5).map((m) => ({ ...m, content: m.content.slice(0, 1000) })) : [] };
}
export function mockPlan(input: Context) {
  const c = boundedContext(input);
  const proposal = c.allowMemory ? explicitMemory(c.text) : null;
  if (c.text === "/mock fail") return { text: "", failure: "provider" as const, proposal: null, slow: false };
  if (c.text === "/mock interrupt") return { text: "This demonstration is intentionally incomplete.", failure: "interrupted" as const, proposal: null, slow: false };
  const unsupported = /^\/mock unauthorized$|^\/(task|remind|browse|shell|sql)\b/i.test(c.text);
  let text = `Demonstration from ${c.assistantName}: You wrote “${c.text.slice(0, 160)}”. This is a deterministic mock, not a live AI response.`;
  if (unsupported) text = "Mock demonstration: that action is unsupported. No other account, task, SQL, shell or external service was accessed.";
  else if (!c.allowMemory && explicitMemory(c.text)) text = "Temporary mode: memory saving is disabled. Start a retained conversation and explicitly request a proposal to save information.";
  else if (proposal) text = "Mock demonstration: a memory proposal will be available for your review after this response is saved. It is not approved. Conflicting colon-key facts require a separate replacement confirmation.";
  if (!unsupported && c.memories.length) text += ` Used approved memories: ${c.memories.map((m) => m.content).join("; ")}.`;
  return { text: text.slice(0, 8000), failure: null, proposal, slow: c.text === "/mock slow" };
}
