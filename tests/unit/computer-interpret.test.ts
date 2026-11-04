import { describe, it, expect } from 'vitest';
import { interpret, type InterpretContext } from '../../src/lib/computer/interpret';
import { ACTION_TYPES, type CatalogueEntry } from '../../packages/computer-control-contracts/src/index.ts';

const catalogue: CatalogueEntry[] = [
  { kind: 'application', alias: 'safari', label: 'Safari', names: [], detail: null, auto: true },
  { kind: 'application', alias: 'vs-code', label: 'Visual Studio Code', names: ['vs code', 'vscode'], detail: null, auto: false },
  { kind: 'website', alias: 'youtube', label: 'YouTube', names: [], detail: 'www.youtube.com', auto: false },
  { kind: 'folder', alias: 'jarvis-project', label: 'Jarvis project', names: ['jarvis project folder'], detail: null, auto: false },
  { kind: 'folder', alias: 'thesis-project', label: 'Thesis project', names: [], detail: null, auto: false },
  { kind: 'shortcut', alias: 'study-setup', label: 'Study Setup', names: [], detail: null, auto: false },
];
const ctx: InterpretContext = { catalogue, enabledActions: [...ACTION_TYPES], volumeAuto: true };

describe('mapping for all five action types', () => {
  it.each([
    ['Open Safari', [{ type: 'open_application', alias: 'safari' }]],
    ['Open VS Code.', [{ type: 'open_application', alias: 'vs-code' }]],
    ['please launch vscode', [{ type: 'open_application', alias: 'vs-code' }]],
    ['Open YouTube', [{ type: 'open_website', alias: 'youtube' }]],
    ['Set the volume to 30 percent', [{ type: 'set_volume', percent: 30 }]],
    ['volume 45%', [{ type: 'set_volume', percent: 45 }]],
    ['Mute', [{ type: 'set_volume', percent: 0 }]],
    ['Open my Jarvis project folder', [{ type: 'open_folder', alias: 'jarvis-project' }]],
    ['Run my study setup', [{ type: 'run_shortcut', alias: 'study-setup' }]],
    ['Can you open Safari?', [{ type: 'open_application', alias: 'safari' }]],
  ])('%s', (text, actions) => {
    const r = interpret(text, ctx);
    expect(r.kind).toBe('plan');
    if (r.kind === 'plan') expect(r.actions).toEqual(actions);
  });
  it('builds an explicit ordered two-step plan', () => {
    const r = interpret('Open Safari and set volume to 30', ctx);
    expect(r).toMatchObject({ kind: 'plan', actions: [{ type: 'open_application', alias: 'safari' }, { type: 'set_volume', percent: 30 }] });
    if (r.kind === 'plan') expect(r.labels).toEqual(['Open application · Safari', 'Set output volume · 30%']);
  });
  it('bounds plans at five actions', () => {
    expect(interpret('open safari, open youtube, open vs code, mute, open safari then open youtube', ctx)).toMatchObject({ kind: 'clarification', message: expect.stringContaining('at most 5') });
  });
  it('labels a website with its approved host only', () => {
    const r = interpret('open youtube', ctx);
    if (r.kind === 'plan') expect(r.labels[0]).toBe('Open website · YouTube (www.youtube.com)');
  });
});

describe('ambiguity, unsupported and safety boundaries', () => {
  it('does not resolve an unapproved app, and never fuzzy-launches', () => {
    const r = interpret('Open Photoshop', ctx);
    expect(r).toMatchObject({ kind: 'clarification', message: expect.stringContaining('not an approved') });
    expect(interpret('Open Saf', ctx)).toMatchObject({ kind: 'clarification' });
  });
  it('asks which one when several approved aliases match', () => {
    const r = interpret('Open my project', ctx);
    expect(r).toMatchObject({ kind: 'clarification', message: expect.stringMatching(/Jarvis project.*Thesis project/) });
  });
  it('requires an absolute percentage', () => {
    for (const t of ['Turn it down a bit', 'volume up', 'make it louder', 'increase the volume by 10', 'unmute']) expect(interpret(t, ctx)).toMatchObject({ kind: 'clarification', message: expect.stringContaining('exact level') });
    expect(interpret('set volume to 150', ctx)).toMatchObject({ kind: 'clarification', message: expect.stringContaining('0 to 100') });
  });
  it('ordinary conversation and the bare confirmation words never become actions', () => {
    for (const t of ['yes', 'Yes, do it', 'ok', 'What is the volume of a sphere?', 'Remind me tomorrow at 7 PM to call Sam', 'Set a reminder for 5pm', 'Add a task to finish my assignment', 'Start a new conversation about physics', 'Run me through how photosynthesis works', 'Remember this: I like tea'])
      expect(interpret(t, ctx).kind).toBe('not_command');
  });
  it('shell-like or path text is not an action and cannot reach an executor', () => {
    expect(interpret('run rm -rf ~', ctx).kind).not.toBe('plan');
    expect(interpret('open /etc/passwd', ctx).kind).not.toBe('plan');
    expect(interpret('open https://evil.example', ctx).kind).not.toBe('plan');
    expect(interpret('open safari; open /Applications/Terminal.app', ctx).kind).not.toBe('plan');
  });
  it('respects action types disabled in the companion', () => {
    const limited = { ...ctx, enabledActions: ['open_application' as const] };
    expect(interpret('Run my study setup', limited).kind).not.toBe('plan');
    expect(interpret('set volume to 20', limited)).toMatchObject({ kind: 'clarification', message: expect.stringContaining('turned off') });
  });
  it('a failing step in a plan yields clarification for the whole plan (nothing partially proposed)', () => {
    expect(interpret('Open Safari and open Photoshop', ctx)).toMatchObject({ kind: 'clarification', message: expect.stringContaining('Step 2') });
  });
  it('Shortcuts are never auto-eligible; auto requires every step to be allowed locally', () => {
    expect(interpret('Open Safari', ctx)).toMatchObject({ autoEligible: true });
    expect(interpret('Open Safari and open YouTube', ctx)).toMatchObject({ autoEligible: false });
    const allAuto = { ...ctx, catalogue: catalogue.map((e) => ({ ...e, auto: e.kind !== 'shortcut' })) };
    expect(interpret('Run my study setup', allAuto)).toMatchObject({ autoEligible: false });
  });
});
