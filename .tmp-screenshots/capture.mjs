// Captures the Wasfaty screens for the docs. Temporary helper - not part of the app or test suite.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'F:/SOURCE/React/Pharmacy-App/docs/wasfaty-screens';
await mkdir(OUT, { recursive: true });

const TEST_SESSION = {
  token: 'e2e-token',
  cashierId: 1,
  username: 'cashier',
  fullName: 'E2E Cashier',
  isAdmin: true,
};

const OPEN_SHIFT = {
  id: 1,
  cashierId: 1,
  openedAt: '2026-01-01T08:00:00.000Z',
  closedAt: null,
  openingFloat: 500,
  closingAmount: null,
  status: 1,
  commissionEarned: 0,
  totalSales: 0,
  totalReturns: 0,
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'en-US',
});

await context.addInitScript((session) => {
  localStorage.setItem('pharmacy-auth', JSON.stringify({ state: { session }, version: 0 }));
}, TEST_SESSION);

await context.route('http://localhost:5000/**', (route) => {
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
  const request = route.request();
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  if (request.url().includes('/Shift/Current')) return route.fulfill({ status: 200, headers, json: OPEN_SHIFT });
  if (request.url().includes('/Pos/Create')) {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
    return route.fulfill({ status: 200, headers, json: { id: 1, items } });
  }
  return route.fulfill({ status: 200, headers, json: {} });
});

const page = await context.newPage();

async function pageShot(name, options = {}) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, ...options });
  console.log(`saved ${file}`);
}

async function dialogShot(name) {
  const file = `${OUT}/${name}.png`;
  await page.locator('.MuiDialog-paper:visible').last().screenshot({ path: file });
  console.log(`saved ${file}`);
}

// The POS toast auto-hides after 4.5s. Let it go so it does not cover the totals in a screenshot.
async function waitForToastGone() {
  const snackbar = page.locator('.MuiSnackbar-root');
  if (await snackbar.isVisible()) {
    await snackbar.waitFor({ state: 'hidden', timeout: 9000 }).catch(() => undefined);
  }
}

async function startWasfaty(prescriptionNo) {
  await page.getByRole('button', { name: 'Start Wasfaty dispense' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Prescription No. (وصفة)').fill(prescriptionNo);
  await page.getByLabel('Patient National ID / Iqama').fill('1234567890');
  await page.getByLabel('Prescriber name').fill('Dr. Demo');
  await page.getByRole('button', { name: 'Start dispense' }).click();
  await page.getByText(/Wasfaty dispense in progress/).waitFor();
}

await page.goto('http://localhost:5173/');
await page.getByLabel(/Scan barcode/).waitFor();

// 01 - capture dialog
await page.getByRole('button', { name: 'Start Wasfaty dispense' }).click();
await page.getByRole('dialog').waitFor();
await page.getByLabel('Prescription No. (وصفة)').fill('RX-SCREEN-1001');
await page.getByLabel('Patient National ID / Iqama').fill('1234567890');
await page.getByLabel('Prescriber name').fill('Dr. Demo');
await page.waitForTimeout(300);
await dialogShot('01-wasfaty-capture-dialog');

await page.getByRole('button', { name: 'Start dispense' }).click();
await page.getByText(/Wasfaty dispense in progress/).waitFor();

const scan = page.getByLabel(/Scan barcode/);
await scan.fill('6281007320021');
await scan.press('Enter');
await page.getByText('Wasfaty · 6281007320021').waitFor();
await waitForToastGone();
await page.waitForTimeout(300);
await pageShot('02-pos-covered-basket');

// 03 - payment dialog, fully covered
await page.getByRole('button', { name: 'Checkout' }).click();
await page.getByText(/Fully covered by Wasfaty/).waitFor();
await page.waitForTimeout(300);
await dialogShot('03-payment-fully-covered');

// 04 - optional post-payment directions step
await page.getByRole('button', { name: 'Dispense & complete' }).click();
await page.getByText('Directions for this sale').waitFor();
await page.waitForTimeout(400);
await dialogShot('04-directions-step');

// 05 - receipt with the Wasfaty tender + Rx block
await page.getByRole('button', { name: 'Skip' }).click();
await page.getByText(/^Invoice /).waitFor();
await page.waitForTimeout(1200); // let the ZATCA QR render
await dialogShot('05-receipt-wasfaty');

await page.getByRole('button', { name: 'New Sale' }).click();

// 06 - claim report (local invoice rows + server ledger)
await page.goto('http://localhost:5173/wasfaty-claims');
await page.getByText('Wasfaty / NUPCO claims').waitFor();
await page.getByText('Amoxicillin').first().waitFor();
await page.waitForTimeout(900);
await pageShot('06-claims-report', { fullPage: true });

// 07 - NUPCO mapping workspace
await page.goto('http://localhost:5173/wasfaty-mapping');
await page.getByText('Wasfaty / NUPCO Mapping').waitFor();
await page.waitForTimeout(500);
await pageShot('07-nupco-mapping', { fullPage: true });

// 08 - settings connector panel
await page.goto('http://localhost:5173/settings');
const connectorHeading = page.getByText('Wasfaty / NUPCO connector');
await connectorHeading.waitFor();
await page.getByText('Provider: mock').waitFor();
await connectorHeading.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const connectorPanel = connectorHeading.locator('xpath=ancestor::div[contains(@class,"MuiPaper-root")][1]');
await connectorPanel.screenshot({ path: `${OUT}/08-wasfaty-settings.png` });
console.log(`saved ${OUT}/08-wasfaty-settings.png`);

// 09 + 10 - unmapped eligible item: banner and checkout guard
await page.goto('http://localhost:5173/');
await page.getByLabel(/Scan barcode/).waitFor();
await startWasfaty('RX-SCREEN-1002');
await scan.fill('6281007320045'); // Vitamin D3: eligible, no NUPCO code
await scan.press('Enter');
await page.getByText('Wasfaty · no NUPCO code').waitFor();
await waitForToastGone();
await page.waitForTimeout(300);
await pageShot('09-unmapped-item-banner');

await page.getByRole('button', { name: 'Checkout' }).click();
await page.getByText(/Map these items before dispensing/).waitFor();
await page.waitForTimeout(300);
await pageShot('10-unmapped-checkout-guard');

await browser.close();
