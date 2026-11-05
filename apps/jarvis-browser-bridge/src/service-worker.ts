// Manifest V3 service-worker entry. Listeners are registered synchronously at
// start-up (MV3 requirement); the exact allowed origins come from the packaged,
// build-generated bridge-config.json. An open native port keeps this worker alive
// (Chrome 105+), and the bridge releases it when no JARVIS tab or command needs it.
import { createBridge, type BridgeConfig, type ChromeApi } from './bridge.ts';

const api = (globalThis as unknown as { chrome: ChromeApi & { runtime: { getURL(path: string): string } } }).chrome;
const config: Promise<BridgeConfig> = fetch(api.runtime.getURL('bridge-config.json'))
  .then((r) => r.json())
  .then((c: unknown) => {
    const origins = (c as { allowedOrigins?: unknown }).allowedOrigins;
    if (!Array.isArray(origins) || !origins.every((o) => typeof o === 'string' && new URL(o).origin === o)) throw new Error('Invalid bridge configuration');
    return { allowedOrigins: origins as string[] };
  });
const bridge = createBridge(api, config);
setInterval(() => bridge.sweep(), 60_000);
