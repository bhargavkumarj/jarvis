'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { contentRequest } from '@/lib/conversation/client';
import type { ComputerBridge } from '@/lib/computer/bridge-client';
import { receiptLines, receiptSentence, STATE_TEXT, type CommandRecord } from '@/lib/computer/receipt';
import { FINAL_STATES, type ExecutionState } from '@/lib/computer/contracts';
import { ReadAloud } from './read-aloud';

export type ProposedCommand = CommandRecord & { digest: string; auto_eligible: boolean; proposal_expires_at: string };
type Phase = 'review' | 'authorizing' | 'running' | 'done';

export function ComputerPlan({ command, bridge, connected, autoRun, onSettled }: {
  command: ProposedCommand; bridge: ComputerBridge | null; connected: boolean; autoRun: boolean; onSettled?: () => void;
}) {
  const [record, setRecord] = useState<CommandRecord>(command);
  const [phase, setPhase] = useState<Phase>(FINAL_STATES.includes(command.state) ? 'done' : 'review');
  const [live, setLive] = useState<{ state: ExecutionState; index: number | null } | null>(null);
  const [notice, setNotice] = useState('');
  const started = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  async function reload() {
    try { const r = await contentRequest<{ command: CommandRecord }>(`/api/v1/computer/commands?id=${command.id}`); setRecord(r.command); return r.command; }
    catch { setNotice('The recorded result could not be reloaded. Check Settings → Computer history.'); return null; }
  }
  async function run() {
    if (started.current) return;
    started.current = true;
    if (!bridge || !connected) { setNotice('The Mac companion is not connected to this page, so nothing was sent. See Settings → Computer.'); started.current = false; return; }
    setPhase('authorizing'); setNotice('');
    let ticket: string;
    try { ticket = (await contentRequest<{ ticket: string }>('/api/v1/computer/commands', 'POST', { action: 'authorize', command_id: command.id, digest: command.digest })).ticket; }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Not authorized. Nothing was run.'); setPhase('done'); await reload(); onSettled?.(); return; }
    setPhase('running'); setLive({ state: 'authorized', index: null });
    const off = bridge.onEvent((f) => {
      if (f.payload?.commandId !== command.id) return;
      if (f.name === 'command_progress') setLive({ state: f.payload.state as ExecutionState, index: (f.payload.index as number | null) ?? null });
    });
    const frame = await bridge.request('execute', { commandId: command.id, ticket }, 15 * 60_000);
    off();
    if (!frame.ok) setNotice(`${frame.error?.message ?? 'The Mac did not run this.'}${frame.error?.code === 'timeout' || frame.error?.code === 'host_disconnected' ? ' The outcome may be unknown until the Mac reports it.' : ''}`);
    await reload();
    setPhase('done'); setLive(null); onSettled?.();
    requestAnimationFrame(() => statusRef.current?.focus());
  }
  async function stop() {
    setNotice('Stop requested. A step already in progress may still complete; completed steps are not reversed.');
    await Promise.allSettled([
      bridge?.request('cancel', { commandId: command.id }, 5000),
      contentRequest('/api/v1/computer/commands', 'POST', { action: 'cancel', command_id: command.id }),
    ]);
  }
  async function discard() {
    try { await contentRequest('/api/v1/computer/commands', 'POST', { action: 'cancel', command_id: command.id }); } catch { /* reload shows truth */ }
    await reload(); setPhase('done'); onSettled?.();
  }
  useEffect(() => {
    // Locally allowed low-risk plans run after the reviewed submission without a second click;
    // the Mac re-checks its own setting and asks natively if it no longer allows this.
    if (autoRun && command.auto_eligible && phase === 'review') void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for this proposal
  }, []);

  const state: ExecutionState = live?.state ?? record.state;
  const final = FINAL_STATES.includes(record.state) && phase === 'done';
  return <section className="computer-plan" aria-label="Computer action on this Mac">
    <p className="speaker">Computer action · {final ? 'receipt from the Mac' : 'proposal, not yet run'}</p>
    <ol className="computer-steps">{(final ? receiptLines(record) : record.labels.map((l, i) => `${i + 1}. ${l}${live?.index === i ? ' — running' : ''}`)).map((line, i) => <li key={i}>{line.replace(/^\d+\.\s/, '')}</li>)}</ol>
    <p className="help" role="status" aria-live="polite" tabIndex={-1} ref={statusRef}><strong>{STATE_TEXT[state]}</strong>{state === 'awaiting_confirmation' ? ' — approve or decline in the dialog on your Mac.' : ''}{final && record.summary ? ` ${record.summary}` : ''}</p>
    {notice && <p className="notice">{notice}</p>}
    {phase === 'review' && <><p className="help">Your Mac shows its own approval with the exact targets{command.auto_eligible ? ' (or runs it directly if you allowed these items there)' : ''}. Shortcuts always ask. Nothing has run yet. Approval expires five minutes after this proposal.</p>
      <div className="button-row"><button type="button" className="button primary" disabled={!connected} onClick={() => void run()}>Send to this Mac for approval</button><button type="button" className="button secondary" onClick={() => void discard()}>Discard</button></div>
      {!connected && <p className="help">The Mac companion is not connected. <Link href="/settings#computer">Check Computer settings</Link>.</p>}</>}
    {(phase === 'authorizing' || phase === 'running') && <div className="button-row"><button type="button" className="button secondary" onClick={() => void stop()}>Stop</button></div>}
    {final && <ReadAloud text={receiptSentence(record)} />}
  </section>;
}
