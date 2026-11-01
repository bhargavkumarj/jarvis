import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Your personal assistant", template: "%s · Personal assistant" }, description: "A quiet place to think, remember, and follow through." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><noscript><p className="notice">JavaScript is required for these forms. Controls become available when the application has loaded.</p></noscript>{children}</body></html>;
}
