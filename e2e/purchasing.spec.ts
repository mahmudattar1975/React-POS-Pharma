import { test, expect } from './fixtures';

// The purchase window is the legacy FCODCSVN reuse: the party can be a vendor (type_flag 1) or a
// business customer account (type_flag 2). POS retail patients (Ahmed Al-Otaibi, Walk-in Customer)
// live in a different master and must never be offered as a purchase party.
test.describe('purchase invoices', () => {
  test('books a customer purchase from the party table and prints it as a customer document', async ({ page }) => {
    await page.goto('/purchases');

    await page.getByRole('checkbox', { name: /Customer \(type_flag = 2\)/ }).check();
    await page.getByRole('combobox').first().click();
    await expect(page.getByRole('option', { name: /Al-Noor Medical Center/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Ahmed Al-Otaibi/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /Walk-in Customer/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Al-Noor Medical Center/ }).click();
    await page.getByLabel('Customer document no').fill('CUS-2026-001');
    // The PUR sequence is system-assigned and stays separate from the document the party issued.
    await expect(page.getByLabel('Invoice seq.')).toHaveValue(/PUR-000001$/);

    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').fill('Paracetamol');
    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').press('Enter');
    await page.getByLabel('Qty (paid)').fill('10');
    await page.getByLabel('Batch / Lot No.').fill('PC26A01');
    await page.getByLabel('Expiry Date').fill('2028-05-31');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('3.5');
    await page.getByRole('button', { name: 'Add line to invoice' }).click();

    await page.getByRole('button', { name: /Receive into stock/ }).click();
    await expect(page.getByText(/received from Al-Noor Medical Center/)).toBeVisible();

    const row = page.getByRole('row', { name: /CUS-2026-001/ });
    await expect(row).toContainText('CUS-000001');
    await expect(row).toContainText('CUS-2026-001');

    // The history is searchable by the system PUR sequence as well as the party's document no.
    await page.getByLabel('Search posted invoices').fill('PUR-000001');
    await expect(row).toBeVisible();
    await page.getByLabel('Search posted invoices').fill('no-such-invoice');
    await expect(page.getByText(/No posted invoices match/)).toBeVisible();
    await page.getByLabel('Search posted invoices').clear();
    await expect(row).toBeVisible();

    await row.getByLabel('View invoice').click();
    const viewDialog = page.getByRole('dialog');
    await expect(viewDialog.getByText('Customer document no:')).toBeVisible();
    await expect(viewDialog.getByText('CUS-2026-001', { exact: true })).toBeVisible();
    await viewDialog.getByLabel('Close').click();

    await row.getByLabel('Print purchase invoice').click();
    await expect(page.getByText('Customer / العميل')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/customer document CUS-2026-001/)).toBeVisible();
  });

  test('shows each line\'s three discount tiers and lets the line be modified or removed', async ({ page }) => {
    await page.goto('/purchases');

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel("Vendor's invoice no").fill('DISC-2026-001');

    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').fill('Paracetamol');
    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').press('Enter');
    await page.getByLabel('Qty (paid)').fill('10');
    await page.getByLabel('Batch / Lot No.').fill('DSC26A01');
    await page.getByLabel('Expiry Date').fill('2028-05-31');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('3.5');
    // No point typed: the mask inserts it after two digits (1667 -> 16.67).
    await page.getByLabel('Discount 1').pressSequentially('1667');
    await expect(page.getByLabel('Discount 1')).toHaveValue('16.67');
    await page.getByLabel('Discount 2').fill('5');
    await page.getByRole('button', { name: 'Add line to invoice' }).click();

    const lineRow = page.getByRole('row', { name: /Paracetamol 500mg/ });
    await expect(lineRow).toContainText('16.67%');
    await expect(lineRow).toContainText('5.00%');
    await expect(lineRow).toContainText('—');

    await lineRow.getByLabel('Modify line').click();
    await expect(page.getByLabel('Discount 1')).toHaveValue('16.67');
    await expect(page.getByLabel('Discount 2')).toHaveValue('5.00');
    await page.getByLabel('Discount 1').fill('10');
    await page.getByRole('button', { name: 'Update line' }).click();

    const updatedRow = page.getByRole('row', { name: /Paracetamol 500mg/ });
    await expect(updatedRow).toContainText('10.00%');
    await expect(updatedRow).not.toContainText('16.67%');

    await updatedRow.getByLabel('Remove line').click();
    await expect(page.getByRole('row', { name: /Paracetamol 500mg/ })).toHaveCount(0);
  });

  test('modifies a posted invoice header and then deletes it', async ({ page }) => {    await page.goto('/purchases');

    // Default side is Vendor (type_flag 1).
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel("Vendor's invoice no").fill('MOD-2026-001');

    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').fill('Paracetamol');
    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').press('Enter');
    await page.getByLabel('Qty (paid)').fill('10');
    await page.getByLabel('Batch / Lot No.').fill('MOD26A01');
    await page.getByLabel('Expiry Date').fill('2028-05-31');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('3.5');
    await page.getByRole('button', { name: 'Add line to invoice' }).click();
    await page.getByRole('button', { name: /Receive into stock/ }).click();

    const row = page.getByRole('row', { name: /MOD-2026-001/ });
    await expect(row).toContainText('MOD-2026-001');

    await row.getByLabel('Modify purchase invoice').click();
    await expect(page.getByText(/Editing vendor invoice MOD-2026-001/)).toBeVisible();
    await page.getByLabel('Notes (optional)').fill('Corrected after checking the delivery note');
    await page.getByRole('button', { name: /Save changes to (?:[A-Z0-9]+-)?PUR-000001/ }).click();
    await expect(page.getByText(/Vendor invoice MOD-2026-001 · (?:[A-Z0-9]+-)?PUR-000001 received from Al-Hayat/)).toBeVisible();

    await page.getByRole('row', { name: /MOD-2026-001/ }).getByLabel('Delete purchase invoice').click();
    await page.getByRole('button', { name: 'Delete Invoice' }).click();
    await expect(page.getByRole('row', { name: /MOD-2026-001/ })).toHaveCount(0);
    await expect(page.getByText('No purchase invoices posted yet.')).toBeVisible();
  });

  test('receives an item with no expiry date and refuses a line without a purchase price', async ({ page }) => {
    // 1. Item Master: create a non-dated supply and switch its expiry tracking off.
    await page.goto('/items');
    await page.getByRole('button', { name: 'Add Item' }).click();
    await page.getByLabel('Barcode / GTIN 1 (main)').fill('SUPPLY-0001');
    await page.getByLabel('Name (English)').fill('Gauze Roll 10cm');
    await page.getByLabel('Name (Arabic - عربي)').fill('لفافة شاش 10 سم');
    // Unit is now chosen from dbo.Units; Piece keeps this non-dated supply free of pack semantics.
    await page.getByLabel('Unit', { exact: true }).click();
    await page.getByRole('option', { name: 'Piece', exact: true }).click();
    await page.getByLabel('Sale Price').fill('8');
    await page.getByRole('switch', { name: 'Has expiry date' }).click();
    await page.getByRole('button', { name: 'Create Item' }).click();
    await expect(page.getByText('Gauze Roll 10cm').first()).toBeVisible();

    // 2. Purchase invoice: the item is found through the POS-style search and the expiry field is
    //    disabled because the item has none. The Add button stays disabled until a price is typed.
    await page.goto('/purchases');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel("Vendor's invoice no").fill('NOEXP-2026-001');

    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').fill('Gauze Roll');
    await page.getByLabel('Scan barcode or type item name / SKU, then Enter').press('Enter');
    await expect(page.getByLabel('Expiry Date (none)')).toBeDisabled();
    await page.getByLabel('Qty (paid)').fill('5');
    await page.getByLabel('Batch / Lot No.').fill('SUP26A01');
    await expect(page.getByRole('button', { name: 'Add line to invoice' })).toBeDisabled();

    await page.getByLabel('Unit purchase price (excl. VAT)').fill('2.4');
    await expect(page.getByRole('button', { name: 'Add line to invoice' })).toBeEnabled();
    await page.getByRole('button', { name: 'Add line to invoice' }).click();

    // The posted line keeps a null expiry, shown as an em dash rather than an invented date.
    const lineRow = page.getByRole('row', { name: /Gauze Roll 10cm/ });
    await expect(lineRow).toContainText('SUP26A01');
    await expect(lineRow).toContainText('—');
  });

  test('refuses lines until the vendor and their invoice number are entered', async ({ page }) => {
    await page.goto('/purchases');

    // The whole line panel is inactive until the document is identified - not just the Add button,
    // so the owner can't spend time pricing a line that has nowhere to belong.
    const itemSearch = page.getByLabel('Scan barcode or type item name / SKU, then Enter');
    const addButton = page.getByRole('button', { name: 'Add line to invoice' });
    await expect(itemSearch).toBeDisabled();
    await expect(page.getByLabel('Qty (paid)')).toBeDisabled();
    await expect(page.getByLabel('Bonus (free)')).toBeDisabled();
    await expect(page.getByLabel('Batch / Lot No.')).toBeDisabled();
    await expect(page.getByLabel('Expiry Date')).toBeDisabled();
    await expect(page.getByLabel('Unit purchase price (excl. VAT)')).toBeDisabled();
    await expect(page.getByLabel('Discount 1')).toBeDisabled();
    await expect(addButton).toBeDisabled();
    await expect(page.getByText(/every line must belong to an identified document/)).toBeVisible();

    // The vendor alone is not enough - the vendor's own invoice number is the other half of the key.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await expect(itemSearch).toBeDisabled();
    await expect(page.getByLabel('Unit purchase price (excl. VAT)')).toBeDisabled();
    await expect(addButton).toBeDisabled();

    // With the document identified the fields open up and the explanation disappears.
    await page.getByLabel("Vendor's invoice no").fill('HDR-2026-001');
    await expect(page.getByText(/every line must belong to an identified document/)).toHaveCount(0);
    await expect(itemSearch).toBeEnabled();

    // Vitamin D3 is standard-rated (15%), so the VAT read-out is exercised too.
    await itemSearch.fill('Vitamin D3');
    await itemSearch.press('Enter');
    await page.getByLabel('Qty (paid)').fill('10');
    await page.getByLabel('Batch / Lot No.').fill('HDR26A01');
    await page.getByLabel('Expiry Date').fill('2028-05-31');
    await page.getByLabel('Unit purchase price (excl. VAT)').fill('2.5');

    // 10 x 2.50 = 25.00 gross, and with no discount the net is the same, so VAT is 15% of 25.00.
    await expect(page.getByLabel('Line net (excl. VAT)')).toHaveValue('25.00');
    await expect(page.getByLabel('Input VAT (15%)')).toHaveValue('3.75');
    await expect(page.getByLabel('Line total (incl. VAT)')).toHaveValue('28.75');
    await expect(page.getByLabel('Value off #1 (SAR)')).toHaveValue('0.00');
    await expect(page.getByLabel('Invoice total (incl. VAT, SAR)')).toHaveValue('0.00');

    // Each discount field carries its own money value: 10% of 25.00 = 2.50 off, then VAT on 22.50.
    await page.getByLabel('Discount 1').fill('10');
    await expect(page.getByLabel('Value off #1 (SAR)')).toHaveValue('2.50');
    await expect(page.getByLabel('Line net (excl. VAT)')).toHaveValue('22.50');
    await expect(page.getByLabel('Input VAT (15%)')).toHaveValue('3.38');
    await expect(page.getByLabel('Line total (incl. VAT)')).toHaveValue('25.88');

    await expect(addButton).toBeEnabled();
    await addButton.click();

    await expect(page.getByRole('row', { name: /Vitamin D3 1000IU/ })).toContainText('HDR26A01');
    await expect(page.getByLabel('Invoice total (incl. VAT, SAR)')).toHaveValue('25.88');
  });
});
