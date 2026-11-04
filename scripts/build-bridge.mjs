// Builds the unpacked development extension into apps/jarvis-browser-bridge/dist.
// Usage: pnpm bridge:build [--origin https://jarvis.example]   (repeatable)
// Without --origin it uses apps/jarvis-browser-bridge/bridge.config.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const root = new URL('../', import.meta.url);
const app = new URL('apps/jarvis-browser-bridge/', root);
const args = process.argv.slice(2);
const cli = args.flatMap((a, i) => (a === '--origin' ? [args[i + 1]] : []));
const configured = JSON.parse(readFileSync(new URL('bridge.config.json', app), 'utf8')).allowedOrigins;
const origins = cli.length ? cli : configured;

function checkOrigin(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error(`Invalid origin: ${value}`); }
  if (u.origin !== value) throw new Error(`Use an exact origin with no path: ${value}`);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error(`Only https:// origins, or an explicit loopback http:// development origin, are allowed: ${value}`);
  if (u.hostname.includes('*')) throw new Error('Wildcards are not allowed.');
  return u;
}
if (!Array.isArray(origins) || origins.length < 1 || origins.length > 4) throw new Error('Configure one to four exact origins.');
const parsed = origins.map(checkOrigin);

const dist = new URL('dist/', app);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
execFileSync(new URL('node_modules/.bin/tsc', root).pathname, ['-p', new URL('tsconfig.json', app).pathname], { stdio: 'inherit' });
const manifest = JSON.parse(readFileSync(new URL('manifest.base.json', app), 'utf8'));
// Match patterns ignore ports; the service worker enforces the exact origins below.
manifest.externally_connectable = { matches: [...new Set(parsed.map((u) => `${u.protocol}//${u.hostname}/*`))] };
writeFileSync(new URL('manifest.json', dist), JSON.stringify(manifest, null, 1) + '\n');
writeFileSync(new URL('bridge-config.json', dist), JSON.stringify({ allowedOrigins: origins }, null, 1) + '\n');
const der = Buffer.from(manifest.key, 'base64');
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
console.log(`Built ${dist.pathname}\nExtension ID (from manifest key): ${id}\nAllowed origins: ${origins.join(', ')}`);
