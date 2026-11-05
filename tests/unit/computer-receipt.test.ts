import { it, expect } from 'vitest';
import { receiptSentence, receiptLines } from '../../src/lib/computer/receipt';
import { EXPORT_FIELDS } from '../../src/lib/privacy/export';
import type { ActionResult } from '../../packages/computer-control-contracts/src/index.ts';

const base = { id: 'x', labels: ['Open website · YouTube (www.youtube.com)'], summary: null, created_at: '2026-11-05T10:00:00.000Z', finished_at: null, cancel_requested_at: null };
const r = (over: Partial<ActionResult>): ActionResult => ({ index: 0, type: 'open_website', state: 'succeeded', evidence: 'dispatched', code: 'url_dispatched', message: 'Sent to your default browser.', observedPercent: null, previousPercent: null, startedAt: null, finishedAt: null, ...over });

it('a dispatched website is never described as loaded', () => {
  const s = receiptSentence({ ...base, state: 'succeeded', results: [r({})] });
  expect(s).toContain('the end result was not observed');
  expect(s).not.toMatch(/\bloaded\b(?! was)/i);
});
it('unknown and cancelled outcomes stay explicit, with Stop limits stated while running', () => {
  expect(receiptSentence({ ...base, state: 'outcome_unknown', results: [r({ state: 'outcome_unknown', evidence: 'none', code: 'shortcut_timeout', message: 'Timed out.' })] })).toMatch(/Outcome unknown.*outcome unknown/);
  expect(receiptSentence({ ...base, state: 'running', results: [], cancel_requested_at: '2026-11-05T10:00:01.000Z' })).toContain('a step already in progress may still complete');
  expect(receiptLines({ ...base, state: 'expired', results: [] })[0]).toContain('no result reported');
});
it('export categories never include device credentials, tickets or hashes', () => {
  const fields = JSON.stringify([EXPORT_FIELDS.computer_devices, EXPORT_FIELDS.computer_actions]);
  expect(fields).not.toMatch(/hash|secret|ticket|credential|digest|bookmark|path/);
});
