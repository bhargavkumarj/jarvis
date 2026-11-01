// Test-only TLS listener for the existing production build. No auth changes.
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import next from "next";

if (!process.send || process.env.APP_ORIGIN !== "https://127.0.0.1:3443") process.exit(1);
let app, server;
try {
  app = next({ dev: false, hostname: "127.0.0.1", port: 3443, quiet: true });
  await app.prepare();
  const handler = app.getRequestHandler();
  server = createServer({ key: readFileSync(process.env.M1_TLS_KEY), cert: readFileSync(process.env.M1_TLS_CERT) }, handler);
  server.on("error", () => process.exit(1));
  server.listen(3443, "127.0.0.1", () => process.send({ ready: true }));
} catch { process.exit(1); }
process.on("SIGTERM", async () => {
  server?.closeAllConnections();
  server?.close();
  await app?.close();
  process.exit(0);
});
