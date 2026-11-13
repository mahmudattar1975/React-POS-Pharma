import { test, expect } from './fixtures';

// The Purchase Returns tab posts a credit note against a received delivery and puts the stock
// back. It reuses the same party table as purchases, so a return can be for a vendor or a
// business customer, and it links to the original purchase document.
test.describe('purchase returns', () => {
  test('posts a return against a purchase and restores the stock', async ({ page }) => {
    // 1. Receive 10 units so there is a real delivery to return.
    await page.goto('/purchases');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel("Vendor's invoice no").fill('RTN-PUR-2026-001');

    await page.getByLabel('Item (name or scroll)').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
    await page.getByLabel('Qty (paid)').fill('10');
    await page.getByLabel('Batch / Lot No.').fill('RTN26A01');
    await page.getByLabel('Expiry Date').fill('2028-06-30');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('3.5');
    await page.getByRole('button', { name: 'Add line to invoice' }).click();
    await page.getByRole('button', { name: /Receive into stock/ }).click();
    await expect(page.getByText(/received from Al-Hayat/)).toBeVisible();

    // The batch starts at 10 on hand.
    await page.goto('/inventory');
    await page.getByLabel('Scan barcode or type item name / SKU').fill('Paracetamol');
    const batchRow = () => page.getByRole('row', { name: /RTN26A01/ });
    await expect(batchRow().getByRole('cell').nth(3)).toHaveText('10');

    // 2. Post the return from the new tab, linked to the purchase just received.
    await page.goto('/purchase-returns');
    await expect(page.getByRole('tab', { name: /Purchase Returns/ })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel('Link to original invoice').fill('RTN-PUR-2026-001');
    await page.getByRole('option', { name: /RTN-PUR-2026-001/ }).click();

    await page.getByLabel('Return No').fill('CN-2026-001');
    await expect(page.getByRole('row', { name: /Paracetamol 500mg/ })).toContainText('10');
    await page.getByRole('button', { name: 'Post Return' }).click();

    await expect(page.getByText(/Return CN-2026-001 recorded/)).toBeVisible();
    const returnRow = page.getByRole('row', { name: /CN-2026-001/ });
    await expect(returnRow).toContainText('RTN-PUR-2026-001');
    await expect(returnRow).toContainText('35.00');

    // 3. The returned units are gone from stock again.
    await page.goto('/inventory');
    await page.getByLabel('Scan barcode or type item name / SKU').fill('Paracetamol');
    await expect(batchRow().getByRole('cell').nth(3)).toHaveText('0');

    // 4. The return is not listed as a purchase invoice (editing/deleting it there would move
    //    stock the wrong way).
    await page.goto('/purchases');
    await expect(page.getByRole('row', { name: /CN-2026-001/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /RTN-PUR-2026-001/ })).toBeVisible();
  });
});
