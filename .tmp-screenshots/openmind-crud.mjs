// Exercises the vendor edit path: create -> edit -> delete, against the mock .NET contract.
import { chromium } from 'playwright';

const USER = { fappl_type: 1, fappl_sub: 1, fuser_id: 7, fuser_name: 'demo', fuser_name_e: 'Demo', fprofile_id: 1, funit_id: 1, accessToken: 'mock-token' };
const AR = '\u0645\u0648\u0631\u062F \u062A\u062C\u0631\u064A\u0628\u064A';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript((user) => {
  localStorage.setItem('openmind-auth', JSON.stringify({ state: { user, token: user.accessToken, errorMessages: [], loginDone: true }, version: 0 }));
}, USER);
const page = await context.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
page.on('response', (r) => { if (r.url().includes('5000')) console.log(`  [net] ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });

await page.goto('http://localhost:5173/vendors');
await page.getByText('ARABIAN MEDICAL SUPPLIES').waitFor();

// create
await page.getByRole('button', { name: /add vendor/i }).click();
await page.getByLabel('Name (English)').fill('EDIT TEST CO');
await page.getByLabel(/Name \(Arabic/).fill(AR);
await page.getByRole('textbox', { name: 'Phone', exact: true }).fill('111');
await page.getByRole('button', { name: /create vendor/i }).click();
const row = page.locator('tr', { hasText: 'EDIT TEST CO' });
await row.waitFor();
console.log('created:', (await row.innerText()).replace(/\s+/g, ' ').slice(0, 120));

// edit: change phone + credit limit, confirm the row keeps everything else
await row.getByRole('button').first().click();
await page.getByRole('dialog').waitFor();
await page.getByRole('textbox', { name: 'Phone', exact: true }).fill('222333');
await page.getByLabel('Credit limit').fill('12345');
await page.getByRole('button', { name: /save changes/i }).click();
const edited = page.locator('tr', { hasText: 'EDIT TEST CO' });
await edited.getByText('222333').first().waitFor({ timeout: 15000 });
console.log('edited:', (await edited.innerText()).replace(/\s+/g, ' ').slice(0, 160));

// reopen to prove the server round-trip kept the Arabic name and the newly set limit
await edited.getByRole('button').first().click();
await page.getByRole('dialog').waitFor();
const arabicShown = await page.getByLabel(/Name \(Arabic/).inputValue();
const limitShown = await page.getByLabel('Credit limit').inputValue();
console.log('persisted Arabic name:', JSON.stringify(arabicShown));
console.log('persisted credit limit:', JSON.stringify(limitShown));
await page.getByRole('button', { name: /cancel/i }).click();

// delete
await edited.getByRole('button').nth(1).click();
await page.getByRole('dialog').last().getByRole('button', { name: /^delete vendor$/i }).click();
await edited.waitFor({ state: 'detached', timeout: 15000 });
console.log('deleted: row is gone');

console.log(`PROBLEMS ${problems.length}`);
for (const p of problems) console.log(p);
await browser.close();
