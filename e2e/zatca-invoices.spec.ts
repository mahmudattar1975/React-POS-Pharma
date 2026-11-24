import { test, expect, dismissDirectionsIfShown } from './fixtures';

const AMOXICILLIN_BARCODE = '6281007320021';

// The ledger is fed by the local sales store, so a normal sale is enough - the ZATCA server may be
// down, which only changes the status chip, never whether the documents can be reprinted.
async function sellOne(page: import('@playwright/test').Page) {
  await page.goto('/');
  const scan = page.getByLabel(/Scan barcode/);
  await scan.fill(AMOXICILLIN_BARCODE);
  await scan.press('Enter');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Complete Sale' }).click();
  await dismissDirectionsIfShown(page);
  const title = await page.getByText(/^Invoice /).innerText();
  await page.getByRole('button', { name: 'New Sale' }).click();
  return title.replace('Invoice', '').trim().split(/\s/)[0];
}

test.describe('ZATCA sales invoices', () => {
  test('reprints the A4 invoice and the customer receipt from the ledger', async ({ page }) => {
    const invoiceNo = await sellOne(page);

    await page.goto('/sales-invoices');
    await expect(page.getByRole('tab', { name: 'ZATCA Sales Invoices' })).toHaveAttribute('aria-selected', 'true');

    const row = page.getByRole('row', { name: new RegExp(invoiceNo) });
    await expect(row).toBeVisible();

    // Customer copy: the 80mm till receipt, dismissible without starting a new sale.
    await row.getByRole('button', { name: 'Print Receipt' }).click();
    const receipt = page.getByRole('dialog');
    await expect(receipt).toContainText(`Invoice ${invoiceNo}`);
    await expect(receipt.getByRole('button', { name: 'Print receipt' })).toBeVisible();
    await receipt.getByRole('button', { name: 'Close' }).click();

    // Buyer copy: the A4 tax invoice.
    await row.getByRole('button', { name: 'Invoice', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Print A4' })).toBeVisible();

    // The customer copy is also one click away from inside A4 - no need to close it first.
    await page.getByRole('dialog').getByRole('button', { name: 'Print Receipt' }).click();
    const fromA4 = page.getByRole('dialog', { name: new RegExp(`Invoice ${invoiceNo}`) });
    await expect(fromA4).toBeVisible();
    await expect(fromA4.getByRole('button', { name: 'Print receipt' })).toBeVisible();
    await fromA4.getByRole('button', { name: 'Close' }).click();
  });
});
