import { z } from "zod";
const text = z.string().trim().min(1, "Enter a message.").max(2000, "Use at most 2,000 characters.");
export const turnSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("retained"), conversation_id: z.uuid(), request_id: z.uuid(), provider: z.enum(["mock","openai"]).default("mock"), text }),
  z.strictObject({ mode: z.literal("temporary"), request_id: z.uuid(), provider: z.enum(["mock","openai"]).default("mock"), text, history: z.array(z.strictObject({ user_text: text, assistant_text: z.string().max(8000) })).max(6).default([]) }),
]);
export const conversationSchema = z.strictObject({ title: z.string().trim().min(1).max(80).default("Conversation") });
export const memoryActionSchema = z.strictObject({
  action: z.enum(["edit_proposal", "approve", "reject", "edit_memory", "delete_memory"]),
  id: z.uuid(), version: z.number().int().positive(), content: z.string().max(1000).default(""),
  reviewed: z.boolean().default(false),
  replace_id: z.uuid().nullable().default(null), replace_version: z.number().int().positive().nullable().default(null),
}).superRefine((value, ctx) => {
  if (["edit_proposal", "approve", "edit_memory"].includes(value.action) && !value.content.trim()) ctx.addIssue({ code: "custom", message: "Enter exact memory content.", path: ["content"] });
});
export const cancelSchema = z.strictObject({ id: z.uuid(), attempt: z.uuid() });
