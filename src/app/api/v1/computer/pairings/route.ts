import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accountFor, contentBody, contentFailure, ContentError } from '@/lib/conversation/api';
import { json } from '@/lib/http';
import { getConfig } from '@/lib/config';
import { computerExtensionId } from '@/lib/computer/config';
import { computerResult, newToken, sha256 } from '@/lib/computer/service';
export const dynamic = 'force-dynamic';
const input = z.strictObject({ extension_id: z.string().regex(/^[a-p]{32}$/) });

// Starts a short-lived, one-use pairing challenge bound to this verified account,
// its current session, this exact server origin and the configured extension.
// Approval itself happens only in the native dialog on the Mac.
export async function POST(request: Request) {
  try {
    const { client } = await accountFor(request, true);
    const v = input.safeParse(await contentBody(request, 256));
    if (!v.success) throw new ContentError(422, 'Pairing accepts only the bridge extension ID.');
    if (v.data.extension_id !== computerExtensionId()) throw new ContentError(422, 'This extension is not the configured JARVIS bridge. Load the bridge built from this repository.');
    const pairing_id = randomUUID(), code = newToken(), origin = getConfig().APP_ORIGIN;
    const r = computerResult<{ pairing_id: string; expires_at: string }>(await client.rpc('computer_pairing_begin_v1', { p_id: pairing_id, p_code_hash: sha256(code), p_extension: v.data.extension_id, p_origin: origin }));
    return json({ pairing_id: r.pairing_id, code, expires_at: r.expires_at, origin });
  } catch (e) { return contentFailure(e); }
}
