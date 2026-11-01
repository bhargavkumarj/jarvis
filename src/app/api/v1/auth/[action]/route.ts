import { z } from "zod";
import { supabase, identity } from "@/lib/supabase";
import { getConfig } from "@/lib/config";
import { json, validMutation, readBody } from "@/lib/http";
import { credentialsSchema, registrationSchema, verificationSchema, emailSchema, newPassword } from "@/lib/validation";
import { emailRequestFailure, verificationFailure, passwordSignInFailure } from "@/lib/auth-errors";
import { reportDatabaseFailure } from "@/lib/diagnostics";

const emailOnly = z.strictObject({ email: emailSchema });
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const config = getConfig();
    if (!validMutation(request, config.APP_ORIGIN)) return json({ error: "Request origin or format not accepted." }, 403);
    let body: unknown;
    try { body = await readBody(request); } catch { return json({ error: "Invalid or oversized request." }, 400); }
    const { action } = await params;
    const client = await supabase();
    if (action === "sign-in") {
      const parsed = credentialsSchema.safeParse(body);
      if (!parsed.success) return json({ error: "Enter your email and password." }, 422);
      const { error } = await client.auth.signInWithPassword(parsed.data);
      if (error) {const failure=passwordSignInFailure(error);return json(failure.body,failure.status);}
      const { data, error: profileError } = await client.from("profiles").select("owner_id").maybeSingle();
      if (profileError) { reportDatabaseFailure("sign_in_profile", profileError); await client.auth.signOut({ scope: "local" }); return json({ error: "Account access could not be checked. Inspect local schema diagnostics and try again." }, 503); }
      if (!data) { await client.auth.signOut({ scope: "local" }); return json({ error: "Unable to sign in. Check your details and access, then try again." }, 401); }
      return json({ redirect: "/assistant" });
    }
    if (action === "register") {
      const parsed = registrationSchema.safeParse(body);
      if (!parsed.success) return json({ error: "Enter a valid email and a password of 12–128 characters." }, 422);
      await client.auth.signUp(parsed.data);
      // Identical response for admitted, non-admitted and existing emails.
      return json({ message: "If this address is eligible, a verification code will arrive in the local mailbox. Registration is by invitation only." });
    }
    if (action === "recover" || action === "resend") {
      const parsed = emailOnly.safeParse(body);
      if (!parsed.success) return json({ error: "Enter a valid email address." }, 422);
      const { error } = action === "recover"
        ? await client.auth.resetPasswordForEmail(parsed.data.email)
        : await client.auth.resend({ type: "signup", email: parsed.data.email });
      if (error) { const failure = emailRequestFailure(error); if (failure) return json(failure.body, failure.status); }
      return json({ message: "If the account is eligible, check the local mailbox for a new email. Delivery is not confirmed here. Already confirmed? Sign in with your password or use password recovery." });
    }
    if (action === "verify") {
      const parsed = verificationSchema.safeParse(body);
      if (!parsed.success) return json({ error: "Enter your email and six-digit code." }, 422);
      const { data, error } = await client.auth.verifyOtp(parsed.data);
      if (error) { const failure = verificationFailure(error); return json(failure.body, failure.status); }
      if (!data.session) return json({ error: "Verification did not establish a session. Try signing in or request a fresh code." }, 503);
      return json({ redirect: parsed.data.type === "recovery" ? "/reset-password" : "/assistant" });
    }
    if (action === "password") {
      const parsed = z.strictObject({ password: newPassword }).safeParse(body);
      if (!parsed.success) return json({ error: "Use a password of 12–128 characters." }, 422);
      const account = await identity();
      if (!account) return json({ error: "Your session has ended. Request a new recovery code." }, 401);
      const { error } = await account.client.auth.updateUser({ password: parsed.data.password });
      if (error) return json({ error: "Password was not changed. Request a fresh recovery code and try again." }, 400);
      // End the recovery session; normal password sign-in is required next.
      const { error: revokeError } = await account.client.rpc("revoke_current_session");
      if (revokeError) return json({ error: "Password changed, but session revocation could not be confirmed. Please sign out." }, 503);
      const { error: signOutError } = await account.client.auth.signOut({ scope: "global" });
      if (signOutError) return json({ error: "Password changed and this session was revoked, but ending all Auth sessions could not be confirmed. Please try signing out again." }, 503);
      return json({ redirect: "/sign-in?notice=password-updated" });
    }
    if (action === "sign-out") {
      const account = await identity();
      if (account) {
        const { error } = await account.client.rpc("revoke_current_session");
        if (error) return json({ error: "Sign-out could not be confirmed. Please try again." }, 503);
      }
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) return json({ error: "Session access was revoked, but cookie cleanup failed. Please try again." }, 503);
      return json({ redirect: "/sign-in?notice=signed-out" });
    }
    return json({ error: "Not found." }, 404);
  } catch { return json({ error: "Authentication service unavailable. Check local Supabase and try again." }, 503); }
}
