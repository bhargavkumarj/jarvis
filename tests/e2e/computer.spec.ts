// Real browser + local Auth/storage, mock providers. No extension or native companion is
// installed in this browser, so these prove the web states, not native execution.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { localFixtures } from '../support/local-fixtures';
import { browserOrigin } from '../support/browser-origin';

let fixtures: Awaited<ReturnType<typeof localFixtures>>;
test.beforeAll(async () => { fixtures = await localFixtures(); });
test.afterAll(async () => { await fixtures?.close(); });
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
async function signIn(page: Page, who: 'alex' | 'sam') {
  await page.goto('/sign-in'); await page.getByLabel('Email address').fill(fixtures.users[who].email);
  try { await page.getByLabel('Password', { exact: true }).fill(fixtures.users[who].password); } catch { throw new Error('Password field unavailable; credential suppressed.'); }
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page).toHaveURL(/\/assistant$/);
}
async function enable(page: Page) {
  await page.goto('/settings#computer');
  const section = page.getByRole('region', { name: 'Computer' });
  await expect(section.getByRole('button', { name: 'Turn on computer control' })).toBeDisabled();
  await section.getByLabel('I have read this and want computer control for this account.').check();
  await section.getByRole('button', { name: 'Turn on computer control' }).click();
  await expect(section.getByRole('button', { name: 'Turn off for this account' })).toBeVisible();
  return section;
}
/** Pairs a synthetic device through the real routes/RPCs (as a companion would), without a browser extension. */
async function pairSyntheticMac(page: Page) {
  const r = await page.request.post('/api/v1/computer/pairings', { headers: { Origin: browserOrigin, 'Content-Type': 'application/json' }, data: { extension_id: 'fomkddjghmfjocinjmbdagahcbilimof' } });
  expect(r.ok()).toBe(true);
  const { pairing_id, code } = await r.json();
  const anon = createClient(fixtures.status.API_URL, fixtures.status.ANON_KEY, { auth: { persistSession: false } });
  const secret = randomBytes(32).toString('base64url');
  const done = await anon.rpc('computer_pairing_complete_v1', { p_pairing: pairing_id, p_code: code, p_extension: 'fomkddjghmfjocinjmbdagahcbilimof', p_name: 'Synthetic Mac', p_credential_hash: sha(secret) });
  expect(done.error).toBeNull();
  const sync = await anon.rpc('computer_device_sync_v1', { p_device: done.data.device_id, p_secret: secret, p_sync: { protocolVersion: 1, hostVersion: 'test', disabled: false, enabledActions: ['open_application', 'set_volume'], volumeAuto: false, catalogue: [{ kind: 'application', alias: 'safari', label: 'Safari', names: [], detail: null, auto: false }] } });
  expect(sync.error).toBeNull();
}

test('Settings → Computer is off by default, needs explicit consent and shows honest bridge states accessibly', async ({ page }) => {
  await signIn(page, 'alex');
  const section = await enable(page);
  await expect(section).toContainText('Browser extension: not detected in this Chrome profile');
  await expect(section).toContainText('Load unpacked');
  await expect(section).toContainText('Safari or Firefox');
  expect((await new AxeBuilder({ page }).include('#computer').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map((v) => v.id)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.getByRole('button', { name: 'Turn off for this account' }).click();
  await expect(section.getByRole('button', { name: 'Turn on computer control' })).toBeVisible();
});

test('Assistant: commands resolve only against the paired Mac, ambiguity/relative volume ask, temporary chat refuses, chat is unchanged', async ({ page }) => {
  await signIn(page, 'sam');
  await enable(page);
  await page.goto('/assistant');
  await page.getByLabel('Conversation provider').selectOption('mock');
  // Without a paired Mac, everything stays ordinary conversation.
  await page.getByLabel('Message', { exact: true }).fill('Open Safari');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText('deterministic mock');
  await pairSyntheticMac(page);
  await page.reload();
  await page.getByLabel('Conversation provider').selectOption('mock');
  await expect(page.getByText('Computer control is on (no connected paired Mac)')).toBeVisible();
  const send = async (text: string) => { await page.getByLabel('Message', { exact: true }).fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click(); };
  await send('Open Safari');
  const card = page.getByRole('region', { name: 'Computer action on this Mac' }).last();
  await expect(card).toContainText('Open application · Safari');
  await expect(card).toContainText('Proposed · waiting for your review');
  await expect(card.getByRole('button', { name: 'Send to this Mac for approval' })).toBeDisabled();
  await expect(card).toContainText('not connected');
  await card.getByRole('button', { name: 'Discard' }).click();
  await expect(card).toContainText('Cancelled');
  await send('Turn it down a bit');
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText('exact level');
  await send('Open Photoshop');
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText('not an approved');
  await send('yes');
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText('You wrote “yes”');
  await page.getByRole('button', { name: 'Temporary conversation' }).click();
  await send('Open Safari');
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText('not available in temporary chat');
  const history = await (await page.request.get('/api/v1/computer')).json();
  expect(history.commands.map((c: { state: string }) => c.state)).toEqual(['cancelled']);
  void randomUUID;
});
