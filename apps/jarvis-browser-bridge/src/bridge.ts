// JARVIS Chrome bridge: a narrow relay between explicitly configured JARVIS page
// origins and the registered native host. It carries one-use tickets and
// allowlisted control messages, never executable instructions, and it holds no
// device secret, account identity, service credential or AI key.
import {
  LIMITS, NATIVE_HOST_NAME, PROTOCOL_VERSION, ContractError, parseHostFrame, parsePageMessage,
  type BridgeErrorCode, type HostFrame, type PageMessage,
} from '../../../packages/computer-control-contracts/src/index.ts';

type Listener<T extends unknown[]> = { addListener(fn: (...args: T) => void): void };
export type Sender = { origin?: string; url?: string; frameId?: number; tab?: { id?: number }; documentLifecycle?: string };
export type Port = {
  name?: string; sender?: Sender; postMessage(message: unknown): void; disconnect(): void;
  onMessage: Listener<[unknown]>; onDisconnect: Listener<[unknown]>;
};
export type ChromeApi = {
  runtime: {
    id: string; lastError?: { message?: string } | undefined;
    connectNative(name: string): Port; onConnectExternal: Listener<[Port]>; getManifest(): { version: string };
  };
};
export type BridgeConfig = { allowedOrigins: string[] };

/** Exact-origin, top-frame, active-document check on the Chrome-observed sender. */
export function senderAllowed(sender: Sender | undefined, allowed: ReadonlySet<string>): boolean {
  if (!sender || typeof sender.origin !== 'string' || !allowed.has(sender.origin)) return false;
  if (sender.frameId !== 0 || !sender.tab) return false; // reject iframes and non-tab contexts
  if (sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active') return false; // prerender/back-forward cache
  try { return typeof sender.url === 'string' && new URL(sender.url).origin === sender.origin; } catch { return false; }
}
export function nativeErrorCode(message: string | undefined): BridgeErrorCode {
  if (!message) return 'host_disconnected';
  if (/not found/i.test(message)) return 'host_not_installed';
  if (/forbidden/i.test(message)) return 'host_forbidden';
  return 'host_disconnected';
}
const ERROR_TEXT: Partial<Record<BridgeErrorCode, string>> = {
  host_not_installed: 'The JARVIS Mac companion is not installed for this Chrome profile. Follow MAC_COMPANION_SETUP.md to register it.',
  host_forbidden: 'The companion is installed but does not allow this extension ID. Re-run the companion install for this extension.',
  host_disconnected: 'The JARVIS Mac companion is not connected. It may have exited or been stopped.',
  invalid_message: 'The bridge rejected a malformed request.',
  rate_limited: 'Too many bridge requests. Wait a moment.',
  origin_rejected: 'This page is not an allowed JARVIS origin.',
};
function frame(id: string | null, name: string, error: BridgeErrorCode | null, payload: Record<string, unknown> | null = null): HostFrame {
  return { v: PROTOCOL_VERSION, id, kind: id ? 'response' : 'event', name, ok: error === null, payload, error: error ? { code: error, message: ERROR_TEXT[error] ?? 'The bridge could not complete this request.' } : null };
}

export function createBridge(chrome: ChromeApi, config: Promise<BridgeConfig> | BridgeConfig, now: () => number = Date.now) {
  const pages = new Map<Port, { stamps: number[] }>();
  const pending = new Map<string, { port: Port; name: string; at: number }>();
  const commandOwners = new Map<string, Port>();
  let native: Port | null = null;
  let lastNativeError: BridgeErrorCode | null = null;
  const allowedPromise = Promise.resolve(config).then((c) => new Set(c.allowedOrigins));

  function safePost(port: Port, message: HostFrame) { try { port.postMessage(message); } catch { pages.delete(port); } }
  function broadcast(message: HostFrame) { for (const port of pages.keys()) safePost(port, message); }
  function maybeReleaseNative() {
    // Keep the companion alive while any command it is executing still has an owner,
    // so closing a tab does not cut a running action's reporting path.
    if (native && pages.size === 0 && commandOwners.size === 0 && pending.size === 0) { const n = native; native = null; try { n.disconnect(); } catch { /* already closed */ } }
  }
  function connectNative(): Port | null {
    if (native) return native;
    let port: Port;
    try { port = chrome.runtime.connectNative(NATIVE_HOST_NAME); } catch { lastNativeError = 'host_not_installed'; return null; }
    native = port;
    port.onMessage.addListener((raw) => {
      let message: HostFrame;
      try { message = parseHostFrame(raw); } catch { return; } // drop malformed companion frames
      lastNativeError = null;
      if (message.kind === 'response' && message.id) {
        const target = pending.get(message.id);
        if (!target) return;
        pending.delete(message.id);
        if (target.name === 'hello' && message.ok) message = { ...message, payload: { ...(message.payload ?? {}), bridge: { version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id, hostConnected: true } } };
        safePost(target.port, message);
      } else {
        const commandId = typeof message.payload?.commandId === 'string' ? message.payload.commandId : null;
        const owner = commandId ? commandOwners.get(commandId) : undefined;
        if (owner && pages.has(owner)) safePost(owner, message); else broadcast(message);
        if (commandId && message.name === 'command_result') commandOwners.delete(commandId);
      }
      maybeReleaseNative();
    });
    port.onDisconnect.addListener(() => {
      const code = nativeErrorCode(chrome.runtime.lastError?.message);
      if (native === port) native = null;
      lastNativeError = code;
      for (const [id, target] of pending) safePost(target.port, frame(id, target.name, code));
      pending.clear();
      // Running commands become unknown in the page until the server reports their final state.
      broadcast(frame(null, 'status', null, { hostConnected: false, reason: code, activeCommands: [...commandOwners.keys()] }));
      commandOwners.clear();
    });
    return port;
  }
  function onPageMessage(port: Port, raw: unknown) {
    const record = pages.get(port);
    if (!record) return;
    const t = now();
    record.stamps = record.stamps.filter((s) => t - s < 10_000);
    record.stamps.push(t);
    let size = Number.POSITIVE_INFINITY;
    try { size = JSON.stringify(raw).length; } catch { /* unserialisable */ }
    let message: PageMessage;
    try {
      if (size > LIMITS.maxPageMessageBytes) throw new ContractError('invalid_message');
      message = parsePageMessage(raw);
    } catch (error) {
      const id = typeof (raw as { id?: unknown })?.id === 'string' && /^[0-9a-f-]{36}$/.test((raw as { id: string }).id) ? (raw as { id: string }).id : null;
      if (id) safePost(port, frame(id, 'hello', error instanceof ContractError && error.code === 'unsupported_version' ? 'unsupported_version' : 'invalid_message'));
      return;
    }
    if (record.stamps.length > 30) { safePost(port, frame(message.id, message.type, 'rate_limited')); return; }
    const host = connectNative();
    if (!host) {
      safePost(port, frame(message.id, message.type, lastNativeError ?? 'host_not_installed', message.type === 'hello' ? { bridge: { version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id, hostConnected: false } } : null));
      return;
    }
    pending.set(message.id, { port, name: message.type, at: t });
    if (message.type === 'execute') commandOwners.set(message.payload.commandId, port);
    // The origin is Chrome's observed sender origin, never a page-supplied value.
    try { host.postMessage({ v: PROTOCOL_VERSION, id: message.id, type: message.type, payload: message.payload, origin: port.sender!.origin }); }
    catch { pending.delete(message.id); safePost(port, frame(message.id, message.type, 'host_disconnected')); }
  }
  chrome.runtime.onConnectExternal.addListener((port) => {
    void allowedPromise.then((allowed) => {
      if (!senderAllowed(port.sender, allowed)) { try { port.disconnect(); } catch { /* ignore */ } return; }
      pages.set(port, { stamps: [] });
      port.onMessage.addListener((raw) => onPageMessage(port, raw));
      port.onDisconnect.addListener(() => {
        pages.delete(port);
        for (const [id, target] of pending) if (target.port === port && target.name !== 'execute') pending.delete(id);
        maybeReleaseNative();
      });
    }, () => { try { port.disconnect(); } catch { /* config unavailable: fail closed */ } });
  });
  // Bounded bookkeeping: stale correlation entries cannot accumulate.
  function sweep() {
    const t = now();
    for (const [id, target] of pending) if (t - target.at > (target.name === 'execute' ? 15 * 60_000 : 5 * 60_000)) { pending.delete(id); safePost(target.port, frame(id, target.name, 'timeout')); }
    maybeReleaseNative();
  }
  return { sweep, state: () => ({ pages: pages.size, pending: pending.size, commands: commandOwners.size, native: native !== null }) };
}
