"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, CalendarDays, BookOpen, SlidersHorizontal } from "lucide-react";
const destinations = [
  { href: "/assistant", label: "Assistant", Icon: MessageSquare },
  { href: "/today", label: "Today", Icon: CalendarDays },
  { href: "/memory", label: "Memory", Icon: BookOpen },
  { href: "/settings", label: "Settings", Icon: SlidersHorizontal },
];
export function Navigation() {
  const path = usePathname();
  return <nav aria-label="Main navigation" className="navigation">{destinations.map(({ href, label, Icon }) => <Link key={href} href={href} prefetch={false} aria-current={path === href ? "page" : undefined}><Icon size={20} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></Link>)}</nav>;
}
export function WorkspaceTitle(){const path=usePathname();return <span>{destinations.find(d=>d.href===path)?.label??(path==='/welcome'?'Quick setup':'Your workspace')}</span>;}
