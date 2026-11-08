import { chromium } from 'playwright';

const USER = {
  fappl_type: 1, fappl_sub: 1, fuser_id: 7, fuser_name: 'demo', fuser_name_e: 'Demo',
  fprofile_id: 1, funit_id: 1, accessToken: 'mock-token',
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript((user) => {
  localStorage.setItem('openmind-auth', JSON.stringify({
    state: { user, token: user.accessToken, errorMessages: [], loginDone: true },
    version: 0,
  }));
}, USER);
const page = await context.newPage();
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/home');
await page.waitForTimeout(2500);
console.log('URL:', page.url());
console.log('BODY:', (await page.locator('body').innerText()).slice(0, 800));
console.log('AUTH:', await page.evaluate(() => localStorage.getItem('openmind-auth')?.slice(0, 200)));
await page.screenshot({ path: 'C:/Users/User/AppData/Local/Temp/opencode/openmind-mock/shots/debug.png' });
await browser.close();
