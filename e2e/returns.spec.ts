import { test, expect, dismissDirectionsIfShown } from './fixtures';
import type { Page } from '@playwright/test';

// Single-batch item (see pos-sale.spec.ts's comment on why that matters for a simple flow).
const AMOXICILLIN_BARCODE = '6281007320021';

async function sellOne(page: Page) {
  await page.goto('/');
  const scan = page.getByLabel(/Scan barcode/);
  await scan.fill(AMOXICILLIN_BARCODE);
  await scan.press('Enter');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Complete Sale' }).click();
  await dismissDirectionsIfShown(page);
}

test.describe('sales returns', () => {
  test('a completed sale can be found and fully returned', async ({ page }) => {
    await sellOne(page);

    const titleText = await page.getByText(/^Invoice /).innerText();
    const invoiceNo = titleText.replace('Invoice', '').trim().split(/\s/)[0];
    expect(invoiceNo).toMatch(/^(SIM|STD)-\d{6}$/);
    await page.getByRole('button', { name: 'New Sale' }).click();

    await page.goto('/returns');
    await page.getByLabel('Invoice No. / phone / customer').fill(invoiceNo);
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('Return Qty')).toBeVisible();

    await page.locator('input[type=number]').first().fill('1');
    await page.getByRole('button', { name: 'Process Return' }).click();
    await expect(page.getByText(/Refunded SAR 12\.00/)).toBeVisible();
  });

  test('an unknown invoice number shows an error, not a crash', async ({ page }) => {
    await page.goto('/returns');
    await page.getByLabel('Invoice No. / phone / customer').fill('NOPE-999999');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('No invoice found for that number, phone or customer.')).toBeVisible();
  });

  test('a walk-in sale can be found by the Walk-in Customer label', async ({ page }) => {
    await sellOne(page);
    await page.getByRole('button', { name: 'New Sale' }).click();

    await page.goto('/returns');
    await page.getByLabel('Invoice No. / phone / customer').fill('Walk-in Customer');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('Return Qty')).toBeVisible();
  });

  test('an invoice can be found by the customer phone number', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Select customer' }).click();
    await page.getByLabel('Mobile number').fill('0501234567');
    await page.getByText(/Ahmed Al-Otaibi/).click();

    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(AMOXICILLIN_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await dismissDirectionsIfShown(page);
    await page.getByRole('button', { name: 'New Sale' }).click();

    await page.goto('/returns');
    await page.getByLabel('Invoice No. / phone / customer').fill('0501234567');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('Return Qty')).toBeVisible();
    await expect(page.getByText(/Ahmed Al-Otaibi/)).toBeVisible();
  });

  test('a phone that matches several invoices lists them for the cashier to choose', async ({ page }) => {
    // Each sellOne starts with goto('/'), so the second sale opens on a fresh till while the
    // first invoice stays in the persisted sales store.
    await sellOne(page);
    await sellOne(page);

    await page.goto('/returns');
    await page.getByLabel('Invoice No. / phone / customer').fill('Walk-in Customer');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('2 matching invoices — choose the one to refund')).toBeVisible();

    // Picking one closes the list and opens that invoice's return form.
    await page.getByRole('button', { name: /Walk-in Customer/ }).first().click();
    await expect(page.getByText('Return Qty')).toBeVisible();
  });
});
