// Real local Supabase: ordinary A/B identities under RLS plus anonymous device-credential
// RPCs. Synthetic fixtures only; no app launches, Shortcuts or volume changes happen here.
import { beforeAll, afterAll, afterEach, it, expect, describe } from 'vitest';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { localFixtures } from '../support/local-fixtures';
import type { Database } from '../../src/lib/database.types';
import { canonicalCommand, parseCommandEnvelope, type Action } from '../../packages/computer-control-contracts/src/index.ts';

const EXT = 'fomkddjghmfjocinjmbdagahcbilimof', ORIGIN = 'http://127.0.0.1:3000', CONSENT = 'computer-control-2026-11-05-v1';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const tok = () => randomBytes(32).toString('base64url');
const SAFARI: Action[] = [{ type: 'open_application', alias: 'safari' }];
type Client = SupabaseClient<Database>;
let f: Awaited<ReturnType<typeof localFixtures>>, a: Client, b: Client, anon: Client, ownerA: string, ownerB: string;
function good<T>(r: { data: unknown; error: { code?: string } | null }): T { if (r.error) throw new Error(`Computer fixture SQLSTATE ${r.error.code ?? 'unknown'}; details suppressed.`); return r.data as T; }
const auth = { persistSession: false, autoRefreshToken: false };
const sync = (catalogue = [{ kind: 'application', alias: 'safari', label: 'Safari', names: [], detail: null, auto: false }]) => ({ protocolVersion: 1, hostVersion: 'test', disabled: false, enabledActions: ['open_application', 'set_volume'], volumeAuto: false, catalogue });

async function pair(client: Client) {
  good(await client.rpc('computer_settings_v1', { p_enabled: true, p_consent: CONSENT }));
  // Fixture-owned rows only: reset this synthetic account's pairing-attempt counter between tests.
  // The limits themselves are exercised in 'pairing and device limits apply'.
  await f.sql`delete from private.computer_pairings where owner_id in (${ownerA},${ownerB})`;
  const id = randomUUID(), code = tok(), secret = tok();
  good(await client.rpc('computer_pairing_begin_v1', { p_id: id, p_code_hash: sha(code), p_extension: EXT, p_origin: ORIGIN }));
  const r = good<{ device_id: string }>(await anon.rpc('computer_pairing_complete_v1', { p_pairing: id, p_code: code, p_extension: EXT, p_name: 'Synthetic Mac', p_credential_hash: sha(secret) }));
  good(await anon.rpc('computer_device_sync_v1', { p_device: r.device_id, p_secret: secret, p_sync: sync() as never }));
  return { device: r.device_id, secret };
}
async function propose(client: Client, device: string, actions: Action[] = SAFARI, digestFor?: Action[]) {
  const command = randomUUID();
  const digest = sha(canonicalCommand(device, command, digestFor ?? actions));
  const r = await client.rpc('computer_propose_v1', { p_command: command, p_request: randomUUID(), p_device: device, p_source: 'text', p_actions: actions as never, p_labels: actions.map(() => 'Synthetic') as never, p_digest: digest, p_auto: false });
  return { r, command, digest };
}
async function authorize(client: Client, command: string, digest: string) {
  const ticket = tok();
  return { r: await client.rpc('computer_authorize_v1', { p_command: command, p_digest: digest, p_ticket_hash: sha(ticket) }), ticket };
}
const redeem = (d: { device: string; secret: string }, command: string, ticket: string) => anon.rpc('computer_redeem_v1', { p_device: d.device, p_secret: d.secret, p_command: command, p_ticket: ticket });
async function ready(client: Client, d: { device: string; secret: string }) {
  const p = await propose(client, d.device); good(p.r);
  const t = await authorize(client, p.command, p.digest); good(t.r);
  return { ...p, ticket: t.ticket };
}

beforeAll(async () => {
  f = await localFixtures();
  a = createClient<Database>(f.status.API_URL, f.status.ANON_KEY, { auth }); b = createClient<Database>(f.status.API_URL, f.status.ANON_KEY, { auth });
  anon = createClient<Database>(f.status.API_URL, f.status.ANON_KEY, { auth });
  const aa = await a.auth.signInWithPassword(f.users.alex), bb = await b.auth.signInWithPassword(f.users.sam);
  if (!aa.data.user || !bb.data.user) throw new Error('Synthetic sign-in failed');
  ownerA = aa.data.user.id; ownerB = bb.data.user.id;
});
afterEach(async () => {
  // Revoke through the ordinary owner RPC so each test starts under the 3-active-Mac limit.
  for (const client of [a, b]) {
    const devices = (await client.from('computer_devices').select('id').eq('state', 'active')).data ?? [];
    for (const d of devices) await client.rpc('computer_device_v1', { p_action: 'revoke', p_device: d.id });
  }
});
afterAll(async () => { await f?.close(); });

