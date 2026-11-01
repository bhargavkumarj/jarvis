import type { StreamEvent } from "./types";
export function encodeEvent(event: StreamEvent) { return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`); }
export async function readEvents(response: Response, receive: (event: StreamEvent) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response stream unavailable.");
  const decoder = new TextDecoder(); let buffer = "", ended = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 24000) throw new Error("Invalid response stream.");
      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const line = buffer.slice(0, split); buffer = buffer.slice(split + 2);
        if (!line.startsWith("data: ")) throw new Error("Invalid stream event.");
        const event = JSON.parse(line.slice(6)) as StreamEvent;
        receive(event);
        if (event.type === "done" || event.type === "failure") ended = true;
      }
      if (done) break;
    }
    if (!ended) throw new Error("Stream interrupted. This response was not confirmed complete.");
  } finally { await reader.cancel().catch(() => {}); }
}
