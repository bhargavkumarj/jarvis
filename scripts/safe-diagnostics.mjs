// Never serialize Error, SQL parameters, connection URLs or provider responses.
export function safeDiagnostic(error, operation) {
  const text = String(error?.message ?? "").toLowerCase();
  const result = { operation, sqlstate: /^(?:[0-9][0-9A-Z]|P[0-9]|XX|F0|HV)[0-9A-Z]{3}$/.test(error?.code ?? "") ? error.code : null };
  const routine = String(error?.where ?? "").match(/function (?:private\.)?(m2[bc]_[a-z0-9_]+)\([^)]*\) line (\d+)/i);
  if (routine) { result.routine = routine[1]; result.routineLine = Number(routine[2]); }
  for (const schema of ["auth", "private", "public"]) {
    if (text.includes(`permission denied for schema ${schema}`)) return { ...result, category: "sql_schema_privilege", schema };
  }
  if (/permission denied|must be owner|must be member|must be able to set role/.test(text) && result.sqlstate) return { ...result, category: "sql_privilege" };
  if (/docker.*access denied|docker.*socket|docker is unavailable/.test(text)) return { ...result, category: "docker_unavailable_or_denied" };
  if (["EPERM", "EACCES"].includes(error?.code)) return { ...result, category: "execution_permission" };
  if (error?.code === "ECONNREFUSED") return { ...result, category: "connection_refused" };
  return { ...result, category: result.sqlstate ? "sql_error" : "unavailable" };
}
