import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const root = new URL("../", import.meta.url);
export function assertLocalDockerEndpoint(endpoint) {
  if (!(endpoint?.startsWith("unix:///") || endpoint?.startsWith("npipe:////./pipe/"))) {
    throw new Error("Refusing a remote/TCP Docker endpoint. Local tooling requires a local Unix socket or local Windows named pipe.");
  }
}
export function assertLocalCommand(args) {
  const allowed = [
    ["start"], ["stop"], ["status", "-o", "json"], ["db", "reset", "--local"],
    ["migration", "up", "--local"], ["gen", "types", "typescript", "--local", "--schema", "public"],
  ];
  if (!allowed.some((command) => JSON.stringify(command) === JSON.stringify(args))) throw new Error("Refusing an unapproved local CLI command or remote/database URL flags.");
}
export function describeLocalCliFailure(error, args = []) {
  // Inspect in memory only. Return fixed messages, never CLI output: it can contain keys.
  const detail = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}`.toLowerCase();
  if (error?.code === "ETIMEDOUT" && JSON.stringify(args) === JSON.stringify(["status", "-o", "json"])) return "Local Supabase status timed out after 10 seconds. No database changes were attempted. Check the local Docker/runtime status in your normal terminal; do not reset the database or share raw status JSON.";
  if (/read-only file system/.test(detail)) return "Docker or Supabase storage is read-only. Docker cannot save container metadata/images. Check available disk space and restart Docker Desktop before retrying pnpm db:start. Do not delete volumes or reset Docker without backing up existing Docker data.";
  if (error?.code === "ENOENT") return "Local Supabase executable is missing. Run pnpm install --frozen-lockfile and check pnpm's build-script approval notice for Supabase.";
  if (/supabase_edge_runtime.*unexpected status|edge.runtime.*health check/s.test(detail)) return "Supabase Edge Runtime failed its health check. M1 does not use Edge Functions and disables edge_runtime in supabase/config.toml. Retry with the current repository configuration; keep health checks enabled for required services.";
  if (/permission denied.*docker|docker.*permission denied|docker\.sock.*(?:eacces|eperm)/s.test(detail)) return "Docker access denied. This terminal cannot access the Docker socket. Use your normal local terminal with Docker Desktop running; do not run the project with sudo.";
  if (/cannot connect to the docker|is the docker daemon running|docker.*(?:not running|not found)|failed to connect.*docker/s.test(detail)) return "Docker is unavailable. Open Docker Desktop, wait until its engine is running, then retry pnpm db:start.";
  if (/address already in use|port is already allocated|bind.*already in use/s.test(detail)) return "A local Supabase port is already occupied. Check for another local Supabase project or process using ports 54320–54324; do not delete database volumes.";
  if (/permission denied to (?:alter|set) role|only roles with the superuser attribute|must be able to set role|must be member of role|permission denied for (?:schema|table|function|relation|sequence)|must be owner of (?:function|table|schema)/.test(detail)) return "Database migration privileges failed. This is a SQL migration issue, not a filesystem permission or missing API key. Inspect the failed SQL statement locally; do not use sudo or grant superuser to the application.";
  if (/(?:permission denied|operation not permitted|eacces|eperm)/.test(detail)) return "Local Supabase filesystem or process permission denied. Run from a normal local terminal and check access to your user-owned Supabase configuration directory; do not use sudo or broad permission changes.";
  if (/failed to parse config|invalid config|error parsing.*config|config.*(?:unknown key|unrecognized)/s.test(detail)) return "Supabase rejected supabase/config.toml. Inspect the CLI error locally and report only the configuration field/error, without keys or credentials.";
  if (/failed to (?:pull|download)|pull access denied|tls handshake timeout|no such host|network.*unreachable/s.test(detail)) return "Supabase could not download a required container image. Check Docker's registry/network access, then retry pnpm db:start.";
  if (JSON.stringify(args) === JSON.stringify(["migration", "up", "--local"])) return "Local Supabase migration command failed; the cause is not yet identified. Inspect pnpm exec supabase migration up --local privately and share only the first ERROR, SQLSTATE and failing statement, with credentials removed. Do not share full debug output or reset the database. No remote database was contacted by this wrapper.";
  if (JSON.stringify(args) === JSON.stringify(["status", "-o", "json"])) return "Local Supabase runtime status check failed; the cause is not yet identified. Check Docker Desktop and local Supabase service health in your normal terminal. Raw status JSON can contain credentials; do not share it. No migration was started by this status check.";
  return "Local Supabase command failed; the cause is not yet identified. Inspect pnpm exec supabase start privately in your terminal and share only the first error, with credentials removed. Do not share its full output. No remote database was contacted by this wrapper.";
}
export function runLocalCli(args) {
  assertLocalCommand(args);
  const config = readFileSync(new URL("supabase/config.toml", root), "utf8");
  if (!config.includes('project_id = "jarvis-foundation"')) throw new Error("Refusing to operate outside the isolated jarvis-foundation project.");
  // No --linked, --db-url or remote URL accepted by this wrapper.
  if (process.env.DOCKER_HOST) assertLocalDockerEndpoint(process.env.DOCKER_HOST);
  let endpoint;
  try {
    endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000, killSignal: "SIGKILL" }).trim();
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Captured context output may contain private endpoints.
    throw new Error(error?.code === "ETIMEDOUT" ? "Local Docker context inspection timed out after 5 seconds. No Supabase command or database change was attempted." : "Local Docker context could not be inspected. Check Docker Desktop from your normal terminal; no remote command was executed.");
  }
  assertLocalDockerEndpoint(endpoint);
  try {
    return execFileSync(new URL("node_modules/.bin/supabase", root).pathname, args, {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 8 * 1024 * 1024,
      // Only kill owned read-only helpers. Do not impose a new timeout on a
      // migration/start/reset which might be in the middle of changing data.
      ...(JSON.stringify(args) === JSON.stringify(["status", "-o", "json"]) ? { timeout: 10000, killSignal: "SIGKILL" } : {}),
    });
  } catch (error) {
    // CLI failures may include credentials; never echo raw stdout/stderr.
    // eslint-disable-next-line preserve-caught-error -- A nested cause could expose captured keys when printed.
    throw new Error(describeLocalCliFailure(error, args));
  }
}
export function diagnosticFetch(url, init = {}) {
  // Used only by the read-only operator diagnostic, never ordinary web Auth.
  return fetch(url, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(5000)]) });
}
export function assertLocalUrl(value, port) {
  const u = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.port !== String(port)) {
    throw new Error("Refusing non-local or unexpected database/test endpoint.");
  }
}
export function localStatus() {
  const data = JSON.parse(runLocalCli(["status", "-o", "json"]));
  assertLocalUrl(data.API_URL, 54321);
  assertLocalUrl(data.DB_URL, 54322);
  if (!data.ANON_KEY || !data.SERVICE_ROLE_KEY) throw new Error("Local Supabase credentials are unavailable. Start the local runtime first.");
  return data;
}
