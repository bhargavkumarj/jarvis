'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {useHydrated} from '@/lib/use-hydrated';
import {availabilityLabel, historyPolicy, ViewGeneration, type ProviderStatus} from '@/lib/workspace';
export function LiveSettings({compact = false}: {compact?: boolean}) {
  const hydrated = useHydrated();
  const [status, setStatus] = useState<ProviderStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const locked = useRef(false), generation = useRef(new ViewGeneration());
  const load = useCallback(async (signal?: AbortSignal) => {
    if (locked.current) return;
    locked.current = true; const ticket = generation.current.next(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/integrations', {cache: 'no-store', signal});
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (generation.current.current(ticket)) setStatus(data);
    } catch { if (generation.current.current(ticket) && !signal?.aborted) setError('Provider status unavailable. Nothing was enabled or changed. Retry when local account services and migrations are ready.'); }
    finally { if (generation.current.current(ticket)) { setBusy(false); locked.current = false; } }
  }, []);
  useEffect(() => { const controller = new AbortController(),scope=generation.current; void load(controller.signal); return () => { scope.invalidate(); locked.current = false; controller.abort(); }; }, [load]);
  return <section className="settings-section" id="providers" aria-labelledby="live-settings-title"><div><h2 id="live-settings-title">Providers and usage</h2><p className="description">The mock is local demonstration behavior. A configured live feature also needs its separate permission.</p></div><div className="stack">
    {error ? <p role="status">{error}</p> : !status ? <p>Loading provider status…</p> : <>
      <ul className="provider-list"><li>Text AI: {availabilityLabel(status.text_state)}{status.openai_available && status.model ? ` · ${status.model}` : ''}.</li><li>Pushover reminders: {availabilityLabel(status.notification_state)}.</li></ul>
      {status.budget && !compact ? <><p>AI estimate/reservations this month: ₹{(status.budget.estimated_committed_or_reserved_paise / 100).toFixed(2)} / ₹1,000. Remaining ₹{(status.budget.remaining_paise / 100).toFixed(2)}.</p><p>Initial evaluation: ₹{(status.budget.evaluation_paise / 100).toFixed(2)} / ₹200, within AI. Month: {status.budget.period}, Asia/Kolkata. ₹500 contingency does not increase AI allowance.</p>{status.budget.alert80 && <p className="notice">80% AI allocation warning. Calls stop when the reservation cannot fit. Tasks and manual reminders keep working.</p>}</> : !compact && <p className="help">Usage summary unavailable. This is not a zero-spend or unlimited-allowance statement.</p>}
      <p className="help">{historyPolicy(status.retention_days)} Approved memories remain until correction/deletion. Change retention and separate permissions in <Link href="/settings#privacy-center">Privacy Center</Link>.</p>
    </>}
    <button className="button secondary" disabled={!hydrated || busy} onClick={() => void load()}>{busy ? 'Checking provider status…' : 'Refresh provider status'}</button>
    {!compact && <><p className="help">Estimates include a dated tax/FX margin. Funding, dashboards and final invoices can differ. Unknown/cancelled calls retain conservative charges. Credentials are never shown here.</p><p className="help">OpenAI receives bounded context and selected active approved memories, with store:false. This is not zero provider retention. Temporary application content is ephemeral; provider processing is a separate boundary. Raw audio has its own explicit consent and retention disclosure.</p><p className="help">No proactive check-ins or briefings are implemented. Disabling reminder sends blocks new Pushover authorizations; it does not disconnect credentials or cancel confirmed schedules. Cancel a reminder or series in Today. Re-enabling permission does not replay failed or unknown attempts. Disconnecting a channel requires removing its private local configuration and restarting the worker; existing mock records never become live.</p></>}
  </div></section>;
}
