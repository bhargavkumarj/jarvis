// Product-state copy only. Server authorization remains at every API/RPC boundary.
export type Availability = 'ready' | 'not_configured' | 'not_enabled' | 'consent_required' | 'unavailable';
export type ProviderStatus = {
  openai_available: boolean; pushover_available: boolean; model: string | null;
  text_state: Availability; notification_state: Availability; retention_days: number;
  budget: {period: string; estimated_committed_or_reserved_paise: number; remaining_paise: number; evaluation_paise: number; evaluation_remaining_paise: number; alert80: boolean} | null;
};
export function availability(configured: boolean, enabled: boolean, consent: boolean, authorized: boolean): Availability {
  if (!configured) return 'not_configured';
  if (!enabled) return 'not_enabled';
  if (!consent) return 'consent_required';
  return authorized ? 'ready' : 'unavailable';
}
export function availabilityLabel(state: Availability) {
  return {ready: 'Configured and permitted', not_configured: 'Not configured for this account', not_enabled: 'Configured, not enabled', consent_required: 'Configured; your separate permission is off', unavailable: 'Unavailable; account/provider readiness needs review'}[state];
}
export function historyPolicy(days?: number) {
  return days === undefined ? 'Conversation retention follows your Privacy Center setting.' : `Retained conversations expire ${days} days after creation.`;
}
export function formatTimestamp(value: string, timezone = 'UTC') {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return 'Date unavailable';
  try { return new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium', timeStyle: 'short', timeZone: timezone}).format(at) + ` · ${timezone}`; }
  catch { return at.toISOString() + ' · UTC'; }
}
// Prevent older selections, unmounted views and session changes from applying late results.
export class ViewGeneration {
  private epoch = 0;
  next() { return ++this.epoch; }
  current(ticket: number) { return ticket === this.epoch; }
  invalidate() { this.epoch++; }
}
