// Chrome bridge logic with fake runtime ports. Real Chrome behaviour is exercised
// separately (scripts/bridge-chrome-check.mjs); this proves the relay's own rules.
import { describe, it, expect, beforeEach } from 'vitest';
import { createBridge, senderAllowed, nativeErrorCode, type ChromeApi, type Port, type Sender } from '../../apps/jarvis-browser-bridge/src/bridge.ts';

type FakePort = Port & { sent: unknown[]; emit(m: unknown): void; close(): void; disconnected: boolean };
function port(sender?: Sender): FakePort {
  const onMessage: ((m: unknown) => void)[] = [], onDisconnect: ((p: unknown) => void)[] = [];
  const p: FakePort = {
    sender, sent: [], disconnected: false,
    postMessage(m) { if (p.disconnected) throw new Error('closed'); p.sent.push(JSON.parse(JSON.stringify(m))); },
    disconnect() { p.disconnected = true; },
    onMessage: { addListener: (fn) => onMessage.push(fn) }, onDisconnect: { addListener: (fn) => onDisconnect.push(fn) },
    emit(m) { onMessage.forEach((fn) => fn(m)); }, close() { p.disconnected = true; onDisconnect.forEach((fn) => fn(p)); },
  };
  return p;
}
const ORIGIN = 'http://127.0.0.1:3000';
const goodSender = (): Sender => ({ origin: ORIGIN, url: `${ORIGIN}/settings`, frameId: 0, tab: { id: 1 }, documentLifecycle: 'active' });
let natives: FakePort[], connectExternal: ((p: Port) => void) | null, lastError: string | undefined, nativeFails: boolean;
function chrome(): ChromeApi {
  return { runtime: {
    id: 'fomkddjghmfjocinjmbdagahcbilimof', get lastError() { return lastError ? { message: lastError } : undefined },
    connectNative: () => { if (nativeFails) throw new Error('no host'); const n = port(); natives.push(n); return n; },
    onConnectExternal: { addListener: (fn) => { connectExternal = fn; } }, getManifest: () => ({ version: '0.1.0' }),
  } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function page(sender: Sender = goodSender()) { const p = port(sender); connectExternal!(p); await tick(); return p; }
const msg = (type: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ v: 1, id: crypto.randomUUID(), type, payload, ...extra });
const hostFrame = (id: string | null, name: string, payload: Record<string, unknown> | null = {}, ok = true) => ({ v: 1, id, kind: id ? 'response' : 'event', name, ok, payload, error: ok ? null : { code: 'busy', message: 'Busy.' } });

beforeEach(() => { natives = []; connectExternal = null; lastError = undefined; nativeFails = false; createBridge(chrome(), { allowedOrigins: [ORIGIN] }, () => 1_000_000); });

describe('sender validation', () => {
  it.each([
    ['another port', { ...goodSender(), origin: 'http://127.0.0.1:3001', url: 'http://127.0.0.1:3001/' }],
    ['another site', { ...goodSender(), origin: 'https://evil.example', url: 'https://evil.example/' }],
    ['an iframe', { ...goodSender(), frameId: 3 }],
    ['no tab', { ...goodSender(), tab: undefined }],
    ['a prerendered document', { ...goodSender(), documentLifecycle: 'prerender' }],
    ['a mismatched URL', { ...goodSender(), url: 'https://evil.example/' }],
    ['missing origin', { ...goodSender(), origin: undefined }],
  ])('disconnects %s without contacting the companion', async (_, sender) => {
    const p = await page(sender as Sender);
    expect(p.disconnected).toBe(true);
    p.emit(msg('hello'));
    expect(natives).toHaveLength(0);
  });
  it('accepts only the exact configured origin from a top-level active tab', () => {
    expect(senderAllowed(goodSender(), new Set([ORIGIN]))).toBe(true);
    expect(senderAllowed({ ...goodSender(), origin: 'http://localhost:3000', url: 'http://localhost:3000/' }, new Set([ORIGIN]))).toBe(false);
  });
});

describe('relay', () => {
  it('forwards a rebuilt message with Chrome’s observed origin; page fields cannot add an origin or instructions', async () => {
    const p = await page();
    p.emit(msg('hello', {}, { origin: 'https://evil.example' }));
    expect(natives).toHaveLength(0);
    expect(p.sent[0]).toMatchObject({ ok: false, error: { code: 'invalid_message' } });
    const m = msg('execute', { commandId: crypto.randomUUID(), ticket: 'A'.repeat(43) });
    p.emit(m);
    expect(natives[0].sent).toEqual([{ ...m, origin: ORIGIN }]);
    p.emit(msg('execute', { commandId: crypto.randomUUID(), ticket: 'A'.repeat(43), actions: [{ type: 'run_shortcut', alias: 'x' }] }));
    expect(natives[0].sent).toHaveLength(1);
  });
  it('rejects oversized messages and rate-limits a page', async () => {
    const p = await page();
    p.emit({ ...msg('hello'), payload: { pad: 'x'.repeat(20_000) } });
    expect(natives).toHaveLength(0);
    for (let i = 0; i < 35; i++) p.emit(msg('hello'));
    expect(p.sent.filter((f) => (f as { error?: { code: string } }).error?.code === 'rate_limited').length).toBeGreaterThan(0);
  });
  it('reports extension-installed-but-companion-missing distinctly', async () => {
    nativeFails = true;
    const p = await page();
    p.emit(msg('hello'));
    expect(p.sent[0]).toMatchObject({ ok: false, error: { code: 'host_not_installed' }, payload: { bridge: { hostConnected: false, extensionId: 'fomkddjghmfjocinjmbdagahcbilimof' } } });
  });
  it('routes responses to the requesting page and command events to the command’s owner only', async () => {
    const p1 = await page(), p2 = await page();
    const commandId = crypto.randomUUID();
    const m = msg('execute', { commandId, ticket: 'B'.repeat(43) });
    p1.emit(m);
    natives[0].emit(hostFrame(null, 'command_progress', { commandId, state: 'running', index: 0 }));
    natives[0].emit(hostFrame(m.id, 'execute', { commandId }));
    expect(p1.sent.map((f) => (f as { name: string }).name)).toEqual(['command_progress', 'execute']);
    expect(p2.sent).toEqual([]);
    natives[0].emit(hostFrame(null, 'status', { companion: {} }));
    expect(p2.sent).toHaveLength(1);
  });
  it('drops malformed companion frames', async () => {
    const p = await page();
    p.emit(msg('hello'));
    natives[0].emit({ v: 1, id: null, kind: 'event', name: 'eval', ok: true, payload: {}, error: null });
    natives[0].emit('not json object');
    expect(p.sent).toEqual([]);
  });
  it('companion disconnect fails pending requests and reports outcomes as not yet known', async () => {
    const p = await page();
    const m = msg('execute', { commandId: crypto.randomUUID(), ticket: 'C'.repeat(43) });
    p.emit(m);
    lastError = 'Native host has exited.';
    natives[0].close();
    expect(p.sent[0]).toMatchObject({ id: m.id, ok: false, error: { code: 'host_disconnected' } });
    expect(p.sent[1]).toMatchObject({ kind: 'event', name: 'status', payload: { hostConnected: false } });
    expect(nativeErrorCode('Specified native messaging host not found.')).toBe('host_not_installed');
    expect(nativeErrorCode('Access to the specified native messaging host is forbidden.')).toBe('host_forbidden');
  });
  it('keeps the companion while a command runs after its tab closes, then releases it', async () => {
    const p = await page();
    const commandId = crypto.randomUUID();
    const m = msg('execute', { commandId, ticket: 'D'.repeat(43) });
    p.emit(m);
    p.close();
    expect(natives[0].disconnected).toBe(false);
    natives[0].emit(hostFrame(null, 'command_result', { commandId }));
    natives[0].emit(hostFrame(m.id, 'execute', { commandId }));
    expect(natives[0].disconnected).toBe(true);
  });
});
