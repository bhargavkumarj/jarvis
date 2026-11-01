import {z} from 'zod';
import {accountFor, contentBody, contentFailure, ContentError, databaseResult} from '@/lib/conversation/api';
import {preferencesSchema} from '@/lib/validation';
import {json} from '@/lib/http';
const input = z.discriminatedUnion('action', [
  z.strictObject({action: z.literal('complete'), preferences: preferencesSchema}),
  z.strictObject({action: z.literal('skip')}),
]);
export async function POST(request: Request) {
  try {
    const {client, profile} = await accountFor(request, true);
    if (new URL(request.url).search) throw new ContentError(422, 'Setup does not accept account identifiers.');
    const parsed = input.safeParse(await contentBody(request));
    if (!parsed.success) throw new ContentError(422, 'Check the assistant name, style and IANA timezone. Setup cannot change cloud permissions.');
    // One ordinary owned update: preferences cannot be saved while completion fails.
    const data = databaseResult(await client.from('profiles').update({
      ...(parsed.data.action === 'complete' ? parsed.data.preferences : {}),
      onboarding_completed_at: new Date().toISOString(),
    }).eq('owner_id', profile.owner_id).select('*').single());
    return json({profile: data, redirect: '/assistant'});
  } catch (error) { return contentFailure(error); }
}
