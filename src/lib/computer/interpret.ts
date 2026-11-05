// Deterministic, alias-constrained interpretation of typed or reviewed-voice text
// into at most five typed computer actions. No model call: the five v1 actions
// resolve only against the closed catalogue a paired Mac published, so a model
// would add cost and prompt-injection surface without adding capability.
// Unrecognised text returns not_command and continues through the ordinary
// conversation flow unchanged.
import {
  ACTION_FOR_KIND, ACTION_LABELS, LIMITS, type Action, type ActionType, type CatalogueEntry, type ResourceKind,
} from '../../../packages/computer-control-contracts/src/index.ts';

export type Interpretation =
  | { kind: 'not_command' }
  | { kind: 'clarification'; message: string }
  | { kind: 'plan'; actions: Action[]; labels: string[]; autoEligible: boolean };
export type InterpretContext = { catalogue: CatalogueEntry[]; enabledActions: ActionType[]; volumeAuto: boolean };

const VERBS = ['open', 'launch', 'start', 'run', 'set', 'turn', 'mute', 'unmute', 'change', 'raise', 'lower', 'increase', 'decrease', 'put', 'make'];
const VERB = new RegExp(`^(?:${VERBS.join('|')})\\b`);
const SPLIT = new RegExp(`\\s*(?:,|\\band\\b|\\bthen\\b|;)+\\s*(?=(?:${VERBS.join('|')})\\b)`, 'g');
const KIND_HINTS: [RegExp, ResourceKind][] = [
  [/\b(?:app|application|program)\b/, 'application'],
  [/\b(?:website|site|web ?page|page)\b/, 'website'],
  [/\b(?:folder|directory)\b/, 'folder'],
  [/\bshortcut\b/, 'shortcut'],
];
// Prose that begins with a verb but is about JARVIS's own features stays a conversation.
const CHAT_WORDS = /\b(?:task|tasks|reminder|reminders|memory|memories|conversation|chat|question|discussion|topic|timer|note|notes)\b/;
const KIND_WORD: Record<ResourceKind, string> = { application: 'application', website: 'website', folder: 'folder', shortcut: 'Shortcut' };

