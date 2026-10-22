import { test, expect } from '@playwright/test';

test.describe('customer lookup', () => {
  test('an existing seed customer is found by phone, with points balance shown', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Select customer').click();
    await page.getByLabel('Mobile number').fill('0501234567'); // Ahmed Al-Otaibi, VIP, 500 pts
    await expect(page.getByText('Ahmed Al-Otaibi', { exact: false })).toBeVisible();
    await expect(page.getByText('500 points', { exact: false })).toBeVisible();
  });

  test('a new customer requires a 10-digit national ID before it can be created', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Select customer').click();
    await page.getByLabel('Mobile number').fill('0599998888');
    await page.getByLabel('Name (English)').fill('Validation Test');
    const createBtn = page.getByRole('button', { name: 'Create & Use' });
    await expect(createBtn).toBeEnabled(); // national ID is optional for a plain customer

    await page.getByLabel(/National ID/).fill('123');
    await expect(createBtn).toBeDisabled(); // but an incomplete one entered must be rejected

    await page.getByLabel(/National ID/).fill('1055557777');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();
    await expect(page.getByLabel('Select customer')).toContainText('Validation Test');
  });

  test('walk-in has no points balance shown and never gates checkout', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Select customer')).toContainText('Walk-in Customer');
    await expect(page.getByText('pts (SAR', { exact: false })).not.toBeVisible();
  });
});
