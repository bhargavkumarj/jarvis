// Written—not executed. Live services disabled; real browser/Auth/storage required later.
import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {localFixtures} from '../support/local-fixtures';
let fixtures:Awaited<ReturnType<typeof localFixtures>>;
test.beforeAll(async()=>{fixtures=await localFixtures();});test.afterAll(async()=>{await fixtures?.close();});
async function signIn(page:Page,who:'alex'|'sam'){
 await page.goto('/sign-in');await page.getByLabel('Email address').fill(fixtures.users[who].email);
 try{await page.getByLabel('Password',{exact:true}).fill(fixtures.users[who].password);}catch{throw new Error('Password field unavailable; credential suppressed.');}
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/assistant$/);
}
test('quick setup is short, optional and changes preferences without granting consent',async({page})=>{
 await signIn(page,'alex');await page.getByRole('link',{name:'Quick setup — optional'}).click();
 await page.getByLabel('Assistant name',{exact:true}).fill('Pip');await page.getByLabel('Communication style').selectOption('concise');await page.getByLabel('Timezone',{exact:true}).fill('Asia/Kolkata');
 await page.getByRole('button',{name:'Save preferences and continue'}).click();await expect(page).toHaveURL(/\/assistant$/);
 const prefs=await page.request.get('/api/v1/preferences');expect(prefs.ok()).toBe(true);const d=await prefs.json();expect(d.profile.assistant_name).toBe('Pip');expect(d.profile.onboarding_completed_at).toBeTruthy();
 const privacy=await page.request.get('/api/v1/privacy');expect((await privacy.json()).preferences).toMatchObject({text_cloud:false,notifications:false});
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('link',{name:'Revisit quick setup'}).click();await page.getByRole('button',{name:'Skip optional setup'}).click();await expect(page).toHaveURL(/\/assistant$/);
 await page.getByRole('button',{name:'Draft a memory request',exact:true}).click();await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Remember this: ');
 expect((await page.request.get('/api/v1/memories')).ok()).toBe(true);expect((await (await page.request.get('/api/v1/memories')).json()).proposals).toEqual([]);
 await page.setViewportSize({width:320,height:700});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>v.id)).toEqual([]);
});
test('sign-out stops an active stream; back navigation and user switching cannot restore its content',async({page})=>{
 await signIn(page,'alex');await page.getByLabel('Conversation provider').selectOption('mock');await page.getByLabel('Message',{exact:true}).fill('/mock slow');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('button',{name:'Stop response',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/sign-in/);expect((await page.request.get('/api/v1/conversations')).status()).toBe(401);
 await page.goBack();await expect(page).toHaveURL(/\/sign-in/);await signIn(page,'sam');await expect(page.getByRole('region',{name:'Transcript',exact:true})).not.toContainText('/mock slow');
});
