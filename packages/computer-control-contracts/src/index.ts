// JARVIS computer-control protocol v1. Dependency-free so the web server, the
// Chrome bridge and tests share one definition; the Swift companion mirrors it
// (apps/jarvis-mac-companion/Sources/JarvisCompanionCore/Contracts.swift) and
// both are checked against ../fixtures/contract-cases.json.
//
// Every parser is strict: unknown fields, unknown actions, wrong types,
// out-of-range values and incompatible versions are rejected, never coerced.

export const PROTOCOL_VERSION = 1 as const;
export const NATIVE_HOST_NAME = 'com.jarvis.companion';
export const DIGEST_DOMAIN = 'jarvis-computer-control/v1';

export const ACTION_TYPES = ['open_application', 'open_website', 'set_volume', 'open_folder', 'run_shortcut'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const RESOURCE_KINDS = ['application', 'website', 'folder', 'shortcut'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const KIND_FOR_ACTION: Record<Exclude<ActionType, 'set_volume'>, ResourceKind> = {
  open_application: 'application', open_website: 'website', open_folder: 'folder', run_shortcut: 'shortcut',
};
export const ACTION_FOR_KIND: Record<ResourceKind, Exclude<ActionType, 'set_volume'>> = {
  application: 'open_application', website: 'open_website', folder: 'open_folder', shortcut: 'run_shortcut',
};

export const LIMITS = {
  maxFrameBytes: 65536, // native-messaging frames accepted by the companion (Chrome allows more; we do not)
  maxPageMessageBytes: 16384, // page → extension messages
  maxPlanActions: 5,
  ticketTtlSeconds: 60,
  proposalTtlSeconds: 300,
  pairingTtlSeconds: 300,
  maxCatalogueEntries: 100,
  maxNames: 5,
  maxLabel: 60,
  maxName: 40,
  maxMessage: 200,
  maxSummary: 300,
  maxWebsiteUrl: 2048,
  shortcutTimeoutSeconds: 120,
  shortcutOutputBytes: 4096,
} as const;

export const EXECUTION_STATES = ['proposed', 'awaiting_confirmation', 'authorized', 'running', 'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown'] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];
export const FINAL_STATES: readonly ExecutionState[] = ['succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown'];
export const ACTION_RESULT_STATES = ['succeeded', 'failed', 'cancelled', 'skipped', 'rejected', 'outcome_unknown'] as const;
export type ActionResultState = (typeof ACTION_RESULT_STATES)[number];
// observed: the companion read back the effect (running app, volume level, Finder window request accepted)
// dispatched: the OS accepted the request; the effect itself was not observed (e.g. a page load)
// process_exit: a fixed helper process finished with the reported status; real-world steps unverified
// none: nothing ran
export const EVIDENCE_LEVELS = ['observed', 'dispatched', 'process_exit', 'none'] as const;
export type Evidence = (typeof EVIDENCE_LEVELS)[number];
export const RESULT_CODES = [
  'app_launched', 'app_running_observed', 'url_dispatched', 'volume_set', 'folder_opened', 'shortcut_completed',
  'shortcut_failed', 'shortcut_timeout', 'cancelled_by_user', 'cancelled_during_run', 'confirmation_declined', 'confirmation_timeout',
  'not_approved', 'action_disabled', 'locally_disabled', 'target_missing', 'target_changed', 'bookmark_stale', 'volume_unsupported',
  'invalid_parameters', 'os_error', 'authorization_unavailable', 'authorization_revoked', 'expired', 'interrupted', 'skipped_after_failure',
] as const;
export type ResultCode = (typeof RESULT_CODES)[number];

export type Action =
  | { type: 'open_application'; alias: string }
  | { type: 'open_website'; alias: string }
  | { type: 'set_volume'; percent: number }
  | { type: 'open_folder'; alias: string }
  | { type: 'run_shortcut'; alias: string };

export type CommandEnvelope = {
  protocolVersion: 1; commandId: string; requestId: string; deviceId: string;
  actions: Action[]; issuedAt: string; expiresAt: string; digest: string;
};
export type ActionResult = {
  index: number; type: ActionType; state: ActionResultState; evidence: Evidence; code: ResultCode;
  message: string; observedPercent: number | null; previousPercent: number | null; startedAt: string | null; finishedAt: string | null;
};
export type CommandResult = {
  protocolVersion: 1; commandId: string; state: ExecutionState; results: ActionResult[];
  startedAt: string | null; finishedAt: string; summary: string;
};
export type CatalogueEntry = {
  kind: ResourceKind; alias: string; label: string; names: string[]; detail: string | null; auto: boolean;
};
export type DeviceSync = {
  protocolVersion: 1; hostVersion: string; disabled: boolean; enabledActions: ActionType[];
  volumeAuto: boolean; catalogue: CatalogueEntry[];
};

export class ContractError extends Error {
  code: string;
  // Explicit field (no parameter property) so Node's built-in type stripping can load this file.
  constructor(code: string, message = code) { super(message); this.code = code; this.name = 'ContractError'; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9 ]{0,38}[a-z0-9])?$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url without padding
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
// Exact HTTPS website rule shared with Swift. Visible ASCII only, no userinfo,
// no whitespace/quotes/angle brackets/backslash; the host is a plain DNS name.
const WEBSITE_PATTERN = /^https:\/\/((?=.{1,253}(?::|\/|$))[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::([0-9]{1,5}))?(\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/?#]*)?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
// eslint-disable-next-line no-control-regex -- Deliberately rejects control characters in user-visible text.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isToken = (v: unknown): v is string => typeof v === 'string' && TOKEN_PATTERN.test(v);
export const isDigest = (v: unknown): v is string => typeof v === 'string' && DIGEST_PATTERN.test(v);
export const isExtensionId = (v: unknown): v is string => typeof v === 'string' && EXTENSION_ID_PATTERN.test(v);
export const isAlias = (v: unknown): v is string => typeof v === 'string' && ALIAS_PATTERN.test(v);
export const isHostname = (v: unknown): v is string => typeof v === 'string' && HOSTNAME_PATTERN.test(v);
export function isInstant(v: unknown): v is string {
  return typeof v === 'string' && ISO_INSTANT.test(v) && Number.isFinite(Date.parse(v));
}
export function isPlainText(v: unknown, max: number, min = 1): v is string {
  return typeof v === 'string' && v.length >= min && v.length <= max && v === v.trim() && !CONTROL.test(v);
}
/** Returns the website's hostname when the URL satisfies the exact v1 rule, else null. */
export function websiteHost(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > LIMITS.maxWebsiteUrl) return null;
  const m = WEBSITE_PATTERN.exec(url);
  if (!m) return null;
  if (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return null;
  return m[1];
}

function record(v: unknown, code: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ContractError(code);
  return v as Record<string, unknown>;
}
function exactKeys(o: Record<string, unknown>, keys: readonly string[], code: string) {
  const actual = Object.keys(o);
  if (actual.length !== keys.length || !keys.every((k) => Object.hasOwn(o, k))) throw new ContractError(code);
}
function integer(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}
function version(o: Record<string, unknown>) {
  if (o.protocolVersion !== PROTOCOL_VERSION) throw new ContractError('unsupported_version');
}

export function parseAction(v: unknown): Action {
  const o = record(v, 'invalid_action');
  if (typeof o.type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(o.type)) throw new ContractError('unknown_action');
  if (o.type === 'set_volume') {
    exactKeys(o, ['type', 'percent'], 'invalid_action');
    if (!integer(o.percent, 0, 100)) throw new ContractError('invalid_volume');
    return { type: 'set_volume', percent: o.percent };
  }
  exactKeys(o, ['type', 'alias'], 'invalid_action');
  if (!isAlias(o.alias)) throw new ContractError('invalid_alias');
  return { type: o.type as Exclude<ActionType, 'set_volume'>, alias: o.alias };
}
export function parseActions(v: unknown): Action[] {
  if (!Array.isArray(v) || v.length < 1) throw new ContractError('invalid_plan');
  if (v.length > LIMITS.maxPlanActions) throw new ContractError('plan_too_long');
  return v.map(parseAction);
}
export function actionTarget(a: Action): string {
  return a.type === 'set_volume' ? String(a.percent) : a.alias;
}
/** Exact byte string hashed (SHA-256, lowercase hex) by server, SQL and Swift. ASCII only by construction. */
export function canonicalCommand(deviceId: string, commandId: string, actions: Action[]): string {
  if (!isUuid(deviceId) || !isUuid(commandId)) throw new ContractError('invalid_identifier');
  const steps = parseActions(actions).map((a, i) => `${i}:${a.type}:${actionTarget(a)}`);
  return [DIGEST_DOMAIN, `device:${deviceId}`, `command:${commandId}`, ...steps].join('\n');
}

export function parseCommandEnvelope(v: unknown): CommandEnvelope {
  const o = record(v, 'invalid_command');
  version(o);
  exactKeys(o, ['protocolVersion', 'commandId', 'requestId', 'deviceId', 'actions', 'issuedAt', 'expiresAt', 'digest'], 'invalid_command');
  if (!isUuid(o.commandId) || !isUuid(o.requestId) || !isUuid(o.deviceId)) throw new ContractError('invalid_identifier');
  if (!isInstant(o.issuedAt) || !isInstant(o.expiresAt) || Date.parse(o.expiresAt) <= Date.parse(o.issuedAt)) throw new ContractError('invalid_time');
  if (!isDigest(o.digest)) throw new ContractError('invalid_digest');
  return { protocolVersion: 1, commandId: o.commandId, requestId: o.requestId, deviceId: o.deviceId, actions: parseActions(o.actions), issuedAt: o.issuedAt, expiresAt: o.expiresAt, digest: o.digest };
}

function nullableInstant(v: unknown) { return v === null || isInstant(v); }
function nullablePercent(v: unknown) { return v === null || integer(v, 0, 100); }
export function parseActionResult(v: unknown, index: number): ActionResult {
  const o = record(v, 'invalid_result');
  exactKeys(o, ['index', 'type', 'state', 'evidence', 'code', 'message', 'observedPercent', 'previousPercent', 'startedAt', 'finishedAt'], 'invalid_result');
  if (o.index !== index) throw new ContractError('invalid_result');
  if (typeof o.type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(o.type)) throw new ContractError('unknown_action');
  if (typeof o.state !== 'string' || !(ACTION_RESULT_STATES as readonly string[]).includes(o.state)) throw new ContractError('invalid_state');
  if (typeof o.evidence !== 'string' || !(EVIDENCE_LEVELS as readonly string[]).includes(o.evidence)) throw new ContractError('invalid_evidence');
  if (typeof o.code !== 'string' || !(RESULT_CODES as readonly string[]).includes(o.code)) throw new ContractError('invalid_code');
  if (!isPlainText(o.message, LIMITS.maxMessage)) throw new ContractError('invalid_message');
  if (!nullablePercent(o.observedPercent) || !nullablePercent(o.previousPercent)) throw new ContractError('invalid_volume');
  if (!nullableInstant(o.startedAt) || !nullableInstant(o.finishedAt)) throw new ContractError('invalid_time');
  // A success claim must carry evidence; nothing-ran states carry none.
  if (o.state === 'succeeded' && o.evidence === 'none') throw new ContractError('invalid_evidence');
  if (['skipped', 'rejected'].includes(o.state) && o.evidence !== 'none') throw new ContractError('invalid_evidence');
  return o as unknown as ActionResult;
}
export function parseCommandResult(v: unknown): CommandResult {
  const o = record(v, 'invalid_result');
  version(o);
  exactKeys(o, ['protocolVersion', 'commandId', 'state', 'results', 'startedAt', 'finishedAt', 'summary'], 'invalid_result');
  if (!isUuid(o.commandId)) throw new ContractError('invalid_identifier');
  if (typeof o.state !== 'string' || !(FINAL_STATES as readonly string[]).includes(o.state)) throw new ContractError('invalid_state');
  if (!Array.isArray(o.results) || o.results.length > LIMITS.maxPlanActions) throw new ContractError('invalid_result');
  const results = o.results.map((r, i) => parseActionResult(r, i));
  if (!nullableInstant(o.startedAt) || !isInstant(o.finishedAt)) throw new ContractError('invalid_time');
  if (!isPlainText(o.summary, LIMITS.maxSummary)) throw new ContractError('invalid_message');
  if (o.state === 'succeeded' && (results.length === 0 || results.some((r) => r.state !== 'succeeded'))) throw new ContractError('invalid_state');
  return { protocolVersion: 1, commandId: o.commandId, state: o.state as ExecutionState, results, startedAt: o.startedAt as string | null, finishedAt: o.finishedAt as string, summary: o.summary };
}

export function parseCatalogueEntry(v: unknown): CatalogueEntry {
  const o = record(v, 'invalid_catalogue');
  exactKeys(o, ['kind', 'alias', 'label', 'names', 'detail', 'auto'], 'invalid_catalogue');
  if (typeof o.kind !== 'string' || !(RESOURCE_KINDS as readonly string[]).includes(o.kind)) throw new ContractError('invalid_catalogue');
  if (!isAlias(o.alias)) throw new ContractError('invalid_alias');
  if (!isPlainText(o.label, LIMITS.maxLabel)) throw new ContractError('invalid_label');
  if (!Array.isArray(o.names) || o.names.length > LIMITS.maxNames || !o.names.every((n) => typeof n === 'string' && NAME_PATTERN.test(n))) throw new ContractError('invalid_names');
  if (new Set(o.names).size !== o.names.length) throw new ContractError('invalid_names');
  // Only website hostnames leave the Mac; app bundle paths, folder references and Shortcut identifiers stay local.
  if (o.kind === 'website' ? !isHostname(o.detail) : o.detail !== null) throw new ContractError('invalid_detail');
  if (typeof o.auto !== 'boolean' || (o.kind === 'shortcut' && o.auto)) throw new ContractError('invalid_auto');
  return { kind: o.kind as ResourceKind, alias: o.alias, label: o.label, names: o.names as string[], detail: o.detail as string | null, auto: o.auto };
}
export function parseDeviceSync(v: unknown): DeviceSync {
  const o = record(v, 'invalid_sync');
  version(o);
  exactKeys(o, ['protocolVersion', 'hostVersion', 'disabled', 'enabledActions', 'volumeAuto', 'catalogue'], 'invalid_sync');
  if (!isPlainText(o.hostVersion, 32) || typeof o.disabled !== 'boolean' || typeof o.volumeAuto !== 'boolean') throw new ContractError('invalid_sync');
  if (!Array.isArray(o.enabledActions) || o.enabledActions.length > ACTION_TYPES.length || !o.enabledActions.every((a) => (ACTION_TYPES as readonly string[]).includes(a as string)) || new Set(o.enabledActions).size !== o.enabledActions.length) throw new ContractError('invalid_sync');
  if (!Array.isArray(o.catalogue) || o.catalogue.length > LIMITS.maxCatalogueEntries) throw new ContractError('invalid_catalogue');
  const catalogue = o.catalogue.map(parseCatalogueEntry);
  const keys = new Set(catalogue.map((e) => `${e.kind}:${e.alias}`));
  if (keys.size !== catalogue.length) throw new ContractError('duplicate_alias');
  return { protocolVersion: 1, hostVersion: o.hostVersion, disabled: o.disabled, enabledActions: o.enabledActions as ActionType[], volumeAuto: o.volumeAuto, catalogue };
}

// ---- Page ⇄ extension ⇄ native host bridge messages ----
export const PAGE_MESSAGE_TYPES = ['hello', 'pair', 'execute', 'cancel', 'disable', 'enable', 'manage_add', 'manage_remove', 'manage_auto', 'unpair'] as const;
export type PageMessageType = (typeof PAGE_MESSAGE_TYPES)[number];
export type PagePayload =
  | { type: 'hello' | 'disable' | 'enable' | 'unpair'; payload: Record<string, never> }
  | { type: 'pair'; payload: { pairingId: string; code: string } }
  | { type: 'execute'; payload: { commandId: string; ticket: string } }
  | { type: 'cancel'; payload: { commandId: string } }
  | { type: 'manage_add'; payload: { kind: ResourceKind } }
  | { type: 'manage_remove'; payload: { kind: ResourceKind; alias: string } }
  | { type: 'manage_auto'; payload: { kind: ResourceKind | 'volume'; alias: string | null; enabled: boolean } };
export type PageMessage = { v: 1; id: string } & PagePayload;

/** Rebuilds (never forwards) a page message containing only allowlisted fields. */
export function parsePageMessage(v: unknown): PageMessage {
  const o = record(v, 'invalid_message');
  exactKeys(o, ['v', 'id', 'type', 'payload'], 'invalid_message');
  if (o.v !== PROTOCOL_VERSION) throw new ContractError('unsupported_version');
  if (!isUuid(o.id)) throw new ContractError('invalid_message');
  if (typeof o.type !== 'string' || !(PAGE_MESSAGE_TYPES as readonly string[]).includes(o.type)) throw new ContractError('unknown_message');
  const p = record(o.payload, 'invalid_message');
  const base = { v: 1 as const, id: o.id };
  switch (o.type as PageMessageType) {
    case 'hello': case 'disable': case 'enable': case 'unpair':
      exactKeys(p, [], 'invalid_message');
      return { ...base, type: o.type as 'hello', payload: {} };
    case 'pair':
      exactKeys(p, ['pairingId', 'code'], 'invalid_message');
      if (!isUuid(p.pairingId) || !isToken(p.code)) throw new ContractError('invalid_message');
      return { ...base, type: 'pair', payload: { pairingId: p.pairingId, code: p.code } };
    case 'execute':
      exactKeys(p, ['commandId', 'ticket'], 'invalid_message');
      if (!isUuid(p.commandId) || !isToken(p.ticket)) throw new ContractError('invalid_message');
      return { ...base, type: 'execute', payload: { commandId: p.commandId, ticket: p.ticket } };
    case 'cancel':
      exactKeys(p, ['commandId'], 'invalid_message');
      if (!isUuid(p.commandId)) throw new ContractError('invalid_message');
      return { ...base, type: 'cancel', payload: { commandId: p.commandId } };
    case 'manage_add':
      exactKeys(p, ['kind'], 'invalid_message');
      if (typeof p.kind !== 'string' || !(RESOURCE_KINDS as readonly string[]).includes(p.kind)) throw new ContractError('invalid_message');
      return { ...base, type: 'manage_add', payload: { kind: p.kind as ResourceKind } };
    case 'manage_remove':
      exactKeys(p, ['kind', 'alias'], 'invalid_message');
      if (typeof p.kind !== 'string' || !(RESOURCE_KINDS as readonly string[]).includes(p.kind) || !isAlias(p.alias)) throw new ContractError('invalid_message');
      return { ...base, type: 'manage_remove', payload: { kind: p.kind as ResourceKind, alias: p.alias } };
    case 'manage_auto': {
      exactKeys(p, ['kind', 'alias', 'enabled'], 'invalid_message');
      const volume = p.kind === 'volume';
      if (typeof p.enabled !== 'boolean') throw new ContractError('invalid_message');
      if (volume ? p.alias !== null : (typeof p.kind !== 'string' || !(RESOURCE_KINDS as readonly string[]).includes(p.kind) || !isAlias(p.alias))) throw new ContractError('invalid_message');
      if (p.kind === 'shortcut' && p.enabled) throw new ContractError('shortcut_always_confirmed');
      return { ...base, type: 'manage_auto', payload: { kind: p.kind as ResourceKind | 'volume', alias: (p.alias ?? null) as string | null, enabled: p.enabled } };
    }
  }
}

export const BRIDGE_ERROR_CODES = [
  'invalid_message', 'unsupported_version', 'origin_rejected', 'rate_limited', 'host_not_installed', 'host_forbidden', 'host_disconnected',
  'not_paired', 'already_paired', 'busy', 'disabled', 'duplicate', 'declined', 'timeout', 'backend_unavailable', 'authorization_failed',
  'expired', 'revoked', 'not_found', 'policy_rejected', 'unsupported', 'internal',
] as const;
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];
export type HostFrame = {
  v: 1; id: string | null; kind: 'response' | 'event'; name: string; ok: boolean;
  payload: Record<string, unknown> | null; error: { code: BridgeErrorCode; message: string } | null;
};
const EVENT_NAMES = ['status', 'command_progress', 'command_result'] as const;
/** Validates a frame emitted by the companion before the extension/page acts on it. */
export function parseHostFrame(v: unknown): HostFrame {
  const o = record(v, 'invalid_frame');
  exactKeys(o, ['v', 'id', 'kind', 'name', 'ok', 'payload', 'error'], 'invalid_frame');
  if (o.v !== PROTOCOL_VERSION) throw new ContractError('unsupported_version');
  if (o.kind !== 'response' && o.kind !== 'event') throw new ContractError('invalid_frame');
  if (o.kind === 'response' ? !isUuid(o.id) : o.id !== null) throw new ContractError('invalid_frame');
  if (typeof o.name !== 'string' || !(o.kind === 'response' ? (PAGE_MESSAGE_TYPES as readonly string[]) : (EVENT_NAMES as readonly string[])).includes(o.name)) throw new ContractError('invalid_frame');
  if (typeof o.ok !== 'boolean') throw new ContractError('invalid_frame');
  if (o.payload !== null) record(o.payload, 'invalid_frame');
  if (o.ok ? o.error !== null : o.error === null) throw new ContractError('invalid_frame');
  if (o.error !== null) {
    const e = record(o.error, 'invalid_frame');
    exactKeys(e, ['code', 'message'], 'invalid_frame');
    if (typeof e.code !== 'string' || !(BRIDGE_ERROR_CODES as readonly string[]).includes(e.code) || !isPlainText(e.message, LIMITS.maxMessage)) throw new ContractError('invalid_frame');
  }
  return o as unknown as HostFrame;
}

export const ACTION_LABELS: Record<ActionType, string> = {
  open_application: 'Open application', open_website: 'Open website', set_volume: 'Set output volume', open_folder: 'Open folder in Finder', run_shortcut: 'Run Shortcut',
};