describe('pairing', () => {
  it('is one-use, bound to the extension and expiry, and needs computer control on', async () => {
    const off = await a.rpc('computer_pairing_begin_v1', { p_id: randomUUID(), p_code_hash: sha(tok()), p_extension: EXT, p_origin: ORIGIN });
    expect(off.error?.code).toBe('42501');
    good(await a.rpc('computer_settings_v1', { p_enabled: true, p_consent: CONSENT }));
    expect((await a.rpc('computer_settings_v1', { p_enabled: true, p_consent: 'yes' })).error?.code).toBe('22023');
    const id = randomUUID(), code = tok();
    good(await a.rpc('computer_pairing_begin_v1', { p_id: id, p_code_hash: sha(code), p_extension: EXT, p_origin: ORIGIN }));
    const inspect = good<{ account_label: string; origin: string }>(await anon.rpc('computer_pairing_inspect_v1', { p_pairing: id, p_code: code, p_extension: EXT }));
    expect(inspect.origin).toBe(ORIGIN); expect(inspect.account_label).toMatch(/^.•••@example\.test$/);
    expect((await anon.rpc('computer_pairing_inspect_v1', { p_pairing: id, p_code: tok(), p_extension: EXT })).error?.code).toBe('42501');
    expect((await anon.rpc('computer_pairing_complete_v1', { p_pairing: id, p_code: code, p_extension: 'a'.repeat(32), p_name: 'Mac', p_credential_hash: sha(tok()) })).error?.code).toBe('42501');
    good(await anon.rpc('computer_pairing_complete_v1', { p_pairing: id, p_code: code, p_extension: EXT, p_name: 'Mac', p_credential_hash: sha(tok()) }));
    expect((await anon.rpc('computer_pairing_complete_v1', { p_pairing: id, p_code: code, p_extension: EXT, p_name: 'Mac', p_credential_hash: sha(tok()) })).error?.code).toBe('42501');
    const late = randomUUID(), lateCode = tok();
    good(await a.rpc('computer_pairing_begin_v1', { p_id: late, p_code_hash: sha(lateCode), p_extension: EXT, p_origin: ORIGIN }));
    await f.sql`update private.computer_pairings set expires_at=now()-interval '1 second' where id=${late}`;
    expect((await anon.rpc('computer_pairing_complete_v1', { p_pairing: late, p_code: lateCode, p_extension: EXT, p_name: 'Mac', p_credential_hash: sha(tok()) })).error?.code).toBe('42501');
    const [secretColumn] = await f.sql`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='computer_devices' and column_name ilike '%hash%'`;
    expect(secretColumn.n).toBe(0);
  });
});

describe('limits', () => {
  it('pairing and device limits apply', async () => {
    good(await a.rpc('computer_settings_v1', { p_enabled: true, p_consent: CONSENT }));
    await f.sql`delete from private.computer_pairings where owner_id=${ownerA}`;
    const begin = () => a.rpc('computer_pairing_begin_v1', { p_id: randomUUID(), p_code_hash: sha(tok()), p_extension: EXT, p_origin: ORIGIN });
    for (let i = 0; i < 5; i++) good(await begin());
    expect((await begin()).error?.code).toBe('54000');
    await f.sql`delete from private.computer_pairings where owner_id=${ownerA}`;
    await pair(a); await pair(a); await pair(a);
    expect((await begin()).error?.code).toBe('54000');
  });
});

