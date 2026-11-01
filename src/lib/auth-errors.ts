// Never return provider messages: they can contain request data or account details.
type AuthFailure = { code?: string; status?: number; name?: string };
function serviceUnavailable(error: AuthFailure) {
  return error.status === 0 || error.name === 'AuthRetryableFetchError' || (error.status !== undefined && error.status >= 500);
}
export function passwordSignInFailure(error: AuthFailure) {
  if (error.status === 429 || error.code === 'over_request_rate_limit') return {status: 429, body: {error: 'Too many sign-in attempts. Wait a few minutes before trying again.'}};
  if (serviceUnavailable(error)) return {status: 503, body: {error: 'Local sign-in service is unavailable or unreachable. Sign-in was not confirmed. Check local Supabase before retrying; changing your password will not repair a connection failure.'}};
  // Keep invalid credentials, unconfirmed email and ineligible accounts opaque.
  return {status: 401, body: {error: 'Unable to sign in. Check your details and email verification, then try again.'}};
}
export function emailRequestFailure(error: AuthFailure) {
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return { status: 429, body: { error: "The email request was rate limited. Wait a few minutes before requesting another code." } };
  }
  if (serviceUnavailable(error)) {
    return { status: 503, body: { error: "The authentication service could not complete the email request. Check local Supabase and its mail service. Email delivery has not been confirmed." } };
  }
  // Account-specific errors stay indistinguishable from other eligibility outcomes.
  return null;
}
export function verificationFailure(error: AuthFailure) {
  if (error.code === "over_request_rate_limit" || error.status === 429) {
    return { status: 429, body: { code: "verification_rate_limited", error: "Too many verification attempts. Wait a few minutes before trying again." } };
  }
  if (error.code === "unexpected_failure" || serviceUnavailable(error)) {
    return { status: 503, body: { code: "verification_service_unavailable", error: "The authentication service could not finish verification. Check local Supabase before retrying. Access has not been confirmed." } };
  }
  return { status: 400, body: { code: "verification_rejected", error: "This code is invalid, expired, or already used. Request a new code and use the newest email for the selected verification purpose." } };
}
