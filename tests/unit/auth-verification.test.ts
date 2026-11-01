import { describe, expect, it } from "vitest";
import { emailRequestFailure, verificationFailure, passwordSignInFailure } from "../../src/lib/auth-errors";
import { verificationSchema } from "../../src/lib/validation";

describe("verification boundaries", () => {
  const input = { email: "recovery@example.test", token: "000000", type: "email" };
  it("accepts current email and recovery purposes only", () => {
    expect(verificationSchema.safeParse(input).success).toBe(true);
    expect(verificationSchema.safeParse({ ...input, type: "recovery" }).success).toBe(true);
    for (const type of ["signup", "invite", "email_change", "sms"]) expect(verificationSchema.safeParse({ ...input, type }).success).toBe(false);
  });
  it("rejects alternate credential and authority fields", () => {
    for (const key of ["token_hash", "owner_id", "redirect_to", "role"]) expect(verificationSchema.safeParse({ ...input, [key]: "untrusted" }).success).toBe(false);
  });
  it("keeps ineligible and already-confirmed email requests indistinguishable", () => {
    for (const code of ["email_not_confirmed", "user_not_found", "email_exists", "unknown_error"]) expect(emailRequestFailure({ code, status: 400 })).toBeNull();
  });
  it("reports throttling and infrastructure failures without reflecting account data", () => {
    for (const status of [429, 500, 503]) {
      const providerError = { status, message: "NONCREDENTIAL_EMAIL_SENTINEL" };
      const failure = emailRequestFailure(providerError);
      expect(failure?.status).toBe(status === 429 ? 429 : 503);
      expect(JSON.stringify(failure)).not.toContain(providerError.message);
    }
  });
  it.each([
    [{ code: "otp_expired", status: 403 }, 400, "verification_rejected"],
    [{ code: "over_request_rate_limit", status: 429 }, 429, "verification_rate_limited"],
    [{ code: "unexpected_failure", status: 500 }, 503, "verification_service_unavailable"],
    [{ code: "unrecognized_provider_code", status: 502 }, 503, "verification_service_unavailable"],
    [{ code: "unrecognized_provider_code", status: 400 }, 400, "verification_rejected"],
  ])("returns useful failure classes without reflecting provider content", (error, status, code) => {
    const marker = "NONCREDENTIAL_REQUEST_CONTENT_SENTINEL";
    const providerError = { ...error, message: marker };
    const result = verificationFailure(providerError);
    expect(result.status).toBe(status); expect(result.body.code).toBe(code);
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain("unrecognized_provider_code");
  });
});
describe('transport failure versus credential rejection',()=>{
  it.each([{status:0},{status:503},{name:'AuthRetryableFetchError'}])('reports unavailable Auth without suggesting an invalid password: %j',error=>{
    const e={...error,message:'PRIVATE_PROVIDER_SENTINEL',email:'PRIVATE_ACCOUNT_SENTINEL'};
    const result=passwordSignInFailure(e);expect(result.status).toBe(503);expect(result.body.error).toContain('unreachable');expect(result.body.error).not.toContain('Check your details');expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
    expect(emailRequestFailure(e)?.status).toBe(503);expect(verificationFailure(e).status).toBe(503);
  });
  it('does not expose whether an account exists or has confirmed email',()=>{
    const responses=['invalid_credentials','email_not_confirmed','user_not_found','unknown'].map(code=>passwordSignInFailure({status:400,code}));
    expect(responses.every(r=>r.status===401)).toBe(true);expect(new Set(responses.map(r=>r.body.error)).size).toBe(1);
  });
  it('retains separate rate-limit behavior',()=>{expect(passwordSignInFailure({status:429}).status).toBe(429);expect(passwordSignInFailure({code:'over_request_rate_limit'}).status).toBe(429);});
});
