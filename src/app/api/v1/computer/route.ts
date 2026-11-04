import { z } from 'zod';
import { accountFor, contentBody, contentFailure, ContentError } from '@/lib/conversation/api';
import { json } from '@/lib/http';
import { getConfig } from '@/lib/config';
import { COMPUTER_CONSENT, computerExtensionId } from '@/lib/computer/config';
import { COMMAND_COLUMNS, DEVICE_COLUMNS, computerResult } from '@/lib/computer/service';
export const dynamic = 'force-dynamic';

const input = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('settings'), enabled: z.boolean(), consent: z.literal(COMPUTER_CONSENT).nullable() }),
  z.strictObject({ action: z.literal('revoke'), device_id: z.uuid() }),
  z.strictObject({ action: z.literal('clear_history') }),
]);

export async function GET(request: Request) {
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new ContentError(422, 'Computer status accepts no filters.');
    const { client, profile } = await accountFor(request);
    const settings = computerResult<{ enabled: boolean; consent_version: string | null }>(await client.rpc('computer_settings_v1', {}));
    const devices = computerResult<unknown[]>(await client.from('computer_devices').select(DEVICE_COLUMNS).eq('owner_id', profile.owner_id).order('created_at', { ascending: false }).limit(10));
    const commands = computerResult<unknown[]>(await client.from('computer_commands').select(COMMAND_COLUMNS).eq('owner_id', profile.owner_id).order('created_at', { ascending: false }).limit(15));
    return json({ settings, devices, commands, extension_id: computerExtensionId(), origin: getConfig().APP_ORIGIN, consent_version: COMPUTER_CONSENT, retention_days: 30, server_now: new Date().toISOString() });
  } catch (e) { return contentFailure(e); }
}

export async function POST(request: Request) {
  try {
    const { client } = await accountFor(request, true);
    const v = input.safeParse(await contentBody(request, 1024));
    if (!v.success) throw new ContentError(422, 'Use a listed computer-control action. Owner IDs and device credentials are never accepted here.');
    const d = v.data;
    if (d.action === 'settings') {
      if (d.enabled && d.consent !== COMPUTER_CONSENT) throw new ContentError(422, 'Read and accept the computer-control disclosure first.');
      return json({ settings: computerResult(await client.rpc('computer_settings_v1', { p_enabled: d.enabled, p_consent: d.consent })) });
    }
    if (d.action === 'revoke') return json({ device: computerResult(await client.rpc('computer_device_v1', { p_action: 'revoke', p_device: d.device_id })) });
    return json(computerResult(await client.rpc('computer_history_clear_v1', {})));
  } catch (e) { return contentFailure(e); }
}
