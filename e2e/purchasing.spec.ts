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
    await expect(page.getByLabel('Invoice seq.')).toHaveValue('PUR-000001');

    await page.getByLabel('Item (name or scroll)').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
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

    await page.getByLabel('Item (name or scroll)').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
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

  test('modifies a posted invoice header and then deletes it', async ({ page }) => {
    await page.goto('/purchases');

    // Default side is Vendor (type_flag 1).
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Al-Hayat Drug Distribution/ }).click();
    await page.getByLabel("Vendor's invoice no").fill('MOD-2026-001');

    await page.getByLabel('Item (name or scroll)').fill('Paracetamol');
    await page.getByRole('option', { name: /Paracetamol 500mg/ }).click();
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
    await page.getByRole('button', { name: /Save changes to PUR-000001/ }).click();
    await expect(page.getByText(/Vendor invoice MOD-2026-001 · PUR-000001 received from Al-Hayat/)).toBeVisible();

    await page.getByRole('row', { name: /MOD-2026-001/ }).getByLabel('Delete purchase invoice').click();
    await page.getByRole('button', { name: 'Delete Invoice' }).click();
    await expect(page.getByRole('row', { name: /MOD-2026-001/ })).toHaveCount(0);
    await expect(page.getByText('No purchase invoices posted yet.')).toBeVisible();
  });
});
