export const GENERIC_PAYLOAD = "You have a reminder. Open the app to view it.";
export type MockScenario = "accept" | "retry_once" | "always_retry" | "permanent" | "timeout_unknown" | "pause_before_authorize" | "pause_after_accept";
export type NotificationOutcome = "simulated_acceptance" | "retryable_rejection" | "permanent_rejection" | "outcome_unknown";
export interface NotificationAdapter { send(input: { attempt_id: string; ordinal: number; scenario: MockScenario }, recordReceipt: (id: string) => Promise<void>): Promise<NotificationOutcome> }
export const mockNotification: NotificationAdapter = {
 async send(input,recordReceipt) {
  if(input.scenario==='permanent') return 'permanent_rejection';
  if(input.scenario==='always_retry'||(input.scenario==='retry_once'&&input.ordinal===1)) return 'retryable_rejection';
  if(input.scenario==='timeout_unknown') return 'outcome_unknown';
  // Restricted local receipt stands in for a provider acceptance. No network call.
  await recordReceipt(input.attempt_id);
  return 'simulated_acceptance';
 }
};
