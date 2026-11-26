import { test, expect, dismissDirectionsIfShown } from './fixtures';

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
    await dismissDirectionsIfShown(page);
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

  test('fills partially, reuses the prescription on the next sale and shows both fills in the registry', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(TRAMADOL_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();

    // 2 prescribed with 1 refill authorises 4; the cart only takes 1, so the fill is partial.
    await page.getByLabel('Prescriber name').fill('Dr. Partial');
    await page.getByLabel('Prescription number').fill('RX-E2E-PARTIAL');
    await page.getByLabel(/Patient national ID/).fill('1001002004');
    await page.getByLabel(/^Quantity \(/).fill('2');
    await page.getByLabel('Refills').click();
    await page.getByRole('option', { name: '1 refill' }).click();
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await dismissDirectionsIfShown(page);
    await expect(page.getByText(/^Invoice /)).toBeVisible();

    // Second sale: the same prescription is found instead of captured again.
    await page.goto('/');
    await scan.fill(TRAMADOL_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Find existing prescription' }).click();
    await page.getByLabel(/Search prescription no/).fill('RX-E2E-PARTIAL');
    await page.getByText('RX-E2E-PARTIAL').click();
    await expect(page.getByText(/remaining 3 · refills left 1/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await dismissDirectionsIfShown(page);

    // Registry: one record, two fills, still partially dispensed.
    await page.goto('/prescriptions');
    await page.getByLabel('View RX-E2E-PARTIAL').click();
    await expect(page.getByText('Partially dispensed').first()).toBeVisible();
    await expect(page.getByText('Dispense history')).toBeVisible();
    await expect(page.getByText(/^(?:[A-Z0-9]+-)?SIM-\d{6}$/)).toHaveCount(2);
  });

  test('an expired prescription needs a written override before it can be dispensed', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(TRAMADOL_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();

    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Prescriber name').fill('Dr. Expired');
    await page.getByLabel('Prescription number').fill('RX-E2E-EXPIRED');
    await page.getByLabel(/Patient national ID/).fill('1001002005');
    await page.getByLabel('Prescription date').fill(sixtyDaysAgo);

    await expect(page.getByText(/This prescription expired on/)).toBeVisible();
    const continueBtn = page.getByRole('button', { name: 'Continue to Payment' });
    await expect(continueBtn).toBeDisabled();

    await page.getByLabel('Override reason (required)').fill('Prescriber confirmed by phone.');
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();
    await expect(page.getByRole('button', { name: 'Complete Sale' })).toBeVisible();
  });

  test('labels the dispensed box bilingually with the refills left, from the receipt and from the registry', async ({ page }) => {
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill(TRAMADOL_BARCODE);
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();

    // 2 prescribed with 1 refill authorises 4; one fill of 1 leaves one refill.
    await page.getByLabel('Prescriber name').fill('Dr. Label');
    await page.getByLabel('Prescription number').fill('RX-E2E-LABEL');
    await page.getByLabel(/Patient national ID/).fill('1001002006');
    await page.getByLabel(/^Quantity \(/).fill('2');
    await page.getByLabel('Refills').click();
    await page.getByRole('option', { name: '1 refill' }).click();

    // The sig is chosen from the DOS master linked to the item (dos-7: 1 capsule every 8 hours).
    const capture = page.getByRole('dialog', { name: 'Prescription Required' });
    await capture.getByRole('button', { name: 'Directions' }).click();
    await page.getByText('Use only when needed for pain').first().click();
    await expect(capture.getByText('every 8 hours')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await dismissDirectionsIfShown(page);

    // Straight from the receipt.
    await page.getByRole('button', { name: 'Rx label' }).click();
    const label = page.getByRole('dialog', { name: /Prescription label/ });
    await expect(label).toBeVisible();
    await expect(label.getByText('RX-E2E-LABEL', { exact: false }).first()).toBeVisible();
    await expect(label.getByText('Refills left: 1')).toBeVisible();
    await expect(label.getByText('مرات الصرف المتبقية: 1')).toBeVisible();
    await expect(label.getByText('كبسولة كل 8 ساعات')).toBeVisible();
    await expect(label.getByText(/Batch TR24L19/)).toBeVisible();
    await expect(label.getByText(/Qty 1 Strip/)).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // And again later from the registry, which is what a reprint looks like.
    await page.goto('/prescriptions');
    await page.getByLabel('View RX-E2E-LABEL').click();
    await page.getByRole('button', { name: 'Print labels' }).click();
    await expect(page.getByRole('dialog', { name: /Prescription label/ }).getByText('Refills left: 1')).toBeVisible();
  });
});
