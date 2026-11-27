import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { expect, test } from './fixtures';

test('Excel sample button downloads a usable item-import template', async ({ page }) => {
  await page.goto('/items');
  await page.getByRole('button', { name: 'Import Excel' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel sample' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('item-import-sample.xlsx');
  // Playwright removes its temporary artifact after the event, so copy it into test-results first.
  const saved = join(process.cwd(), 'test-results', 'item-import-sample.xlsx');
  await download.saveAs(saved);
  expect(existsSync(saved)).toBe(true);

  // The importer reads the first sheet, so the downloaded file must have the exact headers the
  // dialog auto-detects and two example rows the owner can delete. The rows share an English name
  // so the sample shows how repeated barcodes become one item with aliases.
  const workbook = XLSX.read(readFileSync(saved), { type: 'buffer' });
  expect(workbook.SheetNames).toEqual(['Items', 'How to fill']);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Items, { defval: '' });
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    Barcode: '5247619187585',
    Name: 'Sample Item - replace or delete these rows',
    'Product Category': 'All / COSMOTICS',
    'Sales Price': 99,
    'Customer Taxes': '15 Sales',
  });
  expect(rows[1]).toMatchObject({
    Barcode: '5281018089071',
    Name: 'Sample Item - replace or delete these rows',
  });
  rmSync(saved, { force: true });
});

test('Item Master links CategoryID and fills the category label from Categories', async ({ page }) => {
  await page.goto('/items');
  await page.getByRole('button', { name: 'Add Item' }).click();

  await page.getByLabel('CategoryID').click();
  await page.getByRole('option', { name: /Vitamins & Supplements/ }).click();

  const category = page.getByRole('textbox', { name: 'Category', exact: true });
  await expect(category).toHaveValue('Vitamins & Supplements');
  await expect(category).toHaveAttribute('readonly');
});

test('preview expands a scientific-notation barcode before applying', async ({ page }) => {
  // Build the workbook in memory: Playwright owns test-results, and setInputFiles accepts a buffer
  // directly, so the test cannot fail because of worker-local file access rules.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Barcode', 'Item Name', 'Sale Price', 'VAT %'],
    ['6.9442E+12', 'Scientific Barcode Item', 1, '0'],
  ]), 'Items');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  await page.goto('/items');
  await page.getByRole('button', { name: 'Import Excel' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'scientific-barcode.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });

  await expect(page.getByText('6944200000000', { exact: true })).toBeVisible();
  await expect(page.getByText('Scientific Barcode Item')).toBeVisible();
});
