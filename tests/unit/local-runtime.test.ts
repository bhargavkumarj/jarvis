import { describe, expect, it } from "vitest";
import { describeLocalCliFailure } from "../../scripts/local-runtime.mjs";

describe("safe local startup diagnostics", () => {
  it.each([
    ["permission denied while trying to connect to the Docker API at docker.sock", "Docker access denied"],
    ["Cannot connect to the Docker daemon. Is the docker daemon running?", "Docker is unavailable"],
    ["bind: address already in use", "port is already occupied"],
    ["EPERM: operation not permitted, open ~/.supabase/telemetry.json", "permission denied"],
    ["failed to parse config: unknown key", "rejected supabase/config.toml"],
    ["failed to pull container image", "could not download"],
    ["write /var/lib/desktop-containerd/daemon/io.containerd.metadata.v1.bolt/meta.db: read-only file system", "storage is read-only"],
    ["failed to pull docker image from all registries: write meta.db: read-only file system", "storage is read-only"],
    ["Applying migration: ERROR permission denied to alter role (SQLSTATE 42501). Only roles with the SUPERUSER attribute may alter roles with the SUPERUSER attribute.", "SQL migration issue"],
    ["supabase_edge_runtime_jarvis-foundation unexpected status 503", "Edge Runtime failed its health check"],
    ["ERROR: permission denied for schema private (SQLSTATE 42501)", "SQL migration issue"],
    ["ERROR: permission denied for function auth_session_is_active (SQLSTATE 42501)", "SQL migration issue"],
    ["ERROR: permission denied to set role jarvis_auth_guard (SQLSTATE 42501)", "SQL migration issue"],
  ])("classifies an error without reflecting credentials", (stderr, expected) => {
    const sentinel = "NONCREDENTIAL_OUTPUT_SENTINEL";
    const message = describeLocalCliFailure({ stderr: `${stderr}\nsecret=${sentinel}`, stdout: sentinel });
    expect(message).toContain(expected);
    expect(message).not.toContain(sentinel);
  });
  it("suppresses unknown CLI output and spawn errors", () => {
    expect(describeLocalCliFailure({ stdout: "NONCREDENTIAL_OUTPUT_SENTINEL" })).not.toContain("NONCREDENTIAL_OUTPUT_SENTINEL");
    expect(describeLocalCliFailure({ code: "ENOENT" })).toContain("executable is missing");
  });
  it("directs an unknown migration failure to the actual local migration command", () => {
    const message = describeLocalCliFailure({ stderr: "DO_NOT_REFLECT_SENTINEL" }, ["migration", "up", "--local"]);
    expect(message).toContain("pnpm exec supabase migration up --local");
    expect(message).not.toContain("supabase start"); expect(message).not.toContain("DO_NOT_REFLECT_SENTINEL");
  });
  it("identifies a failed runtime preflight without recommending raw status JSON sharing", () => {
    const message = describeLocalCliFailure({ stdout: "DO_NOT_REFLECT_SENTINEL" }, ["status", "-o", "json"]);
    expect(message).toContain("runtime status check failed"); expect(message).toContain("do not share it");
    expect(message).not.toContain("DO_NOT_REFLECT_SENTINEL");
  });
});