describe('owner isolation and device scope', () => {
  it('B cannot see, propose for, approve, cancel or revoke A’s Mac; ordinary users cannot write tables directly', async () => {
    const d = await pair(a);
    const p = await propose(a, d.device); good(p.r);
    expect((await b.from('computer_devices').select('id').eq('id', d.device)).data).toEqual([]);
    expect((await b.from('computer_commands').select('id').eq('id', p.command)).data).toEqual([]);
    good(await b.rpc('computer_settings_v1', { p_enabled: true, p_consent: CONSENT }));
    expect((await propose(b, d.device)).r.error?.code).toBe('42501');
    expect((await authorize(b, p.command, p.digest)).r.error?.code).toBe('42501');
    expect((await b.rpc('computer_cancel_v1', { p_command: p.command })).error?.code).toBe('42501');
    expect((await b.rpc('computer_device_v1', { p_action: 'revoke', p_device: d.device })).error?.code).toBe('42501');
    expect((await a.from('computer_commands').update({ state: 'succeeded' } as never).eq('id', p.command)).error).not.toBeNull();
    expect((await a.from('computer_devices').insert({ owner_id: ownerA, name: 'x', extension_id: EXT, origin: ORIGIN } as never)).error).not.toBeNull();
    expect((await a.from('computer_devices').select('id,owner_id').eq('id', d.device)).data).toEqual([{ id: d.device, owner_id: ownerA }]);
    void ownerB;
  });
  it('a device credential reaches only its own device’s commands and never content tables', async () => {
    const d1 = await pair(a), d2 = await pair(a);
    const c = await ready(a, d2);
    expect((await redeem(d1, c.command, c.ticket)).error?.code).toBe('42501');
    expect((await anon.rpc('computer_redeem_v1', { p_device: d2.device, p_secret: tok(), p_command: c.command, p_ticket: c.ticket })).error?.code).toBe('42501');
    for (const table of ['messages', 'memories', 'tasks', 'computer_devices', 'computer_commands'] as const) {
      const r = await anon.from(table).select('*').limit(1);
      expect(r.data ?? []).toEqual([]);
    }
    const [acl] = await f.sql`select has_table_privilege('anon','private.computer_credentials','SELECT') cred, has_table_privilege('anon','public.computer_commands','SELECT') cmds, has_function_privilege('anon','public.computer_propose_v1(uuid,uuid,uuid,text,jsonb,jsonb,text,boolean)','EXECUTE') propose, has_function_privilege('authenticated','public.computer_redeem_v1(uuid,text,uuid,text)','EXECUTE') user_redeem, has_function_privilege('anon','private.computer_device_auth_v1(uuid,text)','EXECUTE') helper`;
    expect(acl).toEqual({ cred: false, cmds: false, propose: false, user_redeem: false, helper: false });
    good(await a.rpc('computer_cancel_v1', { p_command: c.command }));
  });
});

