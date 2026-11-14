import { test, expect } from './fixtures';

// The Purchase Returns tab posts a credit note against a received delivery and puts the stock
// back. It reuses the same party table as purchases, so a return can be for a vendor or a
// business customer, and it links to the original purchase document.
test.describe('purchase returns', () => {
  // Each flow receives a delivery, posts a return, then checks inventory and history - four
  // navigations plus two forms. That legitimately runs near Playwright's 30s default when the
  // full suite shares one dev server, so give these two end-to-end flows room.
  test.describe.configure({ timeout: 60_000 });

  test('posts a partial return against a purchase and removes only the returned quantity', async ({ page }) => {
    // 1. Receive 10 units so there is a real delivery to return.
    await page.goto('/purchases');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel("Vendor's invoice no").fill('RTN-PUR-2026-001');

    await page.getByLabel('Item (name or scroll)').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
    await page.getByLabel('Qty (paid)').fill('10');
    await page.getByLabel('Batch / Lot No.').fill('RTN26A01');
    await page.getByLabel('Expiry Date').fill('2028-06-30');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('3.5');
    await page.getByRole('button', { name: 'Add line to invoice' }).click();
    await page.getByRole('button', { name: /Receive into stock/ }).click();
    await expect(page.getByText(/received from Al-Hayat/)).toBeVisible();

    // The batch starts at 10 on hand.
    await page.goto('/inventory');
    await page.getByLabel('Scan barcode or type item name / SKU').fill('Paracetamol');
    const batchRow = () => page.getByRole('row', { name: /RTN26A01/ });
    await expect(batchRow().getByRole('cell').nth(3)).toHaveText('10');

    // 2. Post the return from the new tab, linked to the purchase just received.
    await page.goto('/purchase-returns');
    await expect(page.getByRole('tab', { name: /Purchase Returns/ })).toHaveAttribute('aria-selected', 'true');

    // Search by the internal purchase sequence; the party fills itself in from the linked invoice.
    await page.getByLabel('Link to original invoice').fill('PUR-000001');
    await page.getByRole('option', { name: /PUR-000001/ }).click();
    await expect(page.getByRole('combobox').first()).toContainText('Al-Hayat Drug Distribution');

    await page.getByLabel('Return No').fill('CN-2026-001');
    // Select the Panadol line from the original invoice, then lower just its return quantity:
    // return only 4 of the 10 received.
    const originalLine = page.getByRole('table', { name: 'Original invoice lines' }).getByRole('row', { name: /Paracetamol 500mg/ });
    await expect(originalLine).toContainText('10 + 0 bonus');
    await originalLine.getByRole('button', { name: 'Add to return' }).click();

    const returnLine = page.getByRole('table', { name: 'Return lines' }).getByRole('row', { name: /Paracetamol 500mg/ });
    await expect(page.getByLabel('Return paid qty Paracetamol 500mg')).toHaveValue('10');
    await page.getByLabel('Return paid qty Paracetamol 500mg').fill('4');
    await expect(returnLine).toContainText('14.00');
    await page.getByRole('button', { name: 'Post Return' }).click();

    await expect(page.getByText(/Return CN-2026-001 saved/)).toBeVisible();
    const returnRow = page.getByRole('row', { name: /CN-2026-001/ });
    await expect(returnRow).toContainText('RET-000001');
    await expect(returnRow).toContainText('RTN-PUR-2026-001');
    await expect(returnRow).toContainText('14.00');

    // 3. Only the 4 returned units left stock; the other 6 are still on the shelf.
    await page.goto('/inventory');
    await page.getByLabel('Scan barcode or type item name / SKU').fill('Paracetamol');
    await expect(batchRow().getByRole('cell').nth(3)).toHaveText('6');

    // 4. The return is not listed as a purchase invoice (editing/deleting it there would move
    //    stock the wrong way).
    await page.goto('/purchases');
    await expect(page.getByRole('row', { name: /CN-2026-001/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /RTN-PUR-2026-001/ })).toBeVisible();
    // The return has its own RET- sequence, so the next purchase is still PUR-000002.
    await expect(page.getByLabel('Invoice seq.')).toHaveValue('PUR-000002');

    // 5. Reports keep returns in their own named section: the 10 received and the 4 returned are
    //    both positive figures, never a minus row netted into stock received.
    await page.goto('/reports');
    await expect(page.getByText('Stock Received', { exact: true })).toBeVisible();
    await expect(page.getByText('Purchase Returns', { exact: true })).toBeVisible();
    await expect(page.getByText('Total Units Received', { exact: true }).locator('..')).toContainText('10');
    await expect(page.getByText('Total Units Returned', { exact: true }).locator('..')).toContainText('4');
    await expect(page.getByRole('cell', { name: '-4', exact: true })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: '-14.00', exact: true })).toHaveCount(0);
  });

  test('returns a customer purchase with a manual line and refuses an over-return', async ({ page }) => {
    // 1. Receive 5 units for a business customer (type_flag 2).
    await page.goto('/purchases');
    await page.getByRole('checkbox', { name: /Customer \(type_flag = 2\)/ }).check();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Noor Medical Center/ }).click();
    await page.getByLabel('Customer document no').fill('CUS-RTN-2026-001');

    await page.getByLabel('Item (name or scroll)').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
    await page.getByLabel('Qty (paid)').fill('5');
    await page.getByLabel('Batch / Lot No.').fill('CUSRTN26A01');
    await page.getByLabel('Expiry Date').fill('2028-07-31');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('3.5');
    await page.getByRole('button', { name: 'Add line to invoice' }).click();
    await page.getByRole('button', { name: /Receive into stock/ }).click();
    await expect(page.getByText(/received from Al-Noor/)).toBeVisible();

    // 2. Ask for more than the shelf holds: the return must be refused, not create negative stock.
    await page.goto('/purchase-returns');
    await page.getByRole('checkbox', { name: 'Customer Return' }).check();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Noor Medical Center/ }).click();
    await page.getByLabel('Return No').fill('CN-CUS-2026-001');

    await page.getByLabel('Search item').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
    await page.getByLabel('Qty').fill('6');
    await page.getByLabel('Batch').fill('CUSRTN26A01');
    await page.getByLabel('Price').fill('3.5');
    await page.getByRole('button', { name: 'Add line' }).click();

    let alertMessage = '';
    page.once('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Post Return' }).click();
    expect(alertMessage).toMatch(/Only goods still in stock/);

    // 3. Correct the line to what is actually on hand and post it.
    await page.getByLabel('Remove returned line').click();
    await page.getByLabel('Search item').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
    await page.getByLabel('Qty').fill('5');
    await page.getByLabel('Batch').fill('CUSRTN26A01');
    await page.getByLabel('Price').fill('3.5');
    await page.getByRole('button', { name: 'Add line' }).click();

    await page.getByRole('button', { name: 'Post Return' }).click();
    await expect(page.getByText(/Return CN-CUS-2026-001 saved/)).toBeVisible();
    const customerReturnRow = page.getByRole('row', { name: /CN-CUS-2026-001/ });
    await expect(customerReturnRow).toContainText('RET-000001');
    await expect(customerReturnRow).toContainText('CUS-000001');

    // 4. The customer return leaves the batch empty, and it is not listed as a purchase.
    await page.goto('/inventory');
    await page.getByLabel('Scan barcode or type item name / SKU').fill('Paracetamol');
    await expect(page.getByRole('row', { name: /CUSRTN26A01/ }).getByRole('cell').nth(3)).toHaveText('0');

    await page.goto('/purchases');
    await expect(page.getByRole('row', { name: /CN-CUS-2026-001/ })).toHaveCount(0);
  });

  test('views, modifies and deletes a posted return from the history row actions', async ({ page }) => {
    // 1. Receive 10 units so there is a real delivery to return.
    await page.goto('/purchases');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel("Vendor's invoice no").fill('ACT-RTN-2026-001');

    await page.getByLabel('Item (name or scroll)').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
    await page.getByLabel('Qty (paid)').fill('10');
    await page.getByLabel('Batch / Lot No.').fill('ACT26A01');
    await page.getByLabel('Expiry Date').fill('2028-09-30');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('3.5');
    await page.getByRole('button', { name: 'Add line to invoice' }).click();
    await page.getByRole('button', { name: /Receive into stock/ }).click();
    await expect(page.getByText(/received from Al-Hayat/)).toBeVisible();

    // 2. Post a 4-unit linked return.
    await page.goto('/purchase-returns');
    await page.getByLabel('Link to original invoice').fill('PUR-000001');
    await page.getByRole('option', { name: /PUR-000001/ }).click();
    await page.getByLabel('Return No').fill('CN-ACT-2026-001');

    const originalLine = page
      .getByRole('table', { name: 'Original invoice lines' })
      .getByRole('row', { name: /Paracetamol 500mg/ });
    await originalLine.getByRole('button', { name: 'Add to return' }).click();
    await page.getByLabel('Return paid qty Paracetamol 500mg').fill('4');
    await page.getByRole('button', { name: 'Post Return' }).click();
    await expect(page.getByText(/Return CN-ACT-2026-001 saved/)).toBeVisible();

    const returnRow = () => page.getByRole('row', { name: /CN-ACT-2026-001/ });

    // 3. View shows the document details and lines.
    await returnRow().getByLabel('View return').click();
    const viewDialog = page.getByRole('dialog');
    await expect(viewDialog).toContainText('RET-000001');
    await expect(viewDialog).toContainText('Purchase return');
    await expect(viewDialog).toContainText('Paracetamol 500mg');
    await viewDialog.getByRole('button', { name: 'Close' }).last().click();

    // 4. Modify lowers the return from 4 to 2 units; stock moves from 6 back up to 8.
    await returnRow().getByLabel('Modify return').click();
    await expect(page.getByText(/Editing return RET-000001/)).toBeVisible();
    await expect(page.getByLabel('Return paid qty Paracetamol 500mg')).toHaveValue('4');
    await page.getByLabel('Return paid qty Paracetamol 500mg').fill('2');
    await page.getByRole('button', { name: 'Update Return' }).click();
    await expect(page.getByText(/Return CN-ACT-2026-001 saved/)).toBeVisible();
    await expect(returnRow()).toContainText('7.00');
    await expect(returnRow()).toContainText('RET-000001');

    await page.goto('/inventory');
    await page.getByLabel('Scan barcode or type item name / SKU').fill('Paracetamol');
    const batchRow = () => page.getByRole('row', { name: /ACT26A01/ });
    await expect(batchRow().getByRole('cell').nth(3)).toHaveText('8');

    // 5. Delete puts the remaining units back and removes the document from history.
    await page.goto('/purchase-returns');
    await returnRow().getByLabel('Delete return').click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog).toContainText('Delete RET-000001?');
    await deleteDialog.getByRole('button', { name: 'Delete Return' }).click();
    await expect(page.getByText('No purchase returns posted yet.')).toBeVisible();

    await page.goto('/inventory');
    await page.getByLabel('Scan barcode or type item name / SKU').fill('Paracetamol');
    await expect(page.getByRole('row', { name: /ACT26A01/ }).getByRole('cell').nth(3)).toHaveText('10');
  });
});
