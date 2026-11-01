export const metadata = {title: 'Quick setup'};
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {identity} from '@/lib/supabase';
import {PreferencesForm} from '@/components/preferences-form';
import {LiveSettings} from '@/components/live-settings';
export default async function Welcome() {
  const account = await identity({readOnly: true});
  if (!account) redirect('/sign-in?notice=expired');
  const {display_name, assistant_name, tone, timezone, locale} = account.profile;
  return <div className="settings"><p className="eyebrow">A SHORT START</p><h1>Welcome to your workspace</h1>
    <p className="page-description">Choose a name, style and time zone, or skip for now. You can change these in Settings. Nothing is created on your behalf.</p>
    <PreferencesForm mode="welcome" initial={{display_name, assistant_name, tone, timezone, locale}}/>
    <section className="setup-disclosure" aria-labelledby="setup-privacy"><h2 id="setup-privacy">Your choice of processing</h2>
      <p>The local mock is a deterministic demonstration. Enabled OpenAI text receives bounded conversation context and selected approved memories; audio transcription needs separate consent. Pushover receives only generic reminder text after a separately reviewed schedule.</p>
      <p>Setup grants none of these permissions and never requests a microphone. Temporary chat keeps application content only in this page; a live provider has its own retention boundary. Review <Link href="/settings#privacy-center">Privacy Center</Link> whenever you need.</p>
    </section><LiveSettings compact/>
    <p><Link href="/assistant">Go to Assistant without changing preferences</Link></p>
  </div>;
}
