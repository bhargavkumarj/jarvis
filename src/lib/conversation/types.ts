export type Conversation = { id: string; owner_id: string; title: string; created_at: string; expires_at: string; task_focus_id?: string|null };
export type MemorySnippet = { id: string; content: string; version: number };
export type Turn = {
  id: string; owner_id: string; conversation_id: string; request_id: string;
  user_text: string; assistant_text: string; state: "running" | "complete" | "failed" | "cancelled" | "redacted";
  attempt: string; lease_until: string; used_memories: { id: string; version: number }[];
  provider_version: string; created_at: string; privacy_epoch?:number; memory_suppressed?:boolean;
};
export type Proposal = {
  id: string; owner_id: string; source_message_id: string; content: string;
  state: "pending" | "approved" | "rejected" | "deleted"; version: number; created_at: string; origin: "mock" | "openai"; conflict_memory_id: string | null; conflict_memory_version: number | null;
};
export type Memory = {
  id: string; owner_id: string; proposal_id: string | null; source_message_id: string | null;
  source_date: string; source_kind: "conversation" | "user_correction"; content: string; memory_key: string | null;
  state: "active" | "deleted" | "superseded"; version: number; approved_at: string; updated_at: string; supersedes_id: string | null;
};
export type StreamEvent =
  | { type: "start"; id: string; attempt: string }
  | { type: "delta"; text: string }
  | { type: "memories"; memories: MemorySnippet[] }
  | { type: "done"; proposal_id: string | null; replay?: boolean }
  | { type: "receipt"; text: string }
  | { type: "failure"; message: string };
