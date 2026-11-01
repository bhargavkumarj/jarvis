"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";
import {broadcastSession} from '@/lib/session-events';

export type AuthMode = "sign-in" | "register" | "recover" | "verify" | "password";
const labels: Record<AuthMode, string> = {
  "sign-in": "Sign in", register: "Create invited account", recover: "Send recovery code", verify: "Verify code", password: "Save new password",
};
export function AuthForm({ mode, recovery = false, disabled = false }: { mode: AuthMode; recovery?: boolean; disabled?: boolean }) {
  const hydrated = useHydrated();
  disabled = disabled || !hydrated;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const locked = useRef(false);
  async function send(action: string, body: Record<string, string>) {
    if(locked.current)return;locked.current=true;
    setError(""); setMessage(""); setBusy(true);
    try {
      const response = await fetch(`/api/v1/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to complete the request.");
      if (result.redirect) { broadcastSession(action==='password'?'signedout':'changed');window.location.assign(result.redirect); return; }
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof TypeError ? "Cannot reach the server. Check your connection and try again." : cause instanceof Error ? cause.message : "Unable to complete the request.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { locked.current=false;setBusy(false); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = {};
    for (const [key, value] of form) body[key] = String(value);
    if (mode === "verify") body.type = recovery ? "recovery" : "email";
    await send(mode, body);
  }
  return <form ref={formRef} className="stack" onSubmit={submit} aria-busy={busy}>
    {mode === "verify" && <p className="help">{recovery ? "Password recovery: use the newest ‘Reset your local password’ email." : "Account confirmation: use the newest ‘Confirm your local account’ email."} Codes expire after 10 minutes and can be used once.</p>}
    {mode !== "password" && <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.test" disabled={disabled} /></div>}
    {["sign-in", "register", "password"].includes(mode) && <div className="field"><label htmlFor="password">{mode === "password" ? "New password" : "Password"}</label><input id="password" name="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required minLength={mode === "sign-in" ? 1 : 12} maxLength={128} aria-describedby={mode === "sign-in" ? undefined : "password-help"} disabled={disabled} />{mode !== "sign-in" && <p className="help" id="password-help">Use 12–128 characters. Password managers and paste are welcome.</p>}</div>}
    {mode === "verify" && <div className="field"><label htmlFor="token">Email code</label><input id="token" name="token" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required aria-describedby="code-help" disabled={disabled} /><p className="help" id="code-help">Enter the six-digit code from your local mailbox.</p></div>}
    {error && <p role="alert" className="error-message" ref={errorRef} tabIndex={-1}>{error}</p>}
    {message && <div role="status" className="notice"><p>{message}</p>{mode !== "verify" && <Link href={mode === "recover" ? "/verify?mode=recovery" : "/verify"}>Enter an email code <ArrowRight size={16} aria-hidden="true" /></Link>}</div>}
    <button className="button primary" type="submit" disabled={busy || disabled}>{busy ? "Please wait…" : labels[mode]}<ArrowRight size={18} aria-hidden="true" /></button>
    {mode === "verify" && <><button className="button secondary" type="button" disabled={busy || disabled} onClick={async () => {
      const email = formRef.current?.elements.namedItem("email") as HTMLInputElement | null;
      if (!email?.reportValidity()) return;
      const token = formRef.current?.elements.namedItem("token") as HTMLInputElement | null;
      if (token) token.value = "";
      await send(recovery ? "recover" : "resend", { email: email.value });
    }}>Request a new code</button><Link className="quiet-link" href={recovery ? "/verify" : "/verify?mode=recovery"}>{recovery ? "Use an account confirmation code instead" : "Use a password recovery code instead"}</Link></>}
    {mode === "sign-in" && <Link className="quiet-link" href="/recover">Forgot your password?</Link>}
  </form>;
}