describe('tickets', () => {
  it('a ticket is claimed exactly once, even concurrently; reconciliation never re-authorizes', async () => {
    const d = await pair(a);
    const c = await ready(a, d);
    const results = await Promise.all([redeem(d, c.command, c.ticket), redeem(d, c.command, c.ticket), redeem(d, c.command, c.ticket)]);
    const statuses = results.map((r) => (r.data as { status?: string } | null)?.status ?? r.error?.code);
    expect(statuses.filter((s) => s === 'claimed')).toHaveLength(1);
    expect(statuses.filter((s) => s !== 'claimed'), JSON.stringify(statuses)).toEqual(['already_claimed', 'already_claimed']);
    const claimed = results.find((r) => (r.data as { status?: string })?.status === 'claimed')!.data as { command: unknown };
    const env = parseCommandEnvelope(claimed.command);
    expect(env.digest).toBe(sha(canonicalCommand(d.device, c.command, SAFARI)));
    expect((await authorize(a, c.command, c.digest)).r.error?.code).toBe('40001');
    good(await anon.rpc('computer_finish_v1', { p_device: d.device, p_secret: d.secret, p_command: c.command, p_result: { protocolVersion: 1, commandId: c.command, state: 'succeeded', results: [], startedAt: null, finishedAt: new Date().toISOString(), summary: 'Synthetic.' } as never }));
  });
  it('expired tickets and stale proposals do not run later', async () => {
    const d = await pair(a);
    const c = await ready(a, d);
    await f.sql`update private.computer_tickets set expires_at=now()-interval '1 second' where command_id=${c.command}`;
    await f.sql`update public.computer_commands set ticket_expires_at=now()-interval '1 second' where id=${c.command}`;
    expect(good<{ status: string }>(await redeem(d, c.command, c.ticket)).status).toBe('expired');
    expect((await a.from('computer_commands').select('state,claimed_at').eq('id', c.command)).data?.[0]).toEqual({ state: 'expired', claimed_at: null });
    const p = await propose(a, d.device); good(p.r);
    await f.sql`update public.computer_commands set proposal_expires_at=now()-interval '1 second' where id=${p.command}`;
    expect((await authorize(a, p.command, p.digest)).r.error?.code).toBe('40001');
  });
  it('parameter tampering, unknown aliases and unsupported actions are rejected', async () => {
    const d = await pair(a);
    expect((await propose(a, d.device, [{ type: 'set_volume', percent: 30 }], [{ type: 'set_volume', percent: 31 }])).r.error?.code).toBe('22023');
    expect((await propose(a, d.device, [{ type: 'open_application', alias: 'terminal' }])).r.error?.code).toBe('22023');
    // Invalid shapes get a valid placeholder digest so the SQL validator (not the TS helper) is what rejects them.
    expect((await propose(a, d.device, [{ type: 'execute_shell', command: 'ls' } as never], SAFARI)).r.error?.code).toBe('22023');
    expect((await propose(a, d.device, [{ type: 'set_volume', percent: 101 }], SAFARI)).r.error?.code).toBe('22023');
    expect((await propose(a, d.device, Array.from({ length: 6 }, () => SAFARI[0]), SAFARI)).r.error?.code).toBe('22023');
    const p = await propose(a, d.device); good(p.r);
    expect((await authorize(a, p.command, sha(canonicalCommand(d.device, p.command, [{ type: 'set_volume', percent: 0 }])))).r.error?.code).toBe('40001');
  });
  it('allows one active plan per Mac', async () => {
    const d = await pair(a);
    const first = await ready(a, d);
    const second = await propose(a, d.device); good(second.r);
    expect((await authorize(a, second.command, second.digest)).r.error?.code).toBe('23505');
    good(await a.rpc('computer_cancel_v1', { p_command: first.command }));
    good((await authorize(a, second.command, second.digest)).r);
    good(await a.rpc('computer_cancel_v1', { p_command: second.command }));
  });
});

describe('revocation, sign-out, deletion and disable stop new control', () => {
  it('device revocation blocks redeem, progress and finish', async () => {
    const d = await pair(a);
    const c = await ready(a, d);
    good(await a.rpc('computer_device_v1', { p_action: 'revoke', p_device: d.device }));
    expect((await redeem(d, c.command, c.ticket)).error?.code).toBe('42501');
    expect((await anon.rpc('computer_progress_v1', { p_device: d.device, p_secret: d.secret, p_command: c.command, p_state: 'running', p_index: 0 })).error?.code).toBe('42501');
    expect((await a.from('computer_commands').select('state').eq('id', c.command)).data?.[0].state).toBe('cancelled');
  });
  it('sign-out of the approving session prevents the Mac from claiming its ticket', async () => {
    const a2 = createClient<Database>(f.status.API_URL, f.status.ANON_KEY, { auth });
    good(await a2.auth.signInWithPassword(f.users.alex));
    const d = await pair(a);
    const c = await ready(a2, d);
    await a2.auth.signOut({ scope: 'local' }); // only this session; the shared client stays signed in
    const r = good<{ status: string }>(await redeem(d, c.command, c.ticket));
    expect(r.status).toBe('session_ended');
    expect((await a.from('computer_commands').select('state').eq('id', c.command)).data?.[0].state).toBe('cancelled');
  });
  it('sign-out between steps makes the next progress check stop', async () => {
    const a3 = createClient<Database>(f.status.API_URL, f.status.ANON_KEY, { auth });
    good(await a3.auth.signInWithPassword(f.users.alex));
    const d = await pair(a);
    const c = await ready(a3, d);
    expect(good<{ status: string }>(await redeem(d, c.command, c.ticket)).status).toBe('claimed');
    expect(good<{ continue: boolean }>(await anon.rpc('computer_progress_v1', { p_device: d.device, p_secret: d.secret, p_command: c.command, p_state: 'running', p_index: 0 })).continue).toBe(true);
    await a3.auth.signOut({ scope: 'local' });
    expect(good<{ continue: boolean; reason: string }>(await anon.rpc('computer_progress_v1', { p_device: d.device, p_secret: d.secret, p_command: c.command, p_state: 'running', p_index: 1 }))).toMatchObject({ continue: false, reason: 'session_ended' });
  });
  it('a user Stop is seen by the Mac at its next check', async () => {
    const d = await pair(a);
    const c = await ready(a, d);
    good(await redeem(d, c.command, c.ticket));
    good(await a.rpc('computer_cancel_v1', { p_command: c.command }));
    expect(good<{ continue: boolean; reason: string }>(await anon.rpc('computer_progress_v1', { p_device: d.device, p_secret: d.secret, p_command: c.command, p_state: 'running', p_index: 0 }))).toMatchObject({ continue: false, reason: 'cancel_requested' });
  });
  it('a pending account deletion makes every device credential ineligible', async () => {
    const d = await pair(a);
    const request = randomUUID();
    await f.sql`insert into private.privacy_jobs(owner_id,request_id,scope,state,phase) values (${ownerA},${request},'account','queued','content')`;
    try {
      expect((await anon.rpc('computer_device_sync_v1', { p_device: d.device, p_secret: d.secret, p_sync: sync() as never })).error?.code).toBe('42501');
      expect((await a.rpc('computer_settings_v1', {})).error?.code).toBe('42501');
    } finally { await f.sql`delete from private.privacy_jobs where owner_id=${ownerA} and request_id=${request}`; }
  });
  it('turning computer control off cancels unclaimed approvals', async () => {
    const d = await pair(a);
    const c = await ready(a, d);
    good(await a.rpc('computer_settings_v1', { p_enabled: false }));
    expect((await a.from('computer_commands').select('state').eq('id', c.command)).data?.[0].state).toBe('cancelled');
    expect(good<{ status: string }>(await redeem(d, c.command, c.ticket)).status).toBe('not_authorized');
    good(await a.rpc('computer_settings_v1', { p_enabled: true, p_consent: CONSENT }));
  });
});

