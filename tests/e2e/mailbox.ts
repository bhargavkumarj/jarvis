// Local email sink only. Never log email bodies or verification codes.
export async function emailCode(email: string, subject: string, previousId?: string): Promise<{ code: string; id: string }> {
  if (!/^m1-[a-f0-9]{24}-recovery@example\.test$/.test(email)) throw new Error("Refusing mailbox access outside this run's disposable fixture.");
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const mailbox = encodeURIComponent(email.split("@")[0]);
      const list = await fetch(`http://127.0.0.1:54324/api/v1/mailbox/${mailbox}`);
      if (list.ok) {
        const messages = await list.json() as { id: string }[];
        for (const message of [...messages].reverse()) {
          if (message.id === previousId) continue;
          const detail = await fetch(`http://127.0.0.1:54324/api/v1/mailbox/${mailbox}/${encodeURIComponent(message.id)}`).then((r) => r.json());
          if (detail.subject !== subject) continue;
          const code = String(detail.body?.html ?? detail.body?.text ?? "").match(/\b\d{6}\b/)?.[0];
          if (code) return { code, id: message.id };
        }
      } else {
        // Recent local stacks use Mailpit instead of Inbucket.
        const data = await fetch("http://127.0.0.1:54324/api/v1/messages").then((r) => r.json());
        for (const message of data.messages ?? []) {
          if (message.ID === previousId) continue;
          if (message.Subject !== subject || !message.To?.some((to: { Address: string }) => to.Address === email)) continue;
          const detail = await fetch(`http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(message.ID)}`).then((r) => r.json());
          const code = String(detail.HTML ?? detail.Text ?? "").match(/\b\d{6}\b/)?.[0];
          if (code) return { code, id: message.ID };
        }
      }
    } catch { /* Poll a starting local mailbox, without exposing its contents. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("No fresh verification code arrived in the isolated local mailbox.");
}
