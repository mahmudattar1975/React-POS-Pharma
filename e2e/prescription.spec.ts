import { test, expect } from '@playwright/test';

// Tramadol 50mg: pre-flagged controlledStatus='schedule_a' in utils/seedData.ts specifically so
// this flow is testable without any manual setup on the Inventory page first.
const TRAMADOL_BARCODE = '6281007320083';

test.describe('prescription / controlled-substance gate', () => {
  test('checkout is blocked until prescriber + patient info is captured', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(TRAMADOL_BARCODE);
    await scan.press('Enter');
    await expect(page.getByText('Tramadol 50mg')).toBeVisible();

    await page.getByRole('button', { name: 'Checkout' }).click();

    // Payment must NOT be reachable yet - the prescription dialog intercepts first. Checking for
    // the "Complete Sale" button specifically (not the word "Payment", which also appears inside
    // this dialog's own "Continue to Payment" button text).
    await expect(page.getByText('Prescription Required')).toBeVisible();
    await expect(page.getByText('Schedule A (Narcotic)', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Complete Sale' })).not.toBeVisible();

    const continueBtn = page.getByRole('button', { name: 'Continue to Payment' });
    await expect(continueBtn).toBeDisabled();

    await page.getByLabel('Prescriber name').fill('Dr. Test Prescriber');
    await page.getByLabel('Prescription number').fill('RX-E2E-001');
    await page.getByLabel(/Patient national ID/).fill('1001002003');
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    await expect(page.getByRole('button', { name: 'Complete Sale' })).toBeVisible();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await expect(page.getByText(/^Invoice /)).toBeVisible();

    const receipt = await page.locator('#receipt-print-area').innerText();
    expect(receipt).toContain('℞');
    expect(receipt).toContain('RX-E2E-001');
    expect(receipt).toContain('1001002003');
  });

  test('a non-controlled item never shows the prescription gate', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill('6281007320021'); // Amoxicillin - no controlledStatus, single batch
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByRole('button', { name: 'Complete Sale' })).toBeVisible();
    await expect(page.getByText('Prescription Required')).not.toBeVisible();
  });
});
