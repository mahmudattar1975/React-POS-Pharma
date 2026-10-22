import { test, expect } from '@playwright/test';

// Single-batch item (see pos-sale.spec.ts's comment on why that matters for a simple flow).
const AMOXICILLIN_BARCODE = '6281007320021';

test.describe('sales returns', () => {
  test('a completed sale can be found and fully returned', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(AMOXICILLIN_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Complete Sale' }).click();

    const titleText = await page.getByText(/^Invoice /).innerText();
    const invoiceNo = titleText.replace('Invoice', '').trim().split(/\s/)[0];
    expect(invoiceNo).toMatch(/^(SIM|STD)-\d{6}$/);
    await page.getByRole('button', { name: 'New Sale' }).click();

    await page.goto('/returns');
    await page.getByLabel('Invoice No.').fill(invoiceNo);
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('Return Qty')).toBeVisible();

    await page.locator('input[type=number]').first().fill('1');
    await page.getByRole('button', { name: 'Process Return' }).click();
    await expect(page.getByText(/Refunded SAR 12\.00/)).toBeVisible();
  });

  test('an unknown invoice number shows an error, not a crash', async ({ page }) => {
    await page.goto('/returns');
    await page.getByLabel('Invoice No.').fill('NOPE-999999');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('No invoice found with that number.')).toBeVisible();
  });
});
