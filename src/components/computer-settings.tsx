'use client';
import { useState } from 'react';
import { useHydrated } from '@/lib/use-hydrated';
import { contentRequest } from '@/lib/conversation/client';
import { useComputer } from '@/lib/computer/use-computer';
import { RECOVERY } from '@/lib/computer/bridge-client';
import { COMPUTER_DISCLOSURE } from '@/lib/computer/config';
import { receiptSentence } from '@/lib/computer/receipt';
import { ACTION_LABELS, ACTION_TYPES, type ResourceKind } from '@/lib/computer/contracts';
import { formatTimestamp } from '@/lib/workspace';

const KIND_TEXT: Record<ResourceKind, string> = { application: 'App', website: 'Website', folder: 'Folder', shortcut: 'Shortcut' };

export function ComputerSettings() {
  const hydrated = useHydrated();
  const c = useComputer();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [consent, setConsent] = useState(false), [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  async function act(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setMessage(`${label}…`);
    try { await fn(); setMessage(`${label}: done.`); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : `${label} was not confirmed.`); }
    finally { setBusy(false); await c.refresh(); }
  }
  async function bridgeAct(label: string, type: 'pair' | 'disable' | 'enable' | 'manage_add' | 'manage_remove' | 'manage_auto' | 'unpair', payload: Record<string, unknown>, timeout = 180_000) {
    await act(label, async () => {
      const frame = await c.bridge.current!.request(type, payload, timeout);
      if (!frame.ok) throw new Error(frame.error?.message ?? `${label} was not completed on the Mac.`);
    });
  }
  async function pair() {
    if (c.bridgeState.extension !== 'installed') return;
    const extensionId = c.bridgeState.extensionId;
    await act('Pairing (approve on your Mac)', async () => {
      const p = await contentRequest<{ pairing_id: string; code: string }>('/api/v1/computer/pairings', 'POST', { extension_id: extensionId });
      const frame = await c.bridge.current!.request('pair', { pairingId: p.pairing_id, code: p.code }, 180_000);
      if (!frame.ok) throw new Error(frame.error?.message ?? 'Pairing was not completed on the Mac.');
    });
  }
  const s = c.server, b = c.bridgeState, companion = c.companion;
  const enabled = !!s?.settings.enabled;
  return <section className="settings-section" id="computer" aria-labelledby="computer-title"><div><h2 id="computer-title">Computer</h2><p className="description">Let JARVIS open approved apps, websites and folders, set an exact volume, or run an approved Shortcut on this Mac. Off by default.</p></div><div className="stack">
    {c.error && <p className="error-message" role="alert">{c.error}</p>}
    {!s ? <p>{c.loading ? 'Loading computer status…' : 'Computer status unavailable.'}</p> : <>
      <div className="computer-disclosure"><h3>What turning this on means</h3><ul>{COMPUTER_DISCLOSURE.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="help">Not supported in this version: Safari or Firefox, controlling the Mac from your phone, other operating systems, a sleeping or locked Mac, screenshots, file reading or general browser automation. Temporary chats cannot run computer actions.</p></div>
      {!enabled ? <div className="stack"><label className="check-label"><input type="checkbox" checked={consent} disabled={!hydrated || busy} onChange={(e) => setConsent(e.target.checked)} /> I have read this and want computer control for this account.</label>
        <div className="button-row"><button className="button primary" disabled={!hydrated || busy || !consent} onClick={() => void act('Turning on computer control', () => contentRequest('/api/v1/computer', 'POST', { action: 'settings', enabled: true, consent: s.consent_version }))}>Turn on computer control</button></div></div>
        : <div className="button-row"><button className="button secondary" disabled={!hydrated || busy} onClick={() => void act('Turning off computer control', () => contentRequest('/api/v1/computer', 'POST', { action: 'settings', enabled: false, consent: null }))}>Turn off for this account</button></div>}

      <h3>This Mac</h3>
      <ul className="provider-list computer-status">
        <li>Browser extension: {b.extension === 'checking' ? 'checking…' : b.extension === 'missing' ? 'not detected in this Chrome profile' : 'installed'}</li>
        <li>Mac companion: {b.extension !== 'installed' ? 'unknown (needs the extension)' : b.host === 'connected' ? `connected (version ${companion?.version})` : `not connected (${b.reason})`}</li>
        {companion && <><li>Name: {companion.deviceName ?? 'not configured'}</li><li>Paired account: {companion.paired ? (c.thisDevice ? `${companion.accountLabel ?? 'this account'}` : 'a different JARVIS account or a revoked pairing') : 'not paired'}</li>
          <li>On this Mac: {companion.disabled ? 'computer control DISABLED locally' : 'enabled locally'}</li>
          <li>Action types enabled here: {companion.enabledActions.length ? companion.enabledActions.map((a) => ACTION_LABELS[a as keyof typeof ACTION_LABELS] ?? a).join(', ') : 'none'}</li></>}
      </ul>
      {b.extension === 'missing' && <p className="notice">Install the JARVIS bridge: run <code>pnpm bridge:build</code>, open chrome://extensions, enable Developer mode, choose Load unpacked and select <code>apps/jarvis-browser-bridge/dist</code>. Its ID must be <code>{s.extension_id}</code>. Then reload this page. Full steps: MAC_COMPANION_SETUP.md.</p>}
      {b.extension === 'installed' && b.host === 'disconnected' && <p className="notice">{RECOVERY[b.reason] ?? RECOVERY.host_disconnected}</p>}
      {companion?.problems.filter((p) => p.code !== 'not_paired').map((p) => <p key={p.code} className="notice">{p.message}</p>)}
      {c.pairedElsewhere && <p className="notice">This Mac reports a pairing that is not active for this account. Unpair it on the Mac, then pair again.</p>}
      <div className="button-row">
        {companion && !companion.paired && <button className="button primary" disabled={!hydrated || busy || !enabled} onClick={() => void pair()}>Pair this Mac</button>}
        {companion && !companion.disabled && <button className="button secondary" disabled={!hydrated || busy} onClick={() => void bridgeAct('Disabling on this Mac', 'disable', {}, 10_000)}>Disable on this Mac now</button>}
        {companion?.disabled && <button className="button secondary" disabled={!hydrated || busy} onClick={() => void bridgeAct('Re-enabling (confirm on your Mac)', 'enable', {})}>Re-enable on this Mac…</button>}
        {companion?.paired && <button className="button secondary" disabled={!hydrated || busy} onClick={() => void bridgeAct('Unpairing (confirm on your Mac)', 'unpair', {})}>Unpair this Mac…</button>}
        <button className="button secondary" disabled={!hydrated || busy} onClick={() => void c.refresh()}>Refresh status</button>
      </div>
      {enabled && !companion?.paired && b.extension === 'installed' && b.host === 'connected' && <p className="help">Pairing opens an approval dialog on this Mac showing this site and your account. It expires in five minutes and can be used once.</p>}
      {!enabled && companion && !companion.paired && <p className="help">Turn on computer control above before pairing.</p>}

      {companion && <><h3>Approved on this Mac</h3>
        {companion.catalogue.length === 0 ? <p className="help">Nothing approved yet. Choosing an item opens a picker and a review dialog on the Mac; nothing is added from this page directly.</p>
          : <ul className="computer-catalogue">{companion.catalogue.map((e) => <li key={`${e.kind}:${e.alias}`}><span><strong>{e.label}</strong> · {KIND_TEXT[e.kind]} · alias “{e.alias}”{e.detail ? ` · ${e.detail}` : ''}{e.names.length ? ` · also “${e.names.join('”, “')}”` : ''} · {e.kind === 'shortcut' ? 'always asks' : e.auto ? 'runs without asking' : 'asks every time'}</span>
            <span className="button-row">{e.kind !== 'shortcut' && <button className="button secondary" disabled={!hydrated || busy} onClick={() => void bridgeAct(e.auto ? 'Requiring approval' : 'Allowing without asking (confirm on your Mac)', 'manage_auto', { kind: e.kind, alias: e.alias, enabled: !e.auto })}>{e.auto ? 'Ask every time' : 'Allow without asking…'}</button>}
              <button className="button secondary" disabled={!hydrated || busy} onClick={() => void bridgeAct('Removing', 'manage_remove', { kind: e.kind, alias: e.alias }, 10_000)}>Remove</button></span></li>)}</ul>}
        <p>Volume: {companion.volumeAuto ? 'set without asking' : 'asks every time'} <button className="button secondary" disabled={!hydrated || busy} onClick={() => void bridgeAct(companion.volumeAuto ? 'Requiring approval for volume' : 'Allowing volume without asking (confirm on your Mac)', 'manage_auto', { kind: 'volume', alias: null, enabled: !companion.volumeAuto })}>{companion.volumeAuto ? 'Ask every time' : 'Allow without asking…'}</button></p>
        <div className="button-row">{(['application', 'website', 'folder', 'shortcut'] as ResourceKind[]).map((k) => <button key={k} className="button secondary" disabled={!hydrated || busy || companion.disabled} onClick={() => void bridgeAct(`Choose on your Mac (${KIND_TEXT[k]})`, 'manage_add', { kind: k })}>Approve {k === 'application' ? 'an app' : `a ${KIND_TEXT[k].toLowerCase()}`}…</button>)}</div>
        <p className="help">Action types enabled in the companion: {ACTION_TYPES.map((t) => `${ACTION_LABELS[t]} ${companion.enabledActions.includes(t) ? '✓' : '✗'}`).join(' · ')}. Change these on the Mac with “jarvis-companion actions enable|disable …”.</p></>}

      <h3>Paired Macs for this account</h3>
      {c.activeDevices.length === 0 && s.devices.length === 0 ? <p className="help">None.</p> : <ul className="computer-devices">{s.devices.map((d) => <li key={d.id}>{d.name} · {d.state === 'active' ? 'active' : `revoked ${d.revoked_at ? formatTimestamp(d.revoked_at) : ''}`} · last seen {d.last_seen_at ? formatTimestamp(d.last_seen_at) : 'never'}{d.id === c.thisDevice?.id ? ' · this Mac' : ''}
        {d.state === 'active' && (confirmRevoke === d.id ? <span className="button-row"><button className="button primary" disabled={busy} onClick={() => { setConfirmRevoke(null); void act('Disconnecting the Mac', () => contentRequest('/api/v1/computer', 'POST', { action: 'revoke', device_id: d.id })); }}>Confirm disconnect</button><button className="button secondary" onClick={() => setConfirmRevoke(null)}>Keep</button></span>
          : <button className="button secondary" disabled={!hydrated || busy} onClick={() => setConfirmRevoke(d.id)}>Disconnect…</button>)}</li>)}</ul>}
      <p className="help">Disconnecting here blocks new commands immediately. An action already running on the Mac stops before its next step; one in progress may finish. It cannot be recalled remotely.</p>

      <h3>Recent computer actions</h3>
      {s.commands.length === 0 ? <p className="help">No computer actions in the last {s.retention_days} days.</p> : <ul className="computer-history">{s.commands.map((cmd) => <li key={cmd.id}><span className="help">{formatTimestamp(cmd.created_at)} · {cmd.source}</span><br />{receiptSentence(cmd)}</li>)}</ul>}
      <div className="button-row"><button className="button secondary" disabled={!hydrated || busy || s.commands.length === 0} onClick={() => void act('Clearing computer history', () => contentRequest('/api/v1/computer', 'POST', { action: 'clear_history' }))}>Clear computer history</button></div>
      <p className="help">History keeps aliases, states and short results for {s.retention_days} days and is included in your export. The Mac keeps a separate local journal (metadata only) to prevent replays; clear it with “jarvis-companion journal-clear”.</p>
    </>}
    <p aria-live="polite" aria-atomic="true" className="help" id="computer-progress">{message}</p>
  </div></section>;
}
