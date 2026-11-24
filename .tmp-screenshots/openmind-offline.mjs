// Confirms the app degrades gracefully when the .NET backend is unreachable.
import { chromium } from 'playwright';
const USER = { fappl_type: 1, fappl_sub: 1, fuser_id: 7, fuser_name: 'demo', fuser_name_e: 'Demo', fprofile_id: 1, funit_id: 1, accessToken: 'mock-token' };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript((user) => {
  localStorage.setItem('openmind-auth', JSON.stringify({ state: { user, token: user.accessToken, errorMessages: [], loginDone: true }, version: 0 }));
}, USER);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto('http://localhost:5173/vendors');
await page.getByText('OpenMind is not reachable', { exact: false }).waitFor({ timeout: 20000 });
console.log('  ok [vendors] unreachable-backend warning shown');
await page.getByText('ARABIAN MEDICAL SUPPLIES').count().then((n) => console.log('  note: vendor rows rendered =', n));

await page.goto('http://localhost:5173/pharmacy/items');
await page.getByText('Item master read from OpenMind failed', { exact: false }).waitFor({ timeout: 20000 });
console.log('  ok [items] read-failure warning shown');
await page.getByText('Add Item').first().waitFor();
console.log('  ok [items] screen still renders');

await page.goto('http://localhost:5173/pharmacy/inventory');
await page.getByText('Stock read from OpenMind failed', { exact: false }).waitFor({ timeout: 20000 });
console.log('  ok [inventory] read-failure warning shown');

console.log(`PAGE ERRORS ${pageErrors.length}`);
for (const e of pageErrors) console.log(e);
await browser.close();
