import {PrivacyBoundary} from "@/components/privacy-boundary";
import { redirect } from "next/navigation";
import { Compass } from "lucide-react";
import { identity } from "@/lib/supabase";
import { Navigation, WorkspaceTitle } from "@/components/navigation";
import { SignOut } from "@/components/sign-out";
export const dynamic = "force-dynamic";
export default async function Workspace({ children }: { children: React.ReactNode }) {
  const account = await identity({ readOnly: true });
  if (!account) redirect("/sign-in?notice=expired");
  return <div className="workspace"><PrivacyBoundary/>
    <aside className="sidebar"><div className="wordmark"><Compass size={26} strokeWidth={1.6} aria-hidden="true" /><span>{account.profile.assistant_name}<span className="wordmark-sub">personal assistant</span></span></div><Navigation /><div className="sidebar-bottom"><span className="environment"><span aria-hidden="true" />Local personal workspace</span><SignOut /></div></aside>
    <div className="workspace-content"><header className="workspace-header"><WorkspaceTitle/><span className="user-label">{account.profile.display_name || "Personal account"}</span></header><main id="main" tabIndex={-1}>{children}</main><footer className="workspace-footer">Your choices shape this space.</footer></div>
  </div>;
}
