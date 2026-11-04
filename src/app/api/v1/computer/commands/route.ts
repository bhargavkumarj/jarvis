import { z } from 'zod';
import { accountFor, contentBody, contentFailure, ContentError } from '@/lib/conversation/api';
import { json } from '@/lib/http';
import { authorizeComputer, COMMAND_COLUMNS, computerResult } from '@/lib/computer/service';
export const dynamic = 'force-dynamic';
const input = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('authorize'), command_id: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ action: z.literal('cancel'), command_id: z.uuid() }),
]);
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), id = url.searchParams.get('id');
    if ([...url.searchParams.keys()].some((k) => k !== 'id') || url.searchParams.getAll('id').length !== 1 || !z.uuid().safeParse(id).success) throw new ContentError(422, 'Use one command identifier.');
    const { client, profile } = await accountFor(request);
    const command = computerResult(await client.from('computer_commands').select(COMMAND_COLUMNS).eq('owner_id', profile.owner_id).eq('id', id!).maybeSingle());
    if (!command) throw new ContentError(404, 'Computer action unavailable.');
    return json({ command, server_now: new Date().toISOString() });
  } catch (e) { return contentFailure(e); }
}
export async function POST(request: Request) {
  try {
    const { client } = await accountFor(request, true);
    const v = input.safeParse(await contentBody(request, 512));
    if (!v.success) throw new ContentError(422, 'Approve a specific reviewed proposal by its ID and digest, or cancel it.');
    if (v.data.action === 'authorize') return json(await authorizeComputer(client, v.data.command_id, v.data.digest));
    return json(computerResult(await client.rpc('computer_cancel_v1', { p_command: v.data.command_id })));
  } catch (e) { return contentFailure(e); }
}