export function normalizePhrase(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function phrases(entry: CatalogueEntry): string[] {
  return [...new Set([entry.alias.replace(/-/g, ' '), normalizePhrase(entry.label), ...entry.names.map(normalizePhrase)].filter(Boolean))];
}
function labelFor(entry: CatalogueEntry) {
  return `${ACTION_LABELS[ACTION_FOR_KIND[entry.kind]]} · ${entry.label}${entry.kind === 'website' && entry.detail ? ` (${entry.detail})` : ''}`;
}
function listChoices(entries: CatalogueEntry[]) {
  return entries.slice(0, 6).map((e) => `“${e.label}” (${KIND_WORD[e.kind]})`).join(', ');
}

type Clause = { action: Action; label: string; auto: boolean } | { clarification: string } | null;

function volumeClause(clause: string, ctx: InterpretContext): Clause {
  if (!/\b(?:volume|sound|audio|louder|quieter|softer)\b/.test(clause) && !/^(?:mute|unmute)\b/.test(clause) && !/^turn (?:it |the sound |sound )?(?:up|down)\b/.test(clause)) return null;
  if (!ctx.enabledActions.includes('set_volume')) return { clarification: 'Volume control is turned off in the JARVIS companion on this Mac. Enable it there first.' };
  let percent: number | null = null;
  if (/^mute\b/.test(clause)) percent = 0;
  const absolute = clause.match(/\b(?:to|at)\s+(\d{1,4})\s*(?:%|percent|per cent)?$/) ?? clause.match(/\bvolume\s+(\d{1,4})\s*(?:%|percent|per cent)?$/);
  if (absolute) percent = Number(absolute[1]);
  const relative = /\b(?:up|down|louder|quieter|softer|bit|little|more|less|increase|decrease|raise|lower|by)\b|^unmute\b/.test(clause);
  if (percent === null || (relative && !absolute)) {
    return { clarification: 'Please say an exact level, for example “Set the volume to 30 percent”. Relative changes such as “a bit” are not used in this version so retries stay predictable.' };
  }
  if (percent > 100) return { clarification: 'Volume must be a whole percentage from 0 to 100.' };
  return { action: { type: 'set_volume', percent }, label: `${ACTION_LABELS.set_volume} · ${percent}%`, auto: ctx.volumeAuto };
}

function targetClause(clause: string, ctx: InterpretContext): Clause {
  const verb = clause.match(VERB)?.[0];
  if (!verb || !['open', 'launch', 'start', 'run'].includes(verb)) return null;
  let target = clause.slice(verb.length).trim().replace(/^(?:up\s+)/, '');
  const hinted = KIND_HINTS.find(([pattern]) => pattern.test(target))?.[1] ?? null;
  target = target.replace(/^(?:my|the|a|an)\s+/, '').replace(/\s+(?:app|application|program|website|site|web ?page|page|folder|directory|shortcut|in finder|in chrome|in the browser)$/, '').replace(/^(?:my|the)\s+/, '').trim();
  target = normalizePhrase(target);
  if (!target || target.split(' ').length > 6 || CHAT_WORDS.test(target)) return null;
  const enabled = ctx.catalogue.filter((e) => ctx.enabledActions.includes(ACTION_FOR_KIND[e.kind]) && (!hinted || e.kind === hinted));
  const exact = enabled.filter((e) => phrases(e).includes(target));
  if (exact.length === 1) {
    const e = exact[0];
    return { action: { type: ACTION_FOR_KIND[e.kind], alias: e.alias } as Action, label: labelFor(e), auto: e.kind !== 'shortcut' && e.auto };
  }
  if (exact.length > 1) return { clarification: `“${target}” matches more than one approved item: ${listChoices(exact)}. Say which one, for example “Open the ${exact[0].label} ${KIND_WORD[exact[0].kind].toLowerCase()}”.` };
  const words = target.split(' ');
  const partial = enabled.filter((e) => phrases(e).some((p) => words.every((w) => p.split(' ').includes(w))));
  if (partial.length) return { clarification: `Nothing is approved exactly as “${target}”. Did you mean ${listChoices(partial)}? Repeat the command with the exact name.` };
  // Weak verbs without a kind hint are more often conversation than commands.
  if (!hinted && (verb === 'start' || verb === 'run')) return null;
  const kindWord = hinted ? KIND_WORD[hinted] : 'application, website, folder or Shortcut';
  const known = enabled.length ? ` Approved here: ${listChoices(enabled)}${enabled.length > 6 ? ', …' : ''}.` : ' Nothing is approved yet.';
  return { clarification: `“${target}” is not an approved ${kindWord} on this Mac, so nothing was run.${known} Approve new items on the Mac from Settings → Computer.` };
}

export function interpret(text: string, ctx: InterpretContext): Interpretation {
  let t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const polite = /^(?:(?:hey |ok |okay )?jarvis[,:]?\s+)?(?:please\s+|can you\s+|could you\s+|would you\s+|will you\s+)*/;
  const askedPolitely = /^(?:(?:hey |ok |okay )?jarvis[,:]?\s+)?(?:can|could|would|will) you\b/.test(t);
  t = t.replace(polite, '').replace(/\s*please$/, '');
  if (askedPolitely) t = t.replace(/\?+$/, '');
  t = t.replace(/[.!]+$/, '').trim();
  if (!t || t.includes('?') || t.length > 300) return { kind: 'not_command' };
  if (!VERB.test(t) && !/\b(?:volume)\b/.test(t)) return { kind: 'not_command' };
  const clauses = t.split(SPLIT).map((c) => c.trim()).filter(Boolean);
  if (clauses.length > LIMITS.maxPlanActions) return { kind: 'clarification', message: `A plan can contain at most ${LIMITS.maxPlanActions} actions. Split this into smaller requests.` };
  const resolved: { action: Action; label: string; auto: boolean }[] = [];
  for (const [i, clause] of clauses.entries()) {
    const result = /^(?:open|launch|start|run)\b/.test(clause) ? targetClause(clause, ctx) : volumeClause(clause, ctx);
    if (result === null) {
      // A single unrecognised clause is ordinary conversation; inside a multi-step plan it needs clarification.
      if (clauses.length === 1) return { kind: 'not_command' };
      return { kind: 'clarification', message: `Step ${i + 1} (“${clause}”) is not one of the supported computer actions. Supported: open an approved app, website, folder or Shortcut, or set the volume to an exact percentage. Nothing was run.` };
    }
    if ('clarification' in result) return { kind: 'clarification', message: clauses.length > 1 ? `Step ${i + 1}: ${result.clarification}` : result.clarification };
    resolved.push(result);
  }
  return { kind: 'plan', actions: resolved.map((r) => r.action), labels: resolved.map((r) => r.label), autoEligible: resolved.every((r) => r.auto) };
}
