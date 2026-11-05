// Page-side connection to the JARVIS Chrome bridge (externally_connectable).
// The page sends only allowlisted bridge messages; tickets are opaque and one-use.
import { parseHostFrame, PROTOCOL_VERSION, type HostFrame, type PageMessageType, type CatalogueEntry } from './contracts';

type RuntimePort = {
  postMessage(message: unknown): void; disconnect(): void;
  onMessage: { addListener(fn: (m: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
};
type PageRuntime = { connect?: (extensionId: string) => RuntimePort; lastError?: { message?: string } };

export type CompanionInfo = {
  version: string; paired: boolean; deviceId: string | null; deviceName: string | null; accountLabel: string | null;
  backendOrigin: string | null; disabled: boolean; enabledActions: string[]; volumeAuto: boolean; catalogue: CatalogueEntry[];
  activeCommandId: string | null; problems: { code: string; message: string }[];
};
export type BridgeState =
  | { extension: 'checking' }
  | { extension: 'missing' }
  | { extension: 'installed'; host: 'connected'; companion: CompanionInfo; extensionId: string }
  | { extension: 'installed'; host: 'disconnected'; reason: string; message: string; extensionId: string };

export function runtime(): PageRuntime | null {
  const r = (globalThis as unknown as { chrome?: { runtime?: PageRuntime } }).chrome?.runtime;
  return r && typeof r.connect === 'function' ? r : null;
}

export class ComputerBridge {
  private port: RuntimePort | null = null;
  private pending = new Map<string, { resolve: (f: HostFrame) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(f: HostFrame) => void>();
  private disconnected = new Set<() => void>();
  constructor(private extensionId: string) {}

  private ensure(): RuntimePort | null {
    if (this.port) return this.port;
    const r = runtime();
    if (!r?.connect) return null;
    let port: RuntimePort;
    try { port = r.connect(this.extensionId); } catch { return null; }
    this.port = port;
    port.onMessage.addListener((raw) => {
      let frame: HostFrame;
      try { frame = parseHostFrame(raw); } catch { return; }
      if (frame.kind === 'response' && frame.id && this.pending.has(frame.id)) {
        const p = this.pending.get(frame.id)!; this.pending.delete(frame.id); clearTimeout(p.timer); p.resolve(frame);
      } else if (frame.kind === 'event') this.listeners.forEach((l) => l(frame));
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
      for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve(local(id, 'host_disconnected', 'The bridge connection closed.')); }
      this.pending.clear();
      this.disconnected.forEach((l) => l());
    });
    return port;
  }
  request(type: PageMessageType, payload: Record<string, unknown>, timeoutMs = 30_000): Promise<HostFrame> {
    const id = crypto.randomUUID();
    const port = this.ensure();
    if (!port) return Promise.resolve(local(id, 'host_not_installed', 'The JARVIS bridge extension is not reachable from this page.', true));
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(local(id, 'timeout', 'No reply from the Mac companion in time. The outcome may be unknown; check history.')); }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      try { port.postMessage({ v: PROTOCOL_VERSION, id, type, payload }); }
      catch { clearTimeout(timer); this.pending.delete(id); resolve(local(id, 'host_disconnected', 'The bridge connection closed.')); }
    });
  }
  onEvent(fn: (f: HostFrame) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onDisconnect(fn: () => void) { this.disconnected.add(fn); return () => this.disconnected.delete(fn); }
  close() { try { this.port?.disconnect(); } catch { /* already closed */ } this.port = null; }

  /** Distinguishes extension missing, companion disconnected and companion connected. */
  async status(): Promise<BridgeState> {
    if (!runtime()) return { extension: 'missing' };
    const frame = await this.request('hello', {}, 6000);
    const bridge = frame.payload?.bridge as { extensionId?: string } | undefined;
    if (frame.ok && frame.payload?.companion) return { extension: 'installed', host: 'connected', companion: frame.payload.companion as CompanionInfo, extensionId: bridge?.extensionId ?? this.extensionId };
    // A locally generated reply because the page port closed means no extension answered.
    // Anything the extension itself answered (or a timeout from a hanging companion) means it is installed.
    if (frame.payload?.local === true && frame.error?.code !== 'timeout') return { extension: 'missing' };
    return { extension: 'installed', host: 'disconnected', reason: frame.error?.code ?? 'host_disconnected', message: frame.error?.message ?? '', extensionId: this.extensionId };
  }
}
function local(id: string, code: 'host_not_installed' | 'host_disconnected' | 'timeout', message: string, noExtension = false): HostFrame {
  return { v: 1, id, kind: 'response', name: 'hello', ok: false, payload: noExtension ? null : { local: true }, error: { code, message } };
}

export const RECOVERY: Record<string, string> = {
  host_not_installed: 'Install the companion for this Chrome profile: in apps/jarvis-mac-companion run ./scripts/install-dev.sh, then reload this page.',
  host_forbidden: 'The companion manifest does not allow this extension ID. Re-run install-dev.sh with the extension ID shown here.',
  host_disconnected: 'The companion is installed but not running for this page. Reload; if it persists, check the companion with “jarvis-companion status”.',
  origin_rejected: 'The companion trusts a different JARVIS address. Re-run “jarvis-companion configure --origin …” with this page’s origin.',
  not_paired: 'Pair this Mac below.',
  timeout: 'The companion did not answer. Reload the page, then check the menu-bar item.',
};
