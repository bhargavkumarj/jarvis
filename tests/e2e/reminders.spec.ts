import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {localFixtures} from '../support/local-fixtures';
import {browserOrigin} from '../support/browser-origin';
let f:Awaited<ReturnType<typeof localFixtures>>;
test.beforeAll(async()=>{f=await localFixtures();});test.afterAll(async()=>{await f?.close();});
async function login(page:Page,name:'alex'|'sam'='alex'){
 await page.goto('/sign-in');await page.getByLabel('Email address').fill(f.users[name].email);
 try{await page.getByLabel('Password',{exact:true}).fill(f.users[name].password);}catch{throw new Error('Credential field unavailable; value suppressed.');}
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/assistant$/);
}
test('manual review requires exact confirmation; persisted reminder, receipts and owner-scoped cancellation are honest and accessible',async({page,browser})=>{
 const errors:string[]=[];page.on('pageerror',()=>errors.push('runtime error'));await login(page);
 await page.getByRole('link',{name:'Today',exact:true}).click();await expect(page.getByRole('status')).toContainText('Only confirmed');
 await page.getByLabel('Reminder title',{exact:true}).fill('Synthetic browser reminder');
 const local=new Date(Date.now()+3600_000).toISOString().slice(0,19);
 await page.getByLabel('Local date and time',{exact:true}).fill(local);await page.getByLabel('Reminder timezone',{exact:true}).fill('UTC');
 await page.getByRole('button',{name:'Review exact schedule',exact:true}).click();
 const review=page.getByRole('region',{name:'Exact reminder review'});await expect(review).toContainText('UTC');await expect(review).toContainText('Confirming saves');
 // Editing invalidates the currently displayed confirmation.
 await page.getByLabel('Reminder title',{exact:true}).fill('Edited synthetic browser reminder');await expect(review).toHaveCount(0);
 await page.getByRole('button',{name:'Review exact schedule',exact:true}).click();await expect(review).toContainText('Edited synthetic');
 await review.getByRole('button',{name:'Confirm exact reminder',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saved — scheduling pending');
 await page.reload();const article=page.getByRole('article',{name:'Reminder: Edited synthetic browser reminder'});await expect(article).toBeVisible();await expect(article).not.toContainText('Simulated acceptance');
 await article.getByRole('button',{name:'Inspect attempts',exact:true}).click();await expect(page.getByRole('region',{name:'Reminder attempt history'})).toContainText('No dispatch attempt recorded');
 const response=await page.request.get('/api/v1/reminders');const saved=(await response.json()).reminders.find((r:{title:string})=>r.title==='Edited synthetic browser reminder');
 const other=await browser.newContext();const bp=await other.newPage();await login(bp,'sam');
 expect((await other.request.get(`${browserOrigin}/api/v1/reminders?id=${saved.id}`)).status()).toBe(404);
 expect((await other.request.get(`${browserOrigin}/api/v1/reminders/operations/${saved.confirm_operation_id}`)).status()).toBe(404);
 expect((await other.request.post(`${browserOrigin}/api/v1/reminders`,{headers:{Origin:browserOrigin},data:{action:'cancel',request_id:crypto.randomUUID(),id:saved.id,version:saved.version}})).status()).toBe(404);
 await other.close();
 await article.getByRole('button',{name:'Cancel reminder',exact:true}).click();await expect(article).toContainText('Cancelled');
 const rejected=await page.request.post('/api/v1/reminders',{headers:{Origin:'https://untrusted.example'},data:{action:'cancel',request_id:crypto.randomUUID(),id:saved.id,version:saved.version}});expect(rejected.status()).toBe(403);
 expect(response.headers()['cache-control']).toContain('no-store');
 await page.setViewportSize({width:320,height:700});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('Reminder title',{exact:true}).focus();await expect(page.getByLabel('Reminder title',{exact:true})).toBeFocused();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>v.id)).toEqual([]);expect(errors).toEqual([]);
});
test('mock command creates a review-only receipt, while temporary mode creates no reminder or operation',async({page})=>{
 await login(page);
 const send=async(text:string,temporary=false)=>{await page.getByLabel('Message',{exact:true}).fill(text);await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('status')).toContainText(temporary?'Temporary response complete':/Response saved|Response confirmed complete/);};
 const local=new Date(Date.now()+7200_000).toISOString().slice(0,19);
 await send(`/remind ${local} UTC | Synthetic chat reminder`);await expect(page.getByRole('region',{name:'Transcript'})).toContainText('Mock command receipt: draft');
 const before=await page.request.get('/api/v1/reminders');const rows=(await before.json()).reminders;
 expect(rows.find((r:{title:string})=>r.title==='Synthetic chat reminder').state).toBe('draft');
 const [{n:beforeOps}]=await f.sql`select count(*)::integer n from public.reminder_operations where owner_id=(select id from auth.users where email=${f.users.alex.email})`;
 // Existing temporary-mode control is explicit and volatile.
 await page.getByRole('button',{name:'Temporary conversation',exact:true}).click();
 await send(`/remind ${local} UTC | Volatile reminder fixture`,true);
 await expect(page.getByRole('region',{name:'Transcript'})).toContainText('Temporary mode cannot save reminders');
 const after=await page.request.get('/api/v1/reminders');expect((await after.json()).reminders).toHaveLength(rows.length);
 const [{n:afterOps}]=await f.sql`select count(*)::integer n from public.reminder_operations where owner_id=(select id from auth.users where email=${f.users.alex.email})`;expect(afterOps).toBe(beforeOps);
 await page.reload();await expect(page.getByText('Volatile reminder fixture',{exact:false})).toHaveCount(0);
 // Drop a completed server response before the browser sees it: a committed
 // review must stay inspectable, and retry must not duplicate its operation.
 let release!:()=>void;let committed=false;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const handler=async(route:import('@playwright/test').Route)=>{const response=await route.fetch();committed=true;await held;try{await route.fulfill({response});}catch{/* Browser cancellation may close the route. */}};
 await page.route('**/api/v1/turns',handler);
 await page.getByLabel('Message',{exact:true}).fill(`/remind ${local} UTC | Interrupted receipt fixture`);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>committed).toBe(true);
 await page.getByRole('button',{name:'Stop response',exact:true}).click();
 await expect(page.locator('.error-message')).toContainText('draft may already exist in Today');
 release();await page.unroute('**/api/v1/turns',handler);
 await page.getByRole('button',{name:'Retry last request',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Response confirmed complete');
 const replay=await page.request.get('/api/v1/reminders');
 expect((await replay.json()).reminders.filter((r:{title:string})=>r.title==='Interrupted receipt fixture')).toHaveLength(1);

});
// New recurrence UI checks: written—not executed while browser/runtime work is deferred.
test('recurring exact preview, occurrence-only snooze, pause/resume and cancellation preserve history',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Today',exact:true}).click();
 const errors:string[]=[];page.on('pageerror',()=>errors.push('runtime error'));
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
 await page.getByLabel('Series title',{exact:true}).fill('Synthetic browser series');await page.getByLabel('Start date',{exact:true}).fill(tomorrow);
 await page.getByLabel('Recurring local time',{exact:true}).fill('20:00');await page.getByLabel('Fixed series timezone',{exact:true}).fill('UTC');
 await page.getByRole('button',{name:'Preview recurring schedule',exact:true}).click();const review=page.getByRole('region',{name:'Exact recurring schedule review'});
 await expect(review).toBeFocused();await expect(review.getByRole('listitem')).toHaveCount(3);await expect(review).toContainText('UTC offset +00:00');
 const old=(await (await page.request.get('/api/v1/reminder-series')).json()).series.find((s:{schedule:{title:string}})=>s.schedule.title==='Synthetic browser series');
 await page.getByLabel('Recurring local time',{exact:true}).fill('21:00');await expect(review).toHaveCount(0);await page.getByRole('button',{name:'Preview recurring schedule',exact:true}).click();
 expect((await page.request.post('/api/v1/reminder-series',{headers:{Origin:browserOrigin},data:{action:'confirm',request_id:crypto.randomUUID(),id:old.id,version:old.version,review_version:old.review_version,review:old.review}})).status()).toBe(409);
 await review.getByRole('button',{name:'Confirm exact recurring schedule',exact:true}).click();await expect(page.getByText(/Series confirmed; scheduling requested/)).toBeVisible();
 const series=page.getByRole('article',{name:'Series: Synthetic browser series'});await expect(series).toContainText('Daily at 21:00');
 const occurrence=page.getByRole('article',{name:'Reminder: Synthetic browser series'});await occurrence.getByRole('button',{name:'Snooze 10 minutes',exact:true}).click();
 const snoozeReview=occurrence.getByLabel('Snooze review',{exact:true});await expect(snoozeReview).toContainText('21:10:00');expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>v.id)).toEqual([]);await snoozeReview.getByRole('button',{name:'Confirm this snooze',exact:true}).click();await expect(occurrence).toContainText('21:10:00');await expect(series).toContainText('Daily at 21:00');
 await series.getByRole('button',{name:'Skip next occurrence',exact:true}).click();await expect(occurrence).toContainText('Skipped occurrence');
 await series.getByRole('button',{name:'Pause series',exact:true}).click();await expect(series).toContainText('Paused');await series.getByRole('button',{name:'Resume series',exact:true}).click();await expect(series.getByRole('button',{name:'Pause series',exact:true})).toBeVisible();
 await series.getByRole('button',{name:'Cancel entire series',exact:true}).click();await expect(series).toContainText('cancelled');
 const rows=(await (await page.request.get('/api/v1/reminders')).json()).reminders.filter((r:{series_id:string})=>r.series_id===old.id);expect(rows).toHaveLength(2);expect(rows.map((r:{state:string})=>r.state).sort()).toEqual(['cancelled','skipped']);
 await page.setViewportSize({width:320,height:700});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>v.id)).toEqual([]);expect(errors).toEqual([]);
});
test('temporary natural recurring request creates no series or operation',async({page})=>{
 await login(page);const before=(await (await page.request.get('/api/v1/reminder-series')).json()).series.length;
 const [{n:beforeOps}]=await f.sql`select count(*)::int n from public.series_operations where owner_id=(select id from auth.users where email=${f.users.alex.email})`;
 await page.getByRole('button',{name:'Temporary conversation',exact:true}).click();await page.getByLabel('Message',{exact:true}).fill('Remind me every weekday at 8 PM to study starting '+new Date(Date.now()+86400000).toISOString().slice(0,10));await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('status')).toContainText('Temporary response complete');
 await expect(page.getByRole('region',{name:'Transcript'})).toContainText('Temporary mode cannot save reminders');expect((await (await page.request.get('/api/v1/reminder-series')).json()).series).toHaveLength(before);
 const [{n}]=await f.sql`select count(*)::int n from public.series_operations where owner_id=(select id from auth.users where email=${f.users.alex.email})`;expect(n).toBe(beforeOps);
});
