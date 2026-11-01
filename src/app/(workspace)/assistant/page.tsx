export const metadata = {title: 'Assistant'};
import { AssistantWorkspace } from "@/components/assistant-workspace";
import Link from 'next/link';
import {identity} from '@/lib/supabase';
export default async function Assistant() {
  const account = await identity({readOnly: true});
  return <>{account?.profile.onboarding_completed_at === null && <aside className="setup-disclosure" aria-label="Optional first setup"><p>Make this space yours: choose an assistant name, style and time zone.</p><Link href="/welcome">Quick setup — optional</Link></aside>}<AssistantWorkspace/></>;
}
