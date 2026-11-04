// Native-companion endpoints. Never cookie-authenticated; see src/lib/computer/device-api.ts.
import { json } from '@/lib/http';
import { getConfig } from '@/lib/config';
import { assertDeviceRequest, deviceBody, deviceClient, deviceCredential, DeviceError, deviceFailure, deviceResult } from '@/lib/computer/device-api';
import {
  isDigest, isExtensionId, isPlainText, isToken, isUuid, parseCommandEnvelope, parseCommandResult, parseDeviceSync, ContractError,
} from '@/lib/computer/contracts';
import type { Json } from '@/lib/database.generated';
export const dynamic = 'force-dynamic';

function strict(body: unknown, keys: string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new DeviceError(422, 'invalid_message');
  const o = body as Record<string, unknown>;
  if (Object.keys(o).length !== keys.length || !keys.every((k) => Object.hasOwn(o, k))) throw new DeviceError(422, 'invalid_message');
  return o;
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    assertDeviceRequest(request);
    const { action } = await params;
    const client = deviceClient();
    if (action === 'pairing-inspect' || action === 'pairing-complete') {
      const body = strict(await deviceBody(request, 4096), action === 'pairing-inspect' ? ['pairingId', 'code', 'extensionId'] : ['pairingId', 'code', 'extensionId', 'deviceName', 'credentialHash']);
      if (!isUuid(body.pairingId) || !isToken(body.code) || !isExtensionId(body.extensionId)) throw new DeviceError(422, 'invalid_message');
      if (action === 'pairing-inspect') {
        const r = deviceResult<{ account_label: string; origin: string; expires_at: string }>(await client.rpc('computer_pairing_inspect_v1', { p_pairing: body.pairingId, p_code: body.code, p_extension: body.extensionId }));
        // The companion compares this with its own configured backend origin before showing approval.
        if (r.origin !== getConfig().APP_ORIGIN) throw new DeviceError(401, 'authorization_failed');
        return json({ accountLabel: r.account_label, origin: r.origin, expiresAt: r.expires_at });
      }
      if (!isPlainText(body.deviceName, 60) || !isDigest(body.credentialHash)) throw new DeviceError(422, 'invalid_message');
      const r = deviceResult<{ device_id: string; account_label: string; origin: string }>(await client.rpc('computer_pairing_complete_v1', { p_pairing: body.pairingId, p_code: body.code, p_extension: body.extensionId, p_name: body.deviceName, p_credential_hash: body.credentialHash }));
      return json({ deviceId: r.device_id, accountLabel: r.account_label, origin: r.origin });
    }
    const { device, secret } = deviceCredential(request);
    if (action === 'sync') {
      const sync = parseDeviceSync(await deviceBody(request, 65536));
      const r = deviceResult<{ control_enabled: boolean; account_label: string }>(await client.rpc('computer_device_sync_v1', { p_device: device, p_secret: secret, p_sync: sync as unknown as Json }));
      return json({ state: 'active', controlEnabled: r.control_enabled, accountLabel: r.account_label });
    }
    if (action === 'redeem') {
      const body = strict(await deviceBody(request, 2048), ['commandId', 'ticket']);
      if (!isUuid(body.commandId) || !isToken(body.ticket)) throw new DeviceError(422, 'invalid_message');
      const r = deviceResult<{ status: string; state?: string; command?: unknown; account_label?: string; origin?: string }>(await client.rpc('computer_redeem_v1', { p_device: device, p_secret: secret, p_command: body.commandId, p_ticket: body.ticket }));
      if (r.status !== 'claimed') return json({ status: r.status, state: r.state ?? null });
      // Re-validate the canonical envelope before the companion acts on it.
      const command = parseCommandEnvelope(r.command);
      if (command.deviceId !== device || command.commandId !== body.commandId) throw new DeviceError(503, 'backend_unavailable');
      return json({ status: 'claimed', command, accountLabel: r.account_label, origin: r.origin });
    }
    if (action === 'progress') {
      const body = strict(await deviceBody(request, 1024), ['commandId', 'state', 'index']);
      if (!isUuid(body.commandId) || (body.state !== 'running' && body.state !== 'awaiting_confirmation') || typeof body.index !== 'number' || !Number.isInteger(body.index) || body.index < 0 || body.index > 4) throw new DeviceError(422, 'invalid_message');
      const r = deviceResult<{ continue: boolean; reason: string | null }>(await client.rpc('computer_progress_v1', { p_device: device, p_secret: secret, p_command: body.commandId, p_state: body.state, p_index: body.index }));
      return json({ continue: r.continue === true, reason: r.reason ?? null });
    }
    if (action === 'finish') {
      const result = parseCommandResult(await deviceBody(request, 32768));
      const r = deviceResult<{ state: string }>(await client.rpc('computer_finish_v1', { p_device: device, p_secret: secret, p_command: result.commandId, p_result: result as unknown as Json }));
      return json({ state: r.state });
    }
    if (action === 'unpair') {
      strict(await deviceBody(request, 64), []);
      deviceResult(await client.rpc('computer_device_unpair_v1', { p_device: device, p_secret: secret }));
      return json({ state: 'revoked' });
    }
    throw new DeviceError(404, 'not_found');
  } catch (error) {
    if (error instanceof ContractError) return json({ error: error.code === 'unsupported_version' ? 'unsupported_version' : 'invalid_message' }, 422);
    return deviceFailure(error);
  }
}
