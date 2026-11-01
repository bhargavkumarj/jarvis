import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export default async function Verify({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return <AuthScreen mode="verify" recovery={mode === "recovery"} />;
}