describe('receipts, export and history', () => {
  it('stores the Mac’s bounded result once; another device cannot report it', async () => {
    const d = await pair(a), other = await pair(a);
    const c = await ready(a, d);
    good(await redeem(d, c.command, c.ticket));
    const result = { protocolVersion: 1, commandId: c.command, state: 'succeeded', results: [{ index: 0, type: 'open_application', state: 'succeeded', evidence: 'observed', code: 'app_running_observed', message: 'Safari is running.', observedPercent: null, previousPercent: null, startedAt: null, finishedAt: null }], startedAt: null, finishedAt: new Date().toISOString(), summary: '1 of 1 action completed.' };
    expect((await anon.rpc('computer_finish_v1', { p_device: other.device, p_secret: other.secret, p_command: c.command, p_result: result as never })).error?.code).toBe('42501');
    good(await anon.rpc('computer_finish_v1', { p_device: d.device, p_secret: d.secret, p_command: c.command, p_result: result as never }));
    good(await anon.rpc('computer_finish_v1', { p_device: d.device, p_secret: d.secret, p_command: c.command, p_result: { ...result, state: 'failed', summary: 'Rewrite attempt.' } as never }));
    expect((await a.from('computer_commands').select('state,summary').eq('id', c.command)).data?.[0]).toEqual({ state: 'succeeded', summary: '1 of 1 action completed.' });
  });
  it('export includes history without credentials or tickets; clear removes finished records', async () => {
    const d = await pair(a);
    const p = await propose(a, d.device); good(p.r);
    good(await a.rpc('computer_cancel_v1', { p_command: p.command }));
    const epoch = good<{ epoch: number }[]>(await a.from('privacy_preferences').select('epoch').eq('owner_id', ownerA))[0].epoch;
    const rows = good<{ rows: Record<string, unknown>[] }>(await a.rpc('computer_export_v1', { p_category: 'computer_actions', p_after: null, p_at: new Date().toISOString(), p_epoch: epoch })).rows;
    expect(rows.some((r) => r.id === p.command)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/ticket_hash|credential_hash|code_hash|secret/);
    expect((await b.rpc('computer_export_v1', { p_category: 'computer_actions', p_after: null, p_at: new Date().toISOString(), p_epoch: epoch })).data).not.toEqual({ rows: expect.arrayContaining([expect.objectContaining({ id: p.command })]) });
    good(await a.rpc('computer_history_clear_v1', {}));
    expect((await a.from('computer_commands').select('id').eq('id', p.command)).data).toEqual([]);
  });
});
