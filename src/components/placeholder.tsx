import Link from "next/link";
import { ArrowRight, Sprout } from "lucide-react";
export function Placeholder({ title, description }: { title: string; description: string }) {
  return <section className="placeholder"><p className="eyebrow">YOUR PERSONAL WORKSPACE</p><h1>{title}</h1><div className="empty-state"><Sprout size={36} strokeWidth={1.4} aria-hidden="true" /><h2>A thoughtful beginning.</h2><p>{description}</p><p className="help">This section is reserved for a later milestone. No content is being created here.</p><Link className="button secondary" href="/settings">Make this space yours<ArrowRight size={17} aria-hidden="true" /></Link></div></section>;
}
