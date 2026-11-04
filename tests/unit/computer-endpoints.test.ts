// HTTP route gates with mocked Supabase. Deployed RLS/RPC behaviour is covered by
// tests/integration/computer-control.test.ts against a real local database.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
const h = vi.hoisted(() => ({ account: vi.fn(), rpc: vi.fn(), from: vi.fn(), deviceRpc: vi.fn(), owner: '11111111-1111-4111-8111-111111111111' }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/config', () => ({ getConfig: () => ({ APP_ORIGIN: 'http://127.0.0.1:3000', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic' }) }));
vi.mock('../../src/lib/conversation/api', async () => ({ ...await vi.importActual<typeof import('../../src/lib/conversation/api')>('../../src/lib/conversation/api'), accountFor: h.account }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: h.deviceRpc }) }));
import { POST as proposals } from '../../src/app/api/v1/computer/proposals/route';
import { POST as commands } from '../../src/app/api/v1/computer/commands/route';
import { POST as pairings } from '../../src/app/api/v1/computer/pairings/route';
import { POST as settings } from '../../src/app/api/v1/computer/route';
import { POST as device } from '../../src/app/api/v1/computer/device/[action]/route';
import { ContentError } from '../../src/lib/conversation/api';
import { canonicalCommand } from '../../packages/computer-control-contracts/src/index.ts';
import fixtures from '../../packages/computer-control-contracts/fixtures/contract-cases.json';

const DEVICE = '3f0c1a52-8d4e-4b6a-9c1d-2e7f5a6b8c90';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const req = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://127.0.0.1:3000${url}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const deviceReq = (action: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://127.0.0.1:3000/api/v1/computer/device/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Device-Protocol': '1', 'X-Jarvis-Device': DEVICE, Authorization: `Bearer ${'S'.repeat(43)}`, ...headers }, body: JSON.stringify(body) });
const params = (action: string) => ({ params: Promise.resolve({ action }) });
let enabled = true;
const deviceRow = { id: DEVICE, owner_id: h.owner, state: 'active', disabled: false, enabled_actions: ['open_application', 'set_volume', 'run_shortcut'], volume_auto: false, catalogue: [{ kind: 'application', alias: 'safari', label: 'Safari', names: [], detail: null, auto: false }, { kind: 'shortcut', alias: 'study-setup', label: 'Study Setup', names: [], detail: null, auto: false }] };
beforeEach(() => {
  vi.clearAllMocks(); enabled = true;
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: deviceRow, error: null }) };
  h.from.mockReturnValue(chain);
  h.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ data: name === 'computer_settings_v1' ? { enabled } : name === 'computer_propose_v1' ? { id: args.p_command, digest: args.p_digest, state: 'proposed', labels: args.p_labels, ticket_hash: 'NEVER' } : name === 'computer_authorize_v1' ? { command_id: args.p_command, state: 'authorized', ticket_expires_at: 'x' } : { pairing_id: args.p_id, expires_at: 'x' }, error: null }));
  h.account.mockResolvedValue({ client: { rpc: h.rpc, from: h.from }, profile: { owner_id: h.owner } });
});

describe('proposals', () => {
  it('require a verified session and same-origin mutation; owner fields are refused', async () => {
    h.account.mockRejectedValueOnce(new ContentError(401, 'Session ended'));
    expect((await proposals(req('/api/v1/computer/proposals', { request_id: crypto.randomUUID(), device_id: DEVICE, text: 'Open Safari', source: 'text', temporary: false }))).status).toBe(401);
    const r = req('/api/v1/computer/proposals', { request_id: crypto.randomUUID(), device_id: DEVICE, text: 'Open Safari', source: 'text', temporary: false, owner_id: h.owner, confirmed: true });
    expect((await proposals(r)).status).toBe(422);
    expect(h.account).toHaveBeenLastCalledWith(r, true);
  });
  it('compute the digest server-side and never return ticket material', async () => {
    const res = await proposals(req('/api/v1/computer/proposals', { request_id: crypto.randomUUID(), device_id: DEVICE, text: 'Open Safari and set volume to 30', source: 'voice', temporary: false }));
    const body = await res.json();
    expect(body.kind).toBe('proposal');
    const call = h.rpc.mock.calls.find((c) => c[0] === 'computer_propose_v1')![1];
    expect(call.p_actions).toEqual([{ type: 'open_application', alias: 'safari' }, { type: 'set_volume', percent: 30 }]);
    expect(call.p_digest).toBe(sha(canonicalCommand(DEVICE, call.p_command, call.p_actions)));
    expect(call.p_source).toBe('voice');
    expect(JSON.stringify(body)).not.toContain('NEVER');
  });
  it('refuse computer actions in temporary chat without saving anything', async () => {
    const body = await (await proposals(req('/api/v1/computer/proposals', { request_id: crypto.randomUUID(), device_id: DEVICE, text: 'Open Safari', source: 'text', temporary: true }))).json();
    expect(body).toMatchObject({ kind: 'clarification', message: expect.stringContaining('temporary chat') });
    expect(h.rpc.mock.calls.some((c) => c[0] === 'computer_propose_v1')).toBe(false);
  });
  it('leave ordinary conversation untouched and do nothing when computer control is off', async () => {
    expect(await (await proposals(req('/api/v1/computer/proposals', { request_id: crypto.randomUUID(), device_id: DEVICE, text: 'What is a black hole?', source: 'text', temporary: false }))).json()).toEqual({ kind: 'not_command' });
    enabled = false;
    expect(await (await proposals(req('/api/v1/computer/proposals', { request_id: crypto.randomUUID(), device_id: DEVICE, text: 'Open Safari', source: 'text', temporary: false }))).json()).toEqual({ kind: 'not_command' });
    expect(h.rpc.mock.calls.some((c) => c[0] === 'computer_propose_v1')).toBe(false);
  });
});

