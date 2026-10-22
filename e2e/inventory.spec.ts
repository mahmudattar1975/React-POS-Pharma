import { test, expect } from '@playwright/test';

test.describe('Inventory & Expiry page', () => {
  test('renders normally', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory & Expiry' })).toBeVisible();
    await expect(page.getByText('Purchase Price')).toBeVisible();
    await expect(page.getByText('Omeprazole', { exact: false }).first()).toBeVisible();
  });

  // Regression test: Batch gained purchasePrice/purchaseDiscountPercent fields after this app had
  // already shipped with just costPrice. A batch persisted to localStorage under the OLD shape
  // (no fix) crashed this page outright - `batch.purchasePrice.toFixed(2)` threw on `undefined`,
  // blanking the entire page with no error boundary to catch it. Fixed in two places: catalogStore
  // .ts's persist `merge` backfills missing fields on rehydration, and this page falls back to 0
  // defensively. This test simulates exactly that stale-browser scenario so a future schema change
  // can't silently reintroduce the same crash.
  test('does not crash when localStorage has a pre-purchase-price batch shape', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'pharmacy-catalog',
        JSON.stringify({
          state: {
            items: [
              {
                id: 'itm-1',
                barcode: '6281007320014',
                nameAr: 'باراسيتامول 500 مجم',
                nameEn: 'Paracetamol 500mg (20 tabs)',
                unit: 'Strip',
                category: 'Analgesics',
                basePrice: 4.5,
                vatRate: 0,
                requiresBatchTracking: true,
                reorderLevel: 30,
              },
            ],
            // Deliberately missing purchasePrice/purchaseDiscountPercent - the old shape.
            batches: [
              {
                id: 'bat-1a',
                itemId: 'itm-1',
                batchNo: 'PC24A17',
                expiryDate: '2027-11-04',
                receivedDate: '2026-07-02',
                qtyOnHand: 120,
                costPrice: 2.8,
              },
            ],
            offers: [],
          },
          version: 0,
        })
      );
    });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory & Expiry' })).toBeVisible();
    // The specific backfilled batch (unique by batch number) should render, showing its old cost
    // as both the purchase price and cost price (no discount, so the two are equal - hence two
    // "2.80" cells in this one row), instead of throwing and blanking the whole page.
    const row = page.locator('tr', { hasText: 'PC24A17' });
    await expect(row).toBeVisible();
    await expect(row.getByText('2.80').first()).toBeVisible();
    expect(await row.getByText('2.80').count()).toBe(2);
    expect(errors).toEqual([]);
  });
});
