import { chromium } from 'playwright';
const USER = { fappl_type: 1, fappl_sub: 1, fuser_id: 7, fuser_name: 'demo', fuser_name_e: 'Demo', fprofile_id: 1, funit_id: 1, accessToken: 'mock-token' };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript((user) => {
  localStorage.setItem('openmind-auth', JSON.stringify({ state: { user, token: user.accessToken, errorMessages: [], loginDone: true }, version: 0 }));
}, USER);
const page = await context.newPage();
page.on('console', (m) => console.log(`[c.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/pharmacy/items');
await page.getByText('PARACETAMOL 500MG TAB').waitFor();
const dump = async (label) => {
  const rows = await page.locator('table tbody tr').allInnerTexts();
  console.log(`--- ${label}: ${rows.length} rows`);
  for (const r of rows) console.log('   ', r.replace(/\s+/g, ' ').slice(0, 110));
};
await dump('before');
await page.getByRole('button', { name: /remove sample rows/i }).click();
await page.waitForTimeout(1500);
await dump('after');
const cat = await page.evaluate(() => {
  const raw = localStorage.getItem('pharmacy-catalog');
  const p = JSON.parse(raw);
  return { removed: p.state.demoRowsRemoved, items: p.state.items.map((i) => i.id), batches: p.state.batches.map((b) => b.id) };
});
console.log('persisted:', JSON.stringify(cat));
await browser.close();
