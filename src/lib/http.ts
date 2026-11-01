import { NextResponse } from "next/server";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie" } });
}
export function validMutation(request: Request, origin: string, mediaType = "application/json"): boolean {
  return request.headers.get("origin") === origin &&
    !["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "") &&
    request.headers.get("content-type")?.split(";")[0].trim() === mediaType;
}
export async function readBody(request: Request, maxBytes = 4096): Promise<unknown> {
  // Do not trust Content-Length; cap the actual streamed body too.
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid request");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("Request too large"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
