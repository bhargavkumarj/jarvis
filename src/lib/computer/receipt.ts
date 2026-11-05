// Truthful receipt wording shared by Assistant, Settings history and read-aloud.
// Receipts describe evidence levels; they never upgrade "dispatched" to success
// of an unobserved outcome.
import type { ActionResult, Evidence, ExecutionState } from '../../../packages/computer-control-contracts/src/index.ts';

export const STATE_TEXT: Record<ExecutionState, string> = {
  proposed: 'Proposed · waiting for your review',
  awaiting_confirmation: 'Waiting for approval on the Mac',
  authorized: 'Approved here · waiting for the Mac to claim it',
  running: 'Running on the Mac',
  succeeded: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired · did not run',
  outcome_unknown: 'Outcome unknown',
};
export const EVIDENCE_TEXT: Record<Evidence, string> = {
  observed: 'observed on the Mac',
  dispatched: 'sent to macOS; the end result was not observed',
  process_exit: 'the Shortcut runner finished; its individual steps were not verified',
  none: 'nothing ran',
};
export type CommandRecord = {
  id: string; state: ExecutionState; labels: string[]; results: ActionResult[]; summary: string | null;
  created_at: string; finished_at: string | null; cancel_requested_at: string | null;
};
export function receiptLines(command: CommandRecord): string[] {
  return command.labels.map((label, i) => {
    const r = command.results.find((x) => x.index === i);
    if (!r) return `${i + 1}. ${label} — ${['succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(command.state) ? 'no result reported' : 'pending'}`;
    return `${i + 1}. ${label} — ${r.state.replace('_', ' ')} (${EVIDENCE_TEXT[r.evidence]}). ${r.message}`;
  });
}
export function receiptSentence(command: CommandRecord): string {
  const head = `Computer action receipt: ${STATE_TEXT[command.state]}.`;
  const lines = receiptLines(command).join(' ');
  const tail = command.summary ? ` ${command.summary}` : '';
  const cancel = command.cancel_requested_at && !['succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(command.state) ? ' Stop was requested; a step already in progress may still complete.' : '';
  return `${head} ${lines}${tail}${cancel}`.trim();
}
