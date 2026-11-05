// Real-Chrome check of the bridge extension + native messaging, using a Node
// TEST-DOUBLE native host (it executes nothing). Proves Chrome-side behaviour:
// manifest key → extension ID, externally_connectable, exact-origin/top-frame
// sender checks, native-host manifest lookup, framing and origin injection.
// Usage: pnpm bridge:check   (needs a Chrome/Chromium that honours --load-extension;
// set JARVIS_CHROME=/path/to/chrome, e.g. Chrome for Testing or Chromium)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url).pathname;
const chrome = process.env.JARVIS_CHROME ?? ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/chromium'].find(existsSync);
if (!chrome) throw new Error('Set JARVIS_CHROME to a Chrome for Testing/Chromium binary.');
const EXPECTED_ID = 'fomkddjghmfjocinjmbdagahcbilimof';
execFileSync(process.execPath, [join(root, 'scripts/build-bridge.mjs')], { stdio: 'inherit' });
const dist = join(root, 'apps/jarvis-browser-bridge/dist');
const work = mkdtempSync(join(tmpdir(), 'jarvis-bridge-check-'));
const profile = join(work, 'profile'), log = join(work, 'host.log');
mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
const hostScript = join(work, 'fake-host.mjs'), hostWrapper = join(work, 'fake-host.sh');
writeFileSync(hostScript, `
import { appendFileSync } from 'node:fs';
const log = ${JSON.stringify(log)};
appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');
let buf = Buffer.alloc(0);
function send(o) { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); process.stdout.write(Buffer.concat([h, b])); }
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0); if (buf.length < 4 + n) break;
    const m = JSON.parse(buf.subarray(4, 4 + n).toString()); buf = buf.subarray(4 + n);
    appendFileSync(log, JSON.stringify({ frame: m }) + '\\n');
    if (m.type === 'hello') send({ v: 1, id: m.id, kind: 'response', name: 'hello', ok: true, payload: { companion: { version: 'test-double', paired: false, deviceId: null, deviceName: 'Test double', accountLabel: null, backendOrigin: m.origin, disabled: false, enabledActions: [], volumeAuto: false, catalogue: [], activeCommandId: null, problems: [] } }, error: null });
    else if (m.type === 'execute') { send({ v: 1, id: null, kind: 'event', name: 'command_progress', ok: true, payload: { commandId: m.payload.commandId, state: 'running', index: 0 }, error: null }); send({ v: 1, id: m.id, kind: 'response', name: 'execute', ok: false, payload: null, error: { code: 'unsupported', message: 'Test double: nothing executed.' } }); }
    else send({ v: 1, id: m.id, kind: 'response', name: m.type, ok: false, payload: null, error: { code: 'unsupported', message: 'Test double.' } });
  }
});
`);
writeFileSync(hostWrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(hostScript)} "$@"\n`);
chmodSync(hostWrapper, 0o755);
writeFileSync(join(profile, 'NativeMessagingHosts', 'com.jarvis.companion.json'), JSON.stringify({ name: 'com.jarvis.companion', description: 'test double', path: hostWrapper, type: 'stdio', allowed_origins: [`chrome-extension://${EXPECTED_ID}/`] }));

const html = (body = '') => `<!doctype html><meta charset="utf-8"><title>bridge check</title>${body}`;
const servers = [3000, 3001].map((port) => createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(q.url === '/outer' ? html(`<iframe src="http://127.0.0.1:${port}/inner"></iframe>`) : html()); }).listen(port, '127.0.0.1'));
await Promise.all(servers.map((s) => new Promise((r) => s.once('listening', r))));

const context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
const results = {};
const fail = [];
const check = (name, ok, detail) => { results[name] = ok ? 'pass' : `FAIL ${detail ?? ''}`; if (!ok) fail.push(name); };
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  check('extension ID derived from committed manifest key', id === EXPECTED_ID, id);
  // Runs in the page's main world, exactly as JARVIS's bridge client does.
  const call = (target, type, payload, extra = {}) => target.evaluate(async ({ id, type, payload, extra }) => {
    const rt = globalThis.chrome?.runtime;
    if (!rt?.connect) return { noRuntime: true };
    return await new Promise((resolve) => {
      const port = rt.connect(id); const frames = []; const mid = globalThis.crypto.randomUUID();
      const done = (why) => { try { port.disconnect(); } catch { /* closed */ } resolve({ frames, why }); };
      port.onMessage.addListener((f) => { frames.push(f); if (f.kind === 'response') done('response'); });
      port.onDisconnect.addListener(() => resolve({ frames, why: 'disconnected' }));
      port.postMessage({ v: 1, id: mid, type, payload, ...extra });
      setTimeout(() => done('timeout'), 4000);
    });
  }, { id: EXPECTED_ID, type, payload, extra });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3000/');
  const hello = await call(page, 'hello', {});
  const helloFrame = hello.frames?.find((f) => f.kind === 'response');
  check('allowed origin reaches the native host and gets a validated reply', helloFrame?.ok === true && helloFrame.payload?.companion?.version === 'test-double' && helloFrame.payload?.bridge?.extensionId === EXPECTED_ID, JSON.stringify(hello).slice(0, 300));
  const commandId = randomUUID();
  const exec = await call(page, 'execute', { commandId, ticket: 'A'.repeat(43) });
  check('execute: progress event and response routed back to this page', exec.frames?.some((f) => f.name === 'command_progress') && exec.frames?.some((f) => f.kind === 'response' && f.error?.code === 'unsupported'), JSON.stringify(exec).slice(0, 300));
  const bad = await call(page, 'execute', { commandId, ticket: 'A'.repeat(43), actions: [{ type: 'run_shortcut', alias: 'x' }] });
  check('extra page fields are rejected before the native host', bad.frames?.[0]?.error?.code === 'invalid_message', JSON.stringify(bad).slice(0, 200));
  const spoof = await call(page, 'hello', {}, { origin: 'https://evil.example' });
  check('page-supplied origin field is rejected', spoof.frames?.[0]?.error?.code === 'invalid_message');
  const wrongPort = await context.newPage();
  await wrongPort.goto('http://127.0.0.1:3001/');
  const wp = await call(wrongPort, 'hello', {});
  check('same host, different port is refused by the service worker', wp.why === 'disconnected' && (wp.frames?.length ?? 0) === 0, JSON.stringify(wp));
  const framed = await context.newPage();
  await framed.goto('http://127.0.0.1:3000/outer');
  const inner = framed.frames().find((f) => f.url().endsWith('/inner'));
  const fr = await call(inner, 'hello', {});
  check('an iframe on the allowed origin is refused (top frame only)', fr.why === 'disconnected' && (fr.frames?.length ?? 0) === 0, JSON.stringify(fr));
  const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const argv = lines.find((l) => l.argv)?.argv ?? [];
  check('Chrome passes the caller extension origin to the host as argv[1]', argv[0] === `chrome-extension://${EXPECTED_ID}/`, JSON.stringify(argv));
  const frames = lines.filter((l) => l.frame).map((l) => l.frame);
  check('host received only rebuilt frames with Chrome-observed origin', frames.length === 2 && frames.every((f) => f.origin === 'http://127.0.0.1:3000' && Object.keys(f).sort().join() === 'id,origin,payload,type,v'), JSON.stringify(frames));
  check('rejected pages never reached the host', !frames.some((f) => f.origin !== 'http://127.0.0.1:3000'));
} finally {
  await context.close();
  servers.forEach((s) => s.close());
  rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify({ chrome: execFileSync(chrome, ['--version']).toString().trim(), results }, null, 1));
if (fail.length) process.exit(1);
