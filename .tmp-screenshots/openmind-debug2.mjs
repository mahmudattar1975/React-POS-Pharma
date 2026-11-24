import { chromium } from 'playwright';
const USER = { fappl_type: 1, fappl_sub: 1, fuser_id: 7, fuser_name: 'demo', fuser_name_e: 'Demo', fprofile_id: 1, funit_id: 1, accessToken: 'mock-token' };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript((user) => {
  localStorage.setItem('openmind-auth', JSON.stringify({ state: { user, token: user.accessToken, errorMessages: [], loginDone: true }, version: 0 }));
}, USER);
const page = await context.newPage();
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => console.log(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.url().includes('5000')) console.log(`[resp] ${r.status()} ${r.request().method()} ${r.url()}`); });

await page.goto('http://localhost:5173/vendors');
await page.getByText('ARABIAN MEDICAL SUPPLIES').waitFor();
await page.getByRole('button', { name: /add vendor/i }).click();
await page.getByLabel('Name (English)').fill('TEST SUPPLIER CO');
await page.getByRole('textbox', { name: 'Phone', exact: true }).fill('0555555555');
console.log('dialog text before save:', (await page.locator('.MuiDialog-paper').innerText()).slice(0, 400));
const btn = page.getByRole('button', { name: /create vendor/i });
console.log('disabled?', await btn.isDisabled());
await btn.click();
await page.waitForTimeout(2000);
console.log('dialog count after save:', await page.locator('.MuiDialog-paper').count());
console.log('body has TEST?', (await page.locator('body').innerText()).includes('TEST SUPPLIER CO'));
console.log((await page.locator('body').innerText()).slice(0, 1200));
await page.screenshot({ path: 'C:/Users/User/AppData/Local/Temp/opencode/openmind-mock/shots/debug-vendor.png' });
await browser.close();
