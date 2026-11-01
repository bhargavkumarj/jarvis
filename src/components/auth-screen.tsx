import Link from "next/link";
import { Compass, ArrowUpRight, LockKeyhole } from "lucide-react";
import { AuthForm, type AuthMode } from "./auth-form";
import { getConfig } from "@/lib/config";

const copy: Record<AuthMode, { title: string; description: string }> = {
  "sign-in": { title: "A little space for you.", description: "Sign in to your personal workspace. Your preferences, at your pace." },
  register: { title: "Make yourself at home.", description: "This is a private workspace. Only an email approved by the operator can create an account." },
  recover: { title: "Find your way back.", description: "Request an email code to choose a new password. Account details stay private." },
  verify: { title: "One small check.", description: "Confirm the code from your local email inbox to continue." },
  password: { title: "A fresh start.", description: "Choose a new password. You’ll sign in again when it’s saved." },
};
export function AuthScreen({ mode, recovery, notice }: { mode: AuthMode; recovery?: boolean; notice?: string }) {
  let setup = "";
  try { getConfig(); } catch (cause) { setup = cause instanceof Error ? cause.message : "Check local setup."; }
  return <div className="auth-shell">
    <header className="auth-header"><Link href="/sign-in" className="wordmark"><Compass size={25} strokeWidth={1.6} aria-hidden="true" /><span>personal assistant<span className="wordmark-sub">A workspace of your own</span></span></Link><span className="environment"><span aria-hidden="true" />Local personal workspace</span></header>
    <main id="main" className="auth-main" tabIndex={-1}>
      <section className="auth-intro" aria-labelledby="intro-title"><p className="eyebrow">A QUIETER KIND OF ASSISTANT</p><h2 id="intro-title">Room to think.<br />Space to <em>be you.</em></h2><p className="intro-description">A personal assistant built around your choices. Start with a workspace that feels like yours.</p><div className="intro-rule" /><p className="intro-footnote"><LockKeyhole size={18} aria-hidden="true" />Private access. Deliberate choices.</p></section>
      <section className="auth-panel" aria-labelledby="auth-title"><p className="eyebrow">YOUR WORKSPACE</p><h1 id="auth-title">{copy[mode].title}</h1><p className="description">{copy[mode].description}</p>
        {notice && <p className="notice" role="status">{notice}</p>}
        {setup && <p className="notice" role="alert">{setup}</p>}
        <AuthForm key={`${mode}-${!!recovery}`} mode={mode} recovery={recovery} disabled={!!setup} />
        <div className="auth-links">{mode === "sign-in" ? <><Link href="/register">Have an invitation? Create an account <ArrowUpRight size={15} aria-hidden="true" /></Link><Link href="/verify">Already have an email code?</Link><Link href="/privacy/deletion">Check a pending account deletion</Link></> : <Link href="/sign-in">Back to sign in</Link>}</div>
      </section>
    </main>
    <footer className="auth-footer"><span>Built to help. Designed to respect your choices.</span><span>Personal version · Runtime acceptance pending</span></footer>
  </div>;
}
