// Cross-language integration: Swift companion core (real HTTPBackend/HostRouter/
// CommandEngine, FAKE confirmer + record-only executor) ⇄ real JARVIS device routes
// (`next start`, mock-only) ⇄ real local Supabase. Synthetic fixture accounts only.
// Requires: local Supabase running, .env.local, a production build, Docker.
// Usage: pnpm companion:e2e
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { localFixtures } from '../tests/support/local-fixtures.ts';
import { canonicalCommand } from '../packages/computer-control-contracts/src/index.ts';

const root = new URL('../', import.meta.url).pathname;
const image = process.env.JARVIS_SWIFT_IMAGE ?? 'swift:6.1.2-noble';
const ORIGIN = 'http://127.0.0.1:3000', EXT = 'fomkddjghmfjocinjmbdagahcbilimof', CONSENT = 'computer-control-2026-11-05-v1';
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const tok = () => randomBytes(32).toString('base64url');
const good = (r) => { if (r.error) throw new Error(`SQLSTATE ${r.error.code ?? 'unknown'} (details suppressed)`); return r.data; };
const results = {}; const failures = [];
const check = (name, ok, detail = '') => { results[name] = ok ? 'pass' : `FAIL ${String(detail).slice(0, 300)}`; if (!ok) failures.push(name); };

const state = mkdtempSync(join(tmpdir(), 'jarvis-companion-e2e-')); chmodSync(state, 0o700);
function swift(...args) {
  let out;
  // Errors never echo the argument list: it contains one-use synthetic tickets/codes.
  try { out = execFileSync('docker', ['run', '--rm', '--network', 'host', '-v', `${root}:/src:ro`, '-v', `${state}:/state`, '-v', 'jarvis-companion-e2e-build:/build', image,
    'swift', 'run', '-c', 'debug', '--package-path', '/src/apps/jarvis-mac-companion', '--scratch-path', '/build', 'CompanionE2E', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 600_000 }); }
  // eslint-disable-next-line preserve-caught-error -- the cause's command line holds one-use synthetic tickets/codes.
  catch (error) { throw new Error(`Swift harness '${args[0]}' failed (exit ${error.status ?? 'unknown'}); rerun 'swift build --product CompanionE2E' to see compiler output.`); }
  return JSON.parse(out.trim().split('\n').at(-1));
}
const server = spawn(join(root, 'node_modules/.bin/next'), ['start', '--hostname', '127.0.0.1', '--port', '3000'], { cwd: root, env: { ...process.env, JARVIS_MOCK_ONLY: '1', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
let f;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${ORIGIN}/sign-in`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  f = await localFixtures();
  const a = createClient(f.status.API_URL, f.status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await a.auth.signInWithPassword(f.users.alex);
  if (!signed.data.user) throw new Error('Synthetic sign-in failed');
  good(await a.rpc('computer_settings_v1', { p_enabled: true, p_consent: CONSENT }));
  const pairingId = randomUUID(), code = tok();
  good(await a.rpc('computer_pairing_begin_v1', { p_id: pairingId, p_code_hash: sha(code), p_extension: EXT, p_origin: ORIGIN }));

  const paired = swift('pair', '/state', ORIGIN, EXT, pairingId, code);
  const deviceId = paired.deviceId;
  check('Swift pairs through the real device routes after (fake) native approval', paired.responses[0]?.ok === true && /^[0-9a-f-]{36}$/.test(deviceId ?? ''), JSON.stringify(paired));
  const device = good(await a.from('computer_devices').select('id,state,catalogue').eq('id', deviceId).maybeSingle());
  const sorted = (o) => JSON.stringify(o, Object.keys(o).sort()); // jsonb does not preserve key order
  check('catalogue sync published aliases only (no bundle IDs/paths)', device?.state === 'active' && device.catalogue.length === 1 && sorted(device.catalogue[0]) === sorted({ kind: 'application', alias: 'safari', label: 'Safari', names: [], detail: null, auto: false }) && !JSON.stringify(device).includes('com.apple'), JSON.stringify(device));

  async function approved(actions) {
    const command = randomUUID(), digest = sha(canonicalCommand(deviceId, command, actions)), ticket = tok();
    good(await a.rpc('computer_propose_v1', { p_command: command, p_request: randomUUID(), p_device: deviceId, p_source: 'text', p_actions: actions, p_labels: actions.map(() => 'E2E'), p_digest: digest, p_auto: false }));
    good(await a.rpc('computer_authorize_v1', { p_command: command, p_digest: digest, p_ticket_hash: sha(ticket) }));
    return { command, ticket };
  }
  const plan = [{ type: 'open_application', alias: 'safari' }, { type: 'set_volume', percent: 30 }];
  const c1 = await approved(plan);
  const run = swift('execute', '/state', c1.command, c1.ticket);
  const result = run.responses[0]?.payload?.result;
  check('Swift redeems, re-checks progress per step and reports a validated result', run.responses[0]?.ok === true && result?.state === 'succeeded' && result.results.length === 2, JSON.stringify(run));
  const row = good(await a.from('computer_commands').select('state,results,claimed_at').eq('id', c1.command).maybeSingle());
  check('server recorded the Mac’s result, including dispatched-only evidence', row?.state === 'succeeded' && row.results.every((r) => r.evidence === 'dispatched') && row.claimed_at !== null, JSON.stringify(row));
  const replay = swift('execute', '/state', c1.command, c1.ticket);
  check('replaying the same ticket is refused locally without re-execution', replay.responses[0]?.ok === false && replay.responses[0]?.error?.code === 'duplicate', JSON.stringify(replay));

  const c2 = await approved([{ type: 'open_application', alias: 'safari' }]);
  const stopped = swift('cancel-during-confirm', '/state', c2.command, c2.ticket);
  const r2 = good(await a.from('computer_commands').select('state').eq('id', c2.command).maybeSingle());
  check('Stop during native confirmation runs nothing and records cancelled', stopped.responses[0]?.payload?.result?.state === 'cancelled' && r2?.state === 'cancelled', JSON.stringify({ stopped, r2 }));

  const c3 = await approved([{ type: 'set_volume', percent: 10 }]);
  good(await a.rpc('computer_device_v1', { p_action: 'revoke', p_device: deviceId }));
  const revoked = swift('execute', '/state', c3.command, c3.ticket);
  check('after server-side revocation the Mac cannot redeem new approvals', revoked.responses[0]?.ok === false && revoked.responses[0]?.error?.code === 'revoked', JSON.stringify(revoked));
} finally {
  server.kill('SIGTERM');
  await f?.close().catch(() => {});
  rmSync(state, { recursive: true, force: true });
}
console.log(JSON.stringify({ swiftImage: image, results }, null, 1));
if (failures.length) process.exit(1);
