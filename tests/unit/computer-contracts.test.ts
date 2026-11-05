// Shared fixtures are also parsed by the Swift companion's XCTest suite; these
// cases prove the TypeScript side of the agreement. Synthetic values only.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fixtures from '../../packages/computer-control-contracts/fixtures/contract-cases.json';
import {
  canonicalCommand, ContractError, parseAction, parseCatalogueEntry, parseCommandEnvelope, parseCommandResult, parseDeviceSync,
  parseHostFrame, parsePageMessage, websiteHost, LIMITS,
} from '../../packages/computer-control-contracts/src/index.ts';

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return e instanceof ContractError ? e.code : 'unexpected'; } };
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('shared contract fixtures', () => {
  it.each(fixtures.digest)('canonical digest agrees for %#', (d) => {
    const canonical = canonicalCommand(d.deviceId, d.commandId, d.actions as never);
    expect(canonical).toBe(d.canonical);
    expect(sha(canonical)).toBe(d.sha256);
    expect(/^[\x20-\x7e\n]+$/.test(canonical)).toBe(true);
  });
  it('a changed parameter changes the digest (tampering after confirmation is detectable)', () => {
    const d = fixtures.digest[1];
    const tampered = (d.actions as { type: string; percent?: number }[]).map((a) => (a.type === 'set_volume' ? { ...a, percent: 31 } : a));
    expect(sha(canonicalCommand(d.deviceId, d.commandId, tampered as never))).not.toBe(d.sha256);
    expect(sha(canonicalCommand(d.commandId, d.deviceId, d.actions as never))).not.toBe(d.sha256);
  });
  it.each(fixtures.validActions)('accepts valid action %#', (a) => expect(parseAction(a)).toEqual(a));
  it.each(fixtures.invalidActions)('rejects invalid action $code', ({ value, code: expected }) => expect(code(() => parseAction(value))).toBe(expected));
  it.each(fixtures.validEnvelopes)('accepts the canonical command envelope', (e) => expect(parseCommandEnvelope(e)).toEqual(e));
  it.each(fixtures.invalidEnvelopes)('rejects envelope: $code', ({ value, code: expected }) => expect(code(() => parseCommandEnvelope(value))).toBe(expected));
  it.each(fixtures.validResults)('accepts result %#', (r) => expect(parseCommandResult(r)).toEqual(r));
  it.each(fixtures.invalidResults)('rejects result: $code', ({ value, code: expected }) => expect(code(() => parseCommandResult(value))).toBe(expected));
  it.each(fixtures.validCatalogue)('accepts catalogue entry %#', (e) => expect(parseCatalogueEntry(e)).toEqual(e));
  it.each(fixtures.invalidCatalogue)('rejects catalogue entry: $code', ({ value, code: expected }) => expect(code(() => parseCatalogueEntry(value))).toBe(expected));
  it.each(fixtures.websites.valid)('website %s → host %s', (url, host) => expect(websiteHost(url)).toBe(host));
  it.each(fixtures.websites.invalid)('rejects website %s', (url) => expect(websiteHost(url)).toBeNull());
});

describe('bridge messages', () => {
  const id = crypto.randomUUID();
  it('rebuilds only allowlisted fields and rejects extras, unknown types and other versions', () => {
    const ticket = 'A'.repeat(43);
    expect(parsePageMessage({ v: 1, id, type: 'execute', payload: { commandId: id, ticket } })).toEqual({ v: 1, id, type: 'execute', payload: { commandId: id, ticket } });
    expect(code(() => parsePageMessage({ v: 1, id, type: 'execute', payload: { commandId: id, ticket, actions: [{ type: 'set_volume', percent: 1 }] } }))).toBe('invalid_message');
    expect(code(() => parsePageMessage({ v: 1, id, type: 'execute_shell', payload: {} }))).toBe('unknown_message');
    expect(code(() => parsePageMessage({ v: 2, id, type: 'hello', payload: {} }))).toBe('unsupported_version');
    expect(code(() => parsePageMessage({ v: 1, id, type: 'hello', payload: {}, origin: 'https://evil.example' }))).toBe('invalid_message');
    expect(code(() => parsePageMessage({ v: 1, id, type: 'manage_auto', payload: { kind: 'shortcut', alias: 'study-setup', enabled: true } }))).toBe('shortcut_always_confirmed');
    expect(code(() => parsePageMessage({ v: 1, id, type: 'manage_remove', payload: { kind: 'folder', alias: '/Users/x' } }))).toBe('invalid_message');
  });
  it('validates companion frames before they reach the page', () => {
    const ok = { v: 1, id, kind: 'response', name: 'hello', ok: true, payload: {}, error: null };
    expect(parseHostFrame(ok)).toEqual(ok);
    expect(code(() => parseHostFrame({ ...ok, ok: false }))).toBe('invalid_frame');
    expect(code(() => parseHostFrame({ ...ok, kind: 'event', name: 'status' }))).toBe('invalid_frame');
    expect(code(() => parseHostFrame({ ...ok, ok: false, error: { code: 'internal', message: 'stack\ntrace' } }))).toBe('invalid_frame');
    expect(code(() => parseHostFrame({ ...ok, name: 'eval' }))).toBe('invalid_frame');
  });
  it('device sync is bounded and rejects duplicate aliases', () => {
    const entry = fixtures.validCatalogue[0];
    const sync = { protocolVersion: 1, hostVersion: '1.0.0', disabled: false, enabledActions: ['open_application'], volumeAuto: false, catalogue: [entry] };
    expect(parseDeviceSync(sync).catalogue).toHaveLength(1);
    expect(code(() => parseDeviceSync({ ...sync, catalogue: [entry, entry] }))).toBe('duplicate_alias');
    expect(code(() => parseDeviceSync({ ...sync, catalogue: Array.from({ length: LIMITS.maxCatalogueEntries + 1 }, (_, i) => ({ ...entry, alias: `a${i}` })) }))).toBe('invalid_catalogue');
    expect(code(() => parseDeviceSync({ ...sync, enabledActions: ['execute_script'] }))).toBe('invalid_sync');
  });
});
