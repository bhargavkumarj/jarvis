import { z } from 'zod';
import { accountFor, contentBody, contentFailure, ContentError } from '@/lib/conversation/api';
import { json } from '@/lib/http';
import { proposeComputer } from '@/lib/computer/service';
export const dynamic = 'force-dynamic';
// Account identity, confirmation state and device ownership are never accepted
// from the page; the device is re-checked as owned and active in SQL.
const input = z.strictObject({
  request_id: z.uuid(), device_id: z.uuid(), text: z.string().trim().min(1).max(2000),
  source: z.enum(['text', 'voice']), temporary: z.boolean(),
});
export async function POST(request: Request) {
  try {
    const { client, profile } = await accountFor(request, true);
    const v = input.safeParse(await contentBody(request, 8192));
    if (!v.success) throw new ContentError(422, 'Use a short message, a request ID and the paired Mac.');
    return json(await proposeComputer(client, profile.owner_id, v.data));
  } catch (e) { return contentFailure(e); }
}
