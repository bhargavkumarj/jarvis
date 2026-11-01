export const metadata = {title: 'Settings'};
import { redirect } from "next/navigation";
import { identity } from "@/lib/supabase";
import {PrivacyCenter} from "@/components/privacy-center";
import {LiveSettings} from "@/components/live-settings";
import { PreferencesForm } from "@/components/preferences-form";
import Link from 'next/link';
export default async function Settings() {
  const account = await identity({ readOnly: true });
  if (!account) redirect("/sign-in?notice=expired");
  const { display_name, assistant_name, tone, timezone, locale } = account.profile;
  return <div className="settings"><p className="eyebrow">A SPACE THAT FITS YOU</p><h1>Settings</h1><p className="page-description">A few small choices to make this workspace your own. <Link href="/welcome">Revisit quick setup</Link></p><PreferencesForm initial={{ display_name, assistant_name, tone, timezone, locale }} /><LiveSettings /><PrivacyCenter /><p className="privacy-note">Optional cloud transcription is off by default. In Assistant → Push to talk → Cloud transcription and privacy, read the audio disclosure and enable it separately. Browser microphone permission alone does not enable cloud processing. Read-aloud uses only browser-reported local voices and is never automatic.</p><p className="privacy-note">Review provider status and explicit memory/reminder controls before using personal content. This local phase is not public-launch or full daily-use readiness.</p></div>;
}
