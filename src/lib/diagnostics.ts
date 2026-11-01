import "server-only";
import { safeDiagnostic } from "../../scripts/safe-diagnostics.mjs";

// Static operations and allowlisted codes only; no user IDs, requests or causes.
export function reportDatabaseFailure(operation: "profile_read" | "profile_write" | "sign_in_profile", error: unknown) {
  console.error(JSON.stringify({ event: "database_operation_failed", ...safeDiagnostic(error, operation) }));
}
