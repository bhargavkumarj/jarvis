import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const messages: Record<string, string> = { expired: "Your session has ended or access is unavailable. Please sign in again.", "signed-out": "You’re signed out of this session.", "password-updated": "Password updated. Sign in with your new password." };
  return <AuthScreen mode="sign-in" notice={notice ? messages[notice] : undefined} />;
}
