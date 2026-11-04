// Public, non-secret computer-control configuration shared by server and client.
// The extension ID is derived from the public key in
// apps/jarvis-browser-bridge/manifest.base.json (no private key is committed).
export const DEV_EXTENSION_ID = 'fomkddjghmfjocinjmbdagahcbilimof';
export const COMPUTER_CONSENT = 'computer-control-2026-11-05-v1';
export function computerExtensionId(env: Record<string, string | undefined> = process.env): string {
  const value = env.JARVIS_COMPUTER_EXTENSION_ID?.trim();
  if (!value) return DEV_EXTENSION_ID;
  if (!/^[a-p]{32}$/.test(value)) throw new Error('JARVIS_COMPUTER_EXTENSION_ID must be a 32-character Chrome extension ID (letters a–p).');
  return value;
}
export const COMPUTER_DISCLOSURE = [
  'When you send a message while computer control is on, its text is checked on this JARVIS server against the aliases your paired Mac published (names only; no app paths, folder locations or Shortcut lists). Matching commands are interpreted without an AI call.',
  'Only five action types exist: open an approved app, open an approved website, set output volume to an exact percentage, open an approved folder in Finder, and run an approved Shortcut. There is no shell, script or file access.',
  'Your Mac shows its own approval for every plan unless you allowed a specific low-risk item there. Shortcuts always ask, every run. Receipts report what the Mac observed, not more.',
  'Action history (aliases, states and short results) is kept for 30 days, is included in export, and can be cleared at any time.',
];
