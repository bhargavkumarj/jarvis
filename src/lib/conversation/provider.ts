import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { mockPlan, type Context } from "./mock-rules";
export type ProviderEvent = { type: "delta"; text: string } | { type: "proposal"; content: string } | { type: "success" } | { type: "failure"; reason: "provider" | "interrupted" };
export interface TextProvider { stream(context: Context, signal: AbortSignal): AsyncIterable<ProviderEvent> }
export const mockProvider: TextProvider = {
  async *stream(context, signal) {
    const plan = mockPlan(context);
    signal.throwIfAborted();
    if (plan.failure === "provider") { yield { type: "failure", reason: "provider" }; return; }
    for (const chunk of plan.text.match(/.{1,24}/gs) ?? []) {
      await delay(plan.slow ? 160 : 12, undefined, { signal });
      yield { type: "delta", text: chunk };
      if (plan.failure === "interrupted") { yield { type: "failure", reason: "interrupted" }; return; }
    }
    if (plan.proposal) yield { type: "proposal", content: plan.proposal };
    signal.throwIfAborted();
    yield { type: "success" };
  },
};
