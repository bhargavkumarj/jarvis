import { describe, expect, it } from "vitest";
import { safeDiagnostic } from "../../scripts/safe-diagnostics.mjs";
import { assertLocalUrl, assertLocalCommand, assertLocalDockerEndpoint } from "../../scripts/local-runtime.mjs";

describe("diagnostic privacy and local database fence", () => {
  it.each(["auth", "private", "public"])("reports only the allowlisted schema %s", (schema) => {
    const result = safeDiagnostic({ code: "42501", message: `permission denied for schema ${schema}; password=DO_NOT_REFLECT_SENTINEL` }, "profile_read");
    expect(result).toEqual({ operation: "profile_read", category: "sql_schema_privilege", sqlstate: "42501", schema });
    expect(JSON.stringify(result)).not.toContain("DO_NOT_REFLECT_SENTINEL");
  });
  it("does not reflect arbitrary messages or connection parameters", () => {
    const result = safeDiagnostic({ code: "ECONNREFUSED", message: "postgres://DO_NOT_REFLECT_SENTINEL@localhost", query: "DO_NOT_REFLECT_SENTINEL" }, "local_connect");
    expect(result.category).toBe("connection_refused");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_REFLECT_SENTINEL");
  });
  it.each(["postgres://remote.example:54322/postgres", "postgres://localhost:5432/postgres"])("rejects a remote or unexpected database endpoint", (url) => {
    expect(() => assertLocalUrl(url, 54322)).toThrow("Refusing non-local");
  });
  it("accepts only the expected loopback port for database access", () => {
    expect(() => assertLocalUrl("postgres://localhost:54322/postgres", 54322)).not.toThrow();
  });
  it("does not confuse Node permission errors with SQLSTATE codes", () => {
    expect(safeDiagnostic({ code: "EPERM", message: "permission denied" }, "connect")).toEqual({ operation: "connect", sqlstate: null, category: "execution_permission" });
  });
  it.each(["ssh://remote.example", "tcp://remote.example:2376", "tcp://127.0.0.1:2375"])("refuses remote or ambiguous Docker endpoints", (endpoint) => {
    expect(() => assertLocalDockerEndpoint(endpoint)).toThrow("Refusing");
  });
  it("allows local socket contexts and exact local reconstruction commands", () => {
    expect(() => assertLocalDockerEndpoint("unix:///var/run/docker.sock")).not.toThrow();
    expect(() => assertLocalCommand(["db", "reset", "--local"])).not.toThrow();
  });
  it.each([["db", "reset", "--linked"], ["db", "reset", "--db-url", "postgres://remote.example"], ["migration", "up"]])("rejects remote or implicit CLI targeting", (...args) => {
    expect(() => assertLocalCommand(args)).toThrow("Refusing");
  });
});
