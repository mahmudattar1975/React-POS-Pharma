import { test, expect } from '@playwright/test';

// Insulin Lantus has two seeded batches (22 and 6 units - see utils/seedData.ts), so scanning it
// shows the batch picker. Which one FEFO picks first isn't asserted here (it's the soonest-
// expiring, whichever quantity that happens to carry) - the test reads the real max off the qty
// input itself rather than assuming a specific batch's quantity.
const INSULIN_BARCODE = '6281007320038';

test.describe('insufficient quantity warning', () => {
  test('requesting more than what is in stock clamps the qty and warns the cashier', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(INSULIN_BARCODE);
    await scan.press('Enter');
    await page.waitForSelector('text=Multiple batches available');
    await page.locator('.MuiDialog-container .MuiListItemButton-root').first().click();

    const qtyInput = page.locator('input[type=number]').first();
    await expect(qtyInput).toHaveValue('1');
    const available = await qtyInput.getAttribute('max');
    expect(Number(available)).toBeGreaterThan(0);

    // Ask for way more than what's actually on hand in this batch.
    await qtyInput.fill('999');
    await qtyInput.blur();

    await expect(qtyInput).toHaveValue(available!);
    await expect(page.getByText(new RegExp(`Only ${available} in stock .* \\(requested 999\\)`))).toBeVisible();

    // This is a local seed item (not ERP-sourced), which has no real cross-branch data to check -
    // the action must not appear for it, only for real ERP items (see OtherBranchStockDialog.tsx).
    await expect(page.getByRole('button', { name: 'Check other branches' })).not.toBeVisible();
  });
});
