import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config';
import type { Database } from '../database.types';
import { json } from '../http';
import { isUuid } from '../../../packages/computer-control-contracts/src/index.ts';

// Device endpoints are called by the native companion (URLSession), never by
// pages. They carry no cookies/session; the device credential is checked by the
// database RPC (sha256 compare) and grants access only to that device's records.
export class DeviceError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function deviceClient() {
  const config = getConfig();
  return createClient<Database>(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }) },
  });
}
export function assertDeviceRequest(request: Request) {
  // Browser-originated requests (Origin/Cookie/Fetch metadata) are refused outright.
  if (request.headers.has('origin') || request.headers.has('cookie') || request.headers.has('sec-fetch-site')) throw new DeviceError(403, 'browser_request_refused');
  if (request.headers.get('x-jarvis-device-protocol') !== '1') throw new DeviceError(400, 'unsupported_version');
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new DeviceError(415, 'invalid_message');
}
export function deviceCredential(request: Request) {
  const device = request.headers.get('x-jarvis-device');
  const auth = request.headers.get('authorization') ?? '';
  const secret = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth)?.[1];
  if (!isUuid(device) || !secret) throw new DeviceError(401, 'authorization_failed');
  return { device, secret };
}
export async function deviceBody(request: Request, maxBytes = 32768): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new DeviceError(400, 'invalid_message');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new DeviceError(413, 'invalid_message'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new DeviceError(400, 'invalid_message'); }
}
export function deviceResult<T>(result: { data: unknown; error: { code?: string } | null }): T {
  if (result.error) {
    const code = result.error.code;
    if (code === '42501') throw new DeviceError(401, 'authorization_failed');
    if (code === '22023' || code === '23514' || code === '22P02') throw new DeviceError(422, 'invalid_message');
    if (code === '54000') throw new DeviceError(429, 'rate_limited');
    if (code === '40001' || code === '23505') throw new DeviceError(409, 'duplicate');
    throw new DeviceError(503, 'backend_unavailable');
  }
  return result.data as T;
}
export function deviceFailure(error: unknown) {
  // Fixed codes only: never database messages, credentials, tickets or bodies.
  if (error instanceof DeviceError) return json({ error: error.code }, error.status);
  return json({ error: 'backend_unavailable' }, 503);
}
