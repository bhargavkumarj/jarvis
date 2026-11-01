import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth-screen";
import { identity } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function ResetPassword() {
  if (!(await identity({ readOnly: true }))) redirect("/sign-in?notice=expired");
  return <AuthScreen mode="password" />;
}
