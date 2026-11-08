import { test, expect, type Page } from './fixtures';

// Paracetamol has two seeded batches (PC24A17 and PC23F02) and a single active BOGO offer:
// buy 2, get 1 free (utils/seedData.ts's off-1). Because it has more than one batch in stock, every
// scan opens the batch picker instead of adding straight to the cart - which is exactly how this
// item ends up split over two cart lines in real use.
const PARACETAMOL_BARCODE = '6281007320014';
const BATCH_A = 'PC24A17';
const BATCH_B = 'PC23F02';

async function scanAndPickBatch(page: Page, batchNo: string) {
  const scan = page.getByLabel(/Scan barcode/);
  await scan.fill(PARACETAMOL_BARCODE);
  await scan.press('Enter');
  await page.getByText(`Batch ${batchNo}`).click();
  await expect(page.getByText(`Batch ${batchNo}`)).toBeHidden();
}

function cartRow(page: Page, batchNo: string) {
  return page.getByRole('row').filter({ hasText: batchNo });
}

function discountButton(page: Page, batchNo: string) {
  return cartRow(page, batchNo).getByRole('button', { name: /Line discount for/ });
}

test.describe('BOGO offer across batches', () => {
  test('buy 2 get 1 free still applies when the three units are split over two batches', async ({ page }) => {
    await page.goto('/');

    // 2 units on batch A, 1 on batch B. Neither line reaches a bundle of 3 on its own, so pricing
    // each line independently used to lose the offer completely.
    await scanAndPickBatch(page, BATCH_A);
    await scanAndPickBatch(page, BATCH_B);
    await scanAndPickBatch(page, BATCH_A);

    await expect(page.getByText(BATCH_A)).toBeVisible();
    await expect(page.getByText(BATCH_B)).toBeVisible();

    // One free unit out of the three, at 4.50 each: 13.50 gross - 4.50 = 9.00.
    await expect(page.getByText('Buy 2 Get 1 Free').first()).toBeVisible();
    await expect(page.getByText('SAR 9.00')).toBeVisible();
    await expect(page.getByText('-4.50').first()).toBeVisible();

    // The offer belongs to the item, so manual discount is off on BOTH batch lines - not just the
    // one the free unit happened to land on.
    await expect(discountButton(page, BATCH_A)).toBeDisabled();
    await expect(discountButton(page, BATCH_B)).toBeDisabled();
  });

  test('two units across two batches still do not qualify - the offer needs a full bundle', async ({ page }) => {
    await page.goto('/');

    await scanAndPickBatch(page, BATCH_A);
    await scanAndPickBatch(page, BATCH_B);

    await expect(page.getByText('Buy 2 Get 1 Free')).toHaveCount(0);
    await expect(page.getByText('SAR 9.00')).toBeVisible();
    await expect(discountButton(page, BATCH_A)).toBeEnabled();
    await expect(discountButton(page, BATCH_B)).toBeEnabled();
  });

  test('completing a bundle drops a manual discount already given on the sibling batch', async ({ page }) => {
    await page.goto('/');

    // A first, B second: A is the line the free unit gets allocated to once the bundle completes.
    await scanAndPickBatch(page, BATCH_A);
    await scanAndPickBatch(page, BATCH_B);

    // At two units the offer has not kicked in, so the cashier can still discount B manually.
    const discountB = discountButton(page, BATCH_B);
    await expect(discountB).toBeEnabled();
    await discountB.click();
    await page.getByLabel('Discount fraction').fill('0.15');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(cartRow(page, BATCH_B).getByText('-0.68')).toBeVisible();

    // Third unit completes the bundle across both batches.
    await scanAndPickBatch(page, BATCH_A);

    // The manual discount must not stack with the offer: B is repriced clean and locked, and the
    // cart is exactly the offer price (3 x 4.50 - 1 free unit = 9.00), not 9.00 minus 0.68.
    await expect(discountB).toBeDisabled();
    await expect(page.getByText('-0.68')).toHaveCount(0);
    await expect(page.getByText('SAR 9.00')).toBeVisible();
  });
});
