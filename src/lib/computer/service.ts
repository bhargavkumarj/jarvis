import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import type { Json } from '../database.generated';
import { ContentError } from '../conversation/api';
import {
  ACTION_TYPES, canonicalCommand, parseCatalogueEntry, type ActionType, type CatalogueEntry,
} from '../../../packages/computer-control-contracts/src/index.ts';
import { interpret, type InterpretContext } from './interpret';

export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
/** 32 random bytes, base64url: pairing codes, command tickets. Shown once, stored only as SHA-256. */
export const newToken = () => randomBytes(32).toString('base64url');

export type DeviceRow = {
  id: string; owner_id: string; name: string; extension_id: string; origin: string; state: 'active' | 'revoked';
  host_version: string | null; disabled: boolean; enabled_actions: string[]; volume_auto: boolean; catalogue: Json;
  created_at: string; last_seen_at: string | null; catalogue_updated_at: string | null; revoked_at: string | null;
};
export const DEVICE_COLUMNS = 'id,owner_id,name,extension_id,origin,state,host_version,disabled,enabled_actions,volume_auto,catalogue,created_at,last_seen_at,catalogue_updated_at,revoked_at';
export const COMMAND_COLUMNS = 'id,device_id,request_id,source,actions,labels,digest,state,auto_eligible,created_at,proposal_expires_at,authorized_at,ticket_expires_at,claimed_at,finished_at,cancel_requested_at,results,summary';

export function computerResult<T>(result: { data: unknown; error: { code?: string } | null }): T {
  if (result.error) {
    const code = result.error.code;
    if (code === '42501') throw new ContentError(403, 'Computer control is off, this Mac is not paired to your account, or the record is unavailable. Nothing was run.');
    if (code === '23505') throw new ContentError(409, 'Another computer action is already approved or running on this Mac, or this request was already used with different parameters. Wait for it to finish or stop it first.');
    if (code === '40001') throw new ContentError(409, 'This proposal changed or is no longer awaiting approval. Review the current proposal before running anything.');
    if (code === '54000') throw new ContentError(429, 'The computer-control limit was reached. Wait a few minutes before trying again.');
    if (code === '22023' || code === '23514' || code === '22P02') throw new ContentError(422, 'The computer action did not match an approved item on this Mac or its parameters were invalid. Nothing was run.');
    throw new ContentError(503, 'Computer-control storage is unavailable or its migration is not applied. Nothing was run.');
  }
  return result.data as T;
}

/** Safe interpretation context: only entries that still satisfy the strict contract. */
export function deviceContext(device: Pick<DeviceRow, 'catalogue' | 'enabled_actions' | 'volume_auto'>): InterpretContext {
  const catalogue: CatalogueEntry[] = [];
  for (const raw of Array.isArray(device.catalogue) ? device.catalogue : []) {
    try { catalogue.push(parseCatalogueEntry(raw)); } catch { /* Ignore malformed entries; the Mac re-validates anyway. */ }
  }
  const enabledActions = device.enabled_actions.filter((a): a is ActionType => (ACTION_TYPES as readonly string[]).includes(a));
  return { catalogue, enabledActions, volumeAuto: device.volume_auto };
}

export type ProposalInput = { request_id: string; device_id: string; text: string; source: 'text' | 'voice'; temporary: boolean };
export async function proposeComputer(client: SupabaseClient<Database>, owner: string, input: ProposalInput) {
  const settings = computerResult<{ enabled: boolean }>(await client.rpc('computer_settings_v1', {}));
  if (!settings.enabled) return { kind: 'not_command' as const };
  const device = computerResult<DeviceRow | null>(await client.from('computer_devices').select(DEVICE_COLUMNS).eq('owner_id', owner).eq('id', input.device_id).maybeSingle());
  if (!device || device.state !== 'active') throw new ContentError(403, 'This Mac is not paired with your account. Pair it in Settings → Computer.');
  const result = interpret(input.text, deviceContext(device));
  if (result.kind === 'not_command') return result;
  // Temporary chats cannot create persistent computer actions in v1.
  if (input.temporary) return { kind: 'clarification' as const, message: 'Computer actions are not available in temporary chat, because they create a durable action record. Switch to a retained conversation to run it. Nothing was run or saved.' };
  if (result.kind === 'clarification') return result;
  if (device.disabled) return { kind: 'clarification' as const, message: 'Computer control is disabled in the companion on this Mac. Re-enable it there (menu bar → Enable, or Settings → Computer) before running actions.' };
  const commandId = randomUUID();
  const digest = sha256(canonicalCommand(device.id, commandId, result.actions));
  const command = computerResult<Record<string, unknown>>(await client.rpc('computer_propose_v1', {
    p_command: commandId, p_request: input.request_id, p_device: device.id, p_source: input.source,
    p_actions: result.actions as unknown as Json, p_labels: result.labels as unknown as Json, p_digest: digest, p_auto: result.autoEligible,
  }));
  return { kind: 'proposal' as const, command: publicCommand(command) };
}

export async function authorizeComputer(client: SupabaseClient<Database>, commandId: string, digest: string) {
  const ticket = newToken();
  const result = computerResult<{ command_id: string; state: string; ticket_expires_at: string }>(await client.rpc('computer_authorize_v1', { p_command: commandId, p_digest: digest, p_ticket_hash: sha256(ticket) }));
  // The ticket is returned once to this owner's page for the bridge; only its hash is stored.
  return { ...result, ticket };
}

/** Whitelisted command fields for the page. Never includes tickets or hashes. */
export function publicCommand(row: Record<string, unknown>) {
  const keys = COMMAND_COLUMNS.split(',');
  return Object.fromEntries(keys.filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]]));
}
