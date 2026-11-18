import { test, expect, dismissDirectionsIfShown } from './fixtures';
import type { Page } from '@playwright/test';

// The controlled register is written by the counter actions themselves, so this flow has to go
// through a real sale and a real return rather than seeding localStorage. Tramadol is
// schedule_a in the seed data and has a single batch (TR24L19, 25 on hand).
const TRAMADOL_BARCODE = '6281007320083';

async function sellControlled(page: Page): Promise<string> {
  await page.goto('/');
  const scan = page.getByLabel(/Scan barcode/);
  await scan.fill(TRAMADOL_BARCODE);
  await scan.press('Enter');
  await page.getByRole('button', { name: 'Checkout' }).click();

  await page.getByLabel('Prescriber name').fill('Dr. Register');
  await page.getByLabel('Prescription number').fill('RX-E2E-REGISTER');
  await page.getByLabel(/Patient national ID/).fill('1001002007');
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await page.getByRole('button', { name: 'Complete Sale' }).click();
  await dismissDirectionsIfShown(page);

  const titleText = await page.getByText(/^Invoice /).innerText();
  const invoiceNo = titleText.replace('Invoice', '').trim().split(/\s/)[0];
  expect(invoiceNo).toMatch(/^(SIM|STD)-\d{6}$/);
  await page.getByRole('button', { name: 'New Sale' }).click();
  return invoiceNo;
}

test.describe('controlled drug register', () => {
  // Sale + capture + return + register is five navigations plus two forms.
  test.describe.configure({ timeout: 90_000 });

  test('records a dispense and its return, keeping the balance equal to stock', async ({ page }) => {
    const invoiceNo = await sellControlled(page);

    // 1. The register already holds the dispense, with the opening balance it seeded from the shelf.
    await page.goto('/controlled-register');
    await expect(page.getByRole('heading', { name: 'Controlled Drug Register' })).toBeVisible();
    await expect(page.getByText('Opening balance', { exact: true })).toBeVisible();
    await expect(page.getByText('RX-E2E-REGISTER')).toBeVisible();
    await expect(page.getByText(invoiceNo, { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Dr. Register')).toBeVisible();
    // Patient national ID is masked everywhere it is displayed.
    await expect(page.getByText('1001002007')).toHaveCount(0);
    await expect(page.getByText('Balanced').first()).toBeVisible();

    // 2. Return one unit through the normal returns screen (controlled return needs a reason).
    await page.goto('/returns');
    await page.getByLabel('Invoice No. / phone / customer').fill(invoiceNo);
    await page.getByRole('button', { name: 'Find' }).click();
    await page.locator('input[type=number]').first().fill('1');
    await page.getByLabel('Reason').fill('Customer returned the box unopened.');
    await page.getByRole('button', { name: 'Process Return' }).click();
    await expect(page.getByText(/Refunded SAR/)).toBeVisible();

    // 3. Back in the register: the return is an inward row that points at the fill it reverses,
    //    and the running balance matches stock again (25 out of 25).
    await page.goto('/controlled-register');
    const returnRow = page.getByRole('row', { name: /Return/ }).filter({ hasText: 'Customer returned the box unopened.' });
    await expect(returnRow).toBeVisible();
    await expect(returnRow).toContainText('reverses');
    await expect(returnRow).toContainText('25');
    await expect(page.getByText('Balanced').first()).toBeVisible();
    await expect(page.getByText('Variance', { exact: false })).toHaveCount(0);
  });

  test('writes off expired stock as an outward register row', async ({ page }) => {
    await page.goto('/controlled-register');
    await page.getByRole('button', { name: 'Write off stock' }).click();

    const dialog = page.getByRole('dialog', { name: 'Write off controlled stock' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Controlled item' }).click();
    await page.getByRole('option', { name: /Tramadol 50mg/ }).click();

    await dialog.getByRole('combobox', { name: 'Batch' }).click();
    await page.getByRole('option', { name: /TR24L19/ }).click();

    await dialog.getByLabel('Write-off type').click();
    await page.getByRole('option', { name: 'Expired stock' }).click();
    await dialog.getByLabel('Quantity (base units)').fill('2');
    await dialog.getByLabel('Reason (required)').fill('Reached expiry, destroyed with witness.');
    await dialog.getByLabel('Witness (optional)').fill('Omar');
    await dialog.getByRole('button', { name: 'Write off' }).click();

    await expect(dialog).not.toBeVisible();
    const row = page.getByRole('row', { name: /Expiry write-off/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Reached expiry, destroyed with witness.');
    await expect(row).toContainText('Omar');
    // Stock went down by the same amount the register says went out.
    await expect(page.getByText('Balanced').first()).toBeVisible();

    // The regulator hand-off carries the same movement.
    const month = new Date().toISOString().slice(0, 7);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toBe(`controlled-register-${month}.csv`);
  });
});
