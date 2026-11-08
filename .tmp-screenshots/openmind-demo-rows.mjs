// Verifies the "remove packaged sample rows" path on Item Master and Inventory.
import { chromium } from 'playwright';

const USER = { fappl_type: 1, fappl_sub: 1, fuser_id: 7, fuser_name: 'demo', fuser_name_e: 'Demo', fprofile_id: 1, funit_id: 1, accessToken: 'mock-token' };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript((user) => {
  localStorage.setItem('openmind-auth', JSON.stringify({ state: { user, token: user.accessToken, errorMessages: [], loginDone: true }, version: 0 }));
}, USER);
const page = await context.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));

await page.goto('http://localhost:5173/pharmacy/items');
await page.getByText('PARACETAMOL 500MG TAB').waitFor();
// seed row is the only one with this exact display name
await page.getByText('Paracetamol 500mg (20 tabs)').waitFor();
const alert = page.getByText('packaged sample catalogue, not OpenMind data');
await alert.waitFor({ timeout: 15000 });
console.log('  ok [items] sample-rows notice shown with demo data present');

await page.getByRole('button', { name: /remove sample rows/i }).click();
await alert.waitFor({ state: 'detached', timeout: 15000 });
console.log('  ok [items] notice cleared after removing samples');
if (await page.getByText('Paracetamol 500mg (20 tabs)').count()) throw new Error('seed item still visible');
if (!(await page.getByText('PARACETAMOL 500MG TAB').count())) throw new Error('ERP item disappeared');
console.log('  ok [items] seed row gone, ERP row kept');

// reload: removal must persist
await page.reload();
await page.getByText('PARACETAMOL 500MG TAB').waitFor();
await page.waitForTimeout(800);
if (await page.getByText('packaged sample catalogue, not OpenMind data').count()) throw new Error('notice returned after reload');
if (await page.getByText('Paracetamol 500mg (20 tabs)').count()) throw new Error('seed item came back after reload');
console.log('  ok [items] removal persisted across reload');

await page.goto('http://localhost:5173/pharmacy/inventory');
await page.getByText('PARACETAMOL 500MG TAB').first().waitFor();
if (await page.getByText('packaged sample catalogue, not OpenMind stock', { exact: false }).count()) {
  throw new Error('inventory still reports demo batches after removal');
}
await page.locator('body').waitFor();
console.log('  ok [inventory] no demo batches remain');

console.log(`PROBLEMS ${problems.length}`);
for (const p of problems) console.log(p);
await browser.close();