describe('authorization, pairing and settings', () => {
  it('authorization sends only a ticket hash and returns the ticket once to the owner', async () => {
    const command = crypto.randomUUID(), digest = 'a'.repeat(64);
    const body = await (await commands(req('/api/v1/computer/commands', { action: 'authorize', command_id: command, digest }))).json();
    const call = h.rpc.mock.calls.find((c) => c[0] === 'computer_authorize_v1')![1];
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(call.p_ticket_hash).toBe(sha(body.ticket));
    expect(JSON.stringify(call)).not.toContain(body.ticket);
    expect((await commands(req('/api/v1/computer/commands', { action: 'authorize', command_id: command, digest: 'yes' }))).status).toBe(422);
    expect((await commands(req('/api/v1/computer/commands', { action: 'authorize', command_id: command, digest, confirmed: 'yes' }))).status).toBe(422);
  });
  it('pairing accepts only the configured extension and stores only a code hash', async () => {
    expect((await pairings(req('/api/v1/computer/pairings', { extension_id: 'a'.repeat(32) }))).status).toBe(422);
    const body = await (await pairings(req('/api/v1/computer/pairings', { extension_id: 'fomkddjghmfjocinjmbdagahcbilimof' }))).json();
    const call = h.rpc.mock.calls.find((c) => c[0] === 'computer_pairing_begin_v1')![1];
    expect(call.p_code_hash).toBe(sha(body.code)); expect(call.p_origin).toBe('http://127.0.0.1:3000');
  });
  it('enabling requires the exact disclosure version', async () => {
    expect((await settings(req('/api/v1/computer', { action: 'settings', enabled: true, consent: null }))).status).toBe(422);
    expect((await settings(req('/api/v1/computer', { action: 'settings', enabled: true, consent: 'yes' }))).status).toBe(422);
    expect((await settings(req('/api/v1/computer', { action: 'settings', enabled: true, consent: 'computer-control-2026-11-05-v1' }))).status).toBe(200);
  });
});

describe('device endpoints', () => {
  it('refuse browser-originated requests and malformed credentials before any RPC', async () => {
    for (const extra of [{ Origin: 'http://127.0.0.1:3000' }, { Cookie: 'sb=1' }, { 'Sec-Fetch-Site': 'same-origin' }] as Record<string, string>[]) expect((await device(deviceReq('sync', {}, extra), params('sync'))).status).toBe(403);
    expect((await device(deviceReq('sync', {}, { 'X-Jarvis-Device-Protocol': '2' }), params('sync'))).status).toBe(400);
    expect((await device(deviceReq('redeem', { commandId: DEVICE, ticket: 'T'.repeat(43) }, { Authorization: 'Bearer short' }), params('redeem'))).status).toBe(401);
    expect(h.deviceRpc).not.toHaveBeenCalled();
  });
  it('re-validate the redeemed envelope and bind it to the requesting device', async () => {
    const env = fixtures.validEnvelopes[0];
    h.deviceRpc.mockResolvedValue({ data: { status: 'claimed', command: env, account_label: 'b•••@example.test', origin: 'http://127.0.0.1:3000' }, error: null });
    const ok = await device(deviceReq('redeem', { commandId: env.commandId, ticket: 'T'.repeat(43) }), params('redeem'));
    expect(ok.status).toBe(200); expect((await ok.json()).command.digest).toBe(env.digest);
    h.deviceRpc.mockResolvedValue({ data: { status: 'claimed', command: { ...env, deviceId: '22222222-2222-4222-8222-222222222222' } }, error: null });
    expect((await device(deviceReq('redeem', { commandId: env.commandId, ticket: 'T'.repeat(43) }), params('redeem'))).status).toBe(503);
    h.deviceRpc.mockResolvedValue({ data: { status: 'claimed', command: { ...env, actions: [{ type: 'execute_shell', command: 'x' }] } }, error: null });
    expect((await device(deviceReq('redeem', { commandId: env.commandId, ticket: 'T'.repeat(43) }), params('redeem'))).status).toBe(422);
  });
  it('validate results strictly and never echo database messages', async () => {
    const result = fixtures.validResults[0];
    expect((await device(deviceReq('finish', { ...result, stdout: 'SECRET OUTPUT' }), params('finish'))).status).toBe(422);
    h.deviceRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'SECRET DETAIL' } });
    const r = await device(deviceReq('finish', result), params('finish'));
    expect(r.status).toBe(401); expect(JSON.stringify(await r.json())).not.toContain('SECRET');
  });
  it('pairing inspection refuses a pairing issued for another origin', async () => {
    h.deviceRpc.mockResolvedValue({ data: { account_label: 'x', origin: 'https://other.example', expires_at: 'x' }, error: null });
    expect((await device(deviceReq('pairing-inspect', { pairingId: DEVICE, code: 'C'.repeat(43), extensionId: 'fomkddjghmfjocinjmbdagahcbilimof' }), params('pairing-inspect'))).status).toBe(401);
  });
});
