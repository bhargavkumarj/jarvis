"use client";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";
import {broadcastSession} from "@/lib/session-events";
export function SignOut() {
  const hydrated = useHydrated();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked=useRef(false);
  return <div><button className="sign-out" disabled={!hydrated || busy} onClick={async () => {
    if(locked.current)return;locked.current=true;
    broadcastSession('pause');
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      broadcastSession('signedout');
      window.location.replace(data.redirect);
    } catch { setError("Sign-out was not confirmed. Please retry.");locked.current=false;setBusy(false); }
  }}><LogOut size={17} aria-hidden="true" />{busy ? "Signing out…" : "Sign out"}</button>{error && <p className="error-message" role="alert">{error}</p>}</div>;
}
