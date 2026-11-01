-- Additive onboarding marker after the full privacy chain. No existing row is
-- forced back through setup; new accounts can complete or explicitly skip it.
alter table public.profiles add column onboarding_completed_at timestamptz;
update public.profiles set onboarding_completed_at=now();
-- Existing owner/live-session/admission/deletion RLS still controls the update.
-- No new role, SECURITY DEFINER helper, schema access or worker privilege.
grant update(onboarding_completed_at) on public.profiles to authenticated;
