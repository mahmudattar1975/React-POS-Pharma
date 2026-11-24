import { test, expect, dismissDirectionsIfShown } from './fixtures';

// Amoxicillin Syrup: 12.00 SAR, zero-rated (SFDA-registered medicine), and - importantly for this
// test - has only ONE seeded batch (see utils/seedData.ts), so scanning it adds straight to the
// cart without the "multiple batches available" picker a multi-batch item like Paracetamol shows.
const AMOXICILLIN_BARCODE = '6281007320021';

test.describe('core POS sale flow', () => {
  test('scan an item, pay cash, get a receipt', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel(/Scan barcode/)).toBeVisible();

    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(AMOXICILLIN_BARCODE);
    await scan.press('Enter');

    await expect(page.getByText('Amoxicillin Syrup')).toBeVisible();
    await expect(page.getByText('SAR 12.00', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByText('Payment', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await dismissDirectionsIfShown(page);

    await expect(page.getByText(/^Invoice /)).toBeVisible();
    const receiptText = await page.locator('#receipt-print-area').innerText();
    expect(receiptText).toContain('Amoxicillin');
    expect(receiptText).toContain('12.00');

    // Cart should be cleared and ready for the next sale after closing the receipt.
    await page.getByRole('button', { name: 'New Sale' }).click();
    await expect(page.getByText('Cart is empty')).toBeVisible();
  });

  test('scanning an unknown barcode shows a warning, not a crash', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill('0000000000000');
    await scan.press('Enter');
    await expect(page.getByText('Item not found for that barcode.')).toBeVisible();
  });

  // RSD's Pharmacy Sale is per pack, so the POS has to keep the DataMatrix identity until checkout
  // and refuse the same physical unit twice. The boundary marker (\x1d) between (10) and (21) is
  // what real scanners emit between variable-length AIs.
  test('a DataMatrix scan keeps the pack serial and refuses a duplicate', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    const unit = (serialNo: string) =>
      `010628100732002110AX24C09\x1d21${serialNo}`;

    await scan.fill(unit('SNE2E001'));
    await scan.press('Enter');
    await expect(page.getByText('Amoxicillin Syrup')).toBeVisible();
    await expect(page.getByText('RSD · 1 serial')).toBeVisible();

    await scan.fill(unit('SNE2E002'));
    await scan.press('Enter');
    await expect(page.getByText('RSD · 2 serials')).toBeVisible();

    await scan.fill(unit('SNE2E001'));
    await scan.press('Enter');
    await expect(page.getByText(/already in the basket/)).toBeVisible();
    await expect(page.getByText('RSD · 2 serials')).toBeVisible();

    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByText('Payment', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await dismissDirectionsIfShown(page);
    await expect(page.getByText(/^Invoice /)).toBeVisible();

    // The units are frozen on the recorded sale, which is what a later full return (the RSD
    // Pharmacy Sale Cancel) will report the cancellation against.
    const serials = await page.evaluate(() => {
      const persisted = JSON.parse(localStorage.getItem('pharmacy-sales') ?? '{}');
      const invoices = persisted?.state?.invoices ?? [];
      const invoice = invoices[invoices.length - 1];
      return invoice?.lines?.[0]?.serials ?? [];
    });
    expect(serials.map((s: { serialNo: string }) => s.serialNo)).toEqual(['SNE2E001', 'SNE2E002']);
  });
});
