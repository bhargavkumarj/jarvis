export const metadata = {title: 'Today'};
import { ReminderWorkspace } from '@/components/reminder-workspace';
import { identity } from '@/lib/supabase';
export default async function Today(){const account=await identity({readOnly:true});return <ReminderWorkspace timezone={account?.profile.timezone??'UTC'}/>;}
