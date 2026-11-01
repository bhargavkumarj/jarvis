import type { ResolvedSchedule } from "./time";
export type ReminderState = "draft" | "scheduling_pending" | "scheduled" | "attempt_started" | "retry_scheduled" | "simulated_acceptance" | "provider_accepted" | "failed" | "outcome_unknown" | "cancelled" | "expired" | "missed" | "skipped";
export type Reminder = ResolvedSchedule & {
  id: string; owner_id: string; version: number; state: ReminderState; created_at: string;
  confirmed_at: string | null; scheduled_at: string | null; cancel_requested_at: string | null;
  finished_at: string | null; expires_at: string; next_attempt_at: string | null;
  queue_job_id: string | null; enqueue_generation: number; attempt_count: number;
  error_code: string | null; confirm_operation_id: string | null; reconciled_at: string | null; channel_version: string | null;
  task_id: string|null; series_id: string|null; series_version: number|null; occurrence_date:string|null; nominal_due_at:string|null; dst_adjustment:string|null; late_minutes:number|null;
};
export type ReminderOperation = { id: string; owner_id: string; idempotency_key: string; kind: "review" | "confirm" | "cancel" | "snooze" | "occurrence"; request_hash: string; reminder_id: string; result: Record<string, unknown>; created_at: string };
export type DeliveryAttempt = { id: string; owner_id: string; reminder_id: string; ordinal: number; job_id: string; schedule_version: number; state: string; started_at: string; send_started_at: string | null; finished_at: string | null; lease_until: string; error_code: string | null; provider_reference: string | null; phone_observed: boolean | null; phone_observed_at: string | null; observation_recorded_at: string | null };
export type ReviewSnapshot = ResolvedSchedule & { version: number };
export type OperationReceipt = { reminder: Reminder; operation: ReminderOperation; replay: boolean };
export const reminderLabels: Record<ReminderState, string> = {
  draft: "Draft — not confirmed", scheduling_pending: "Saved — scheduling pending", scheduled: "Scheduled",
  attempt_started: "Attempt started", retry_scheduled: "Retry scheduled", simulated_acceptance: "Simulated acceptance",
  provider_accepted: "Provider accepted", failed: "Failed", outcome_unknown: "Outcome unknown", cancelled: "Cancelled", expired: "Expired", missed: "Missed — outside lateness window", skipped: "Skipped occurrence",
};
export function snapshot(r: Reminder): ReviewSnapshot {
  return { title: r.title, local_datetime: r.local_datetime, timezone: r.timezone, due_at: new Date(r.due_at).toISOString().replace(".000Z", "Z"), resolution: r.resolution, channel: r.channel, version: r.version };
}
