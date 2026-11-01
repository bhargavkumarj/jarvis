"use client";
import { useRef, useState } from "react";
import type { Preferences } from "@/lib/validation";
import { useHydrated } from "@/lib/use-hydrated";
import {useRouter} from 'next/navigation';

export function PreferencesForm({ initial, mode = "settings" }: { initial: Preferences; mode?: "settings" | "welcome" }) {
  const onboarding = mode === "welcome";
  const router=useRouter();
  const locked = useRef(false);
  const hydrated = useHydrated();
  const [values, setValues] = useState(initial);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const update = (key: keyof Preferences, value: string) => { setValues({ ...values, [key]: value }); setStatus("Unsaved changes"); };
  const textField = (key: "display_name" | "assistant_name" | "timezone", label: string, help: string, max: number) => <div className="field"><label htmlFor={key}>{label}</label><input id={key} name={key} value={values[key]} onChange={(e) => update(key, e.target.value)} maxLength={max} required={key !== "display_name"} autoComplete={key === "display_name" ? "nickname" : "off"} aria-invalid={!!fields[key]} aria-describedby={`${key}-help${fields[key] ? ` ${key}-error` : ""}`} /><p id={`${key}-help`} className="help">{help}</p>{fields[key] && <p id={`${key}-error`} className="field-error">{fields[key][0]}</p>}</div>;
  async function save(action: "complete" | "skip") {
    if (locked.current) return;
    locked.current = true; setBusy(true); setFields({}); setError(""); setStatus("");
    try {
      const response = await fetch(onboarding ? "/api/v1/onboarding" : "/api/v1/preferences", { method: onboarding ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(onboarding ? {action, ...(action === "complete" ? {preferences: values} : {})} : values) });
      const data = await response.json();
      if (!response.ok) { setFields(data.fields ?? {}); setExpired(response.status === 401); throw new Error(data.error); }
      if (onboarding) { window.location.assign("/assistant"); return; }
      const { display_name, assistant_name, tone, timezone, locale } = data.profile;
      setValues({ display_name, assistant_name, tone, timezone, locale }); setStatus("Preferences saved.");router.refresh();
    } catch (cause) {
      setError(cause instanceof TypeError ? "Could not confirm a save. Check your connection and reload to verify before retrying." : cause instanceof Error ? cause.message : "Preferences were not saved.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { locked.current = false; setBusy(false); }
  }
  return <form aria-label={onboarding ? "Quick workspace setup" : "Personal and assistant preferences"} onSubmit={event => { event.preventDefault(); void save("complete"); }} aria-busy={busy}>
    <fieldset disabled={!hydrated || busy || expired}><legend className="sr-only">Personal and assistant preferences</legend>
      {!onboarding && <section className="settings-section" aria-labelledby="personal-title"><div><p className="section-number">01</p><h2 id="personal-title">About your workspace</h2><p className="description">Just the essentials. No sensitive details needed.</p></div><div className="stack">{textField("display_name", "Display name", "How you’d like to be addressed. Optional.", 60)}{textField("timezone", "Timezone", "Use an IANA name, for example Asia/Kolkata or Europe/London.", 100)}<div className="field"><label htmlFor="locale">Language & region</label><select id="locale" value={values.locale} onChange={(e) => update("locale", e.target.value)}><option value="en-IN">English · India</option><option value="en-GB">English · United Kingdom</option><option value="en-US">English · United States</option></select><p className="help">English is supported in this first version.</p></div></div></section>}
      <section className="settings-section" aria-labelledby="assistant-title"><div><p className="section-number">02</p><h2 id="assistant-title">Make it feel familiar</h2><p className="description">Choose how your assistant addresses you. Provider selection and separate cloud permissions are managed independently.</p></div><div className="stack">{onboarding && textField("timezone", "Timezone", "Confirm an IANA timezone. New tasks and schedules use it; existing schedules keep their saved zones.", 100)}{textField("assistant_name", "Assistant name", "Choose an original name that feels right to you.", 40)}<div className="field"><label htmlFor="tone">Communication style</label><select id="tone" value={values.tone} onChange={(e) => update("tone", e.target.value)}><option value="balanced">Balanced — clear and considered</option><option value="concise">Concise — brief and direct</option><option value="warm">Warm — friendly and supportive</option></select></div></div></section>
    </fieldset>
    {error && <div ref={errorRef} role="alert" tabIndex={-1} className="error-message">{error}{expired && <p><a href="/sign-in?notice=expired">Sign in again</a></p>}</div>}
    <div className="save-row"><p role="status" aria-live="polite">{status || (onboarding ? "Setup saves only these preferences. It grants no cloud, microphone or notification permission." : "Changes are saved only when you choose Save.")}</p><button type="submit" className="button primary" disabled={!hydrated || busy || expired}>{busy ? "Saving…" : onboarding ? "Save preferences and continue" : "Save preferences"}</button></div>
    {onboarding && <button type="button" className="button secondary" disabled={!hydrated || busy || expired} onClick={() => void save("skip")}>Skip optional setup</button>}
  </form>;
}
