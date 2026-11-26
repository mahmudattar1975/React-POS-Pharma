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
  // dialog auto-detects and a single example row the owner can delete. Read the bytes directly so
  // this is independent of how xlsx resolves file paths inside the Playwright worker.
  const workbook = XLSX.read(readFileSync(saved), { type: 'buffer' });
  expect(workbook.SheetNames).toEqual(['Items', 'How to fill']);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Items, { defval: '' });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    Barcode: 'SAMPLE-0001',
    'Item Name (English)': 'Sample Item - replace or delete this row',
    'VAT %': '15%',
    Active: 'Yes',
  });
  rmSync(saved, { force: true });
});
