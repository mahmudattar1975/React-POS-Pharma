import { test, expect } from '@playwright/test';

// Vitamin D3 1000IU: 22.00 SAR excl. VAT, standard-rated (15%) -> 25.30 incl. VAT - see
// utils/seedData.ts. One complete 15 SAR threshold is crossed, so a normal-tier customer earns
// exactly 150 points (POINTS_PER_THRESHOLD) - see utils/loyalty.ts.
const VITAMIN_D3_BARCODE = '6281007320045';
const TEST_PHONE = '0566001122';

async function selectCustomerByPhone(page: import('@playwright/test').Page, phone: string) {
  await page.getByLabel('Select customer').click();
  await page.getByLabel('Mobile number').fill(phone);
  await page.waitForTimeout(150); // live-filters as you type, not a network round-trip
}

test.describe('loyalty points', () => {
  test('a new customer earns points on a qualifying sale, then can redeem them', async ({ page }) => {
    await page.goto('/');

    // Create a brand-new customer via the phone-lookup flow.
    await selectCustomerByPhone(page, TEST_PHONE);
    await page.getByLabel('Name (English)').fill('E2E Test Customer');
    await page.getByRole('button', { name: 'Create & Use' }).click();
    await expect(page.getByLabel('Select customer')).toContainText('E2E Test Customer');

    // Sale 1: earn points.
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(VITAMIN_D3_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await expect(page.getByText(/^Invoice /)).toBeVisible();

    const receipt1 = await page.locator('#receipt-print-area').innerText();
    expect(receipt1).toMatch(/Points earned\s*\n?\s*\+150/);
    await page.getByRole('button', { name: 'New Sale' }).click();

    // Reselect the same customer - balance should now show 150 points.
    await selectCustomerByPhone(page, TEST_PHONE);
    await expect(page.getByText('E2E Test Customer')).toBeVisible();
    await page.getByText('E2E Test Customer').first().click();
    await expect(page.getByLabel('Select customer')).toContainText('150 pts');

    // Sale 2: redeem points as a tender.
    await scan.fill(VITAMIN_D3_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Points' }).click();
    await page.getByRole('button', { name: 'Add payment method' }).click();
    await expect(page.getByRole('button', { name: 'Complete Sale' })).toBeEnabled();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await expect(page.getByText(/^Invoice /)).toBeVisible();

    const receipt2 = await page.locator('#receipt-print-area').innerText();
    expect(receipt2).toMatch(/Points redeemed\s*\n?\s*-\d+/);
  });
});
