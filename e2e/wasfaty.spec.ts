import { test, expect, type Page } from './fixtures';
import type { Route } from '@playwright/test';

// Amoxicillin is on the NUPCO approved list in the seed data (code 6281007320021, approved price
// 11.50 against a 12.00 retail price) and has a single batch, so it can be scanned without the batch
// picker. Vitamin D3 is deliberately eligible-but-unmapped, which is the checkout guard case.
const AMOXICILLIN_BARCODE = '6281007320021';
const VITAMIN_D_BARCODE = '6281007320045';
const VITAMIN_D_NUPCO_CODE = '6281007320045';

async function startWasfaty(page: Page, prescriptionNo: string) {
  await page.getByRole('button', { name: 'Start Wasfaty dispense' }).click();
  await expect(page.getByText('Wasfaty / وصفتي dispense')).toBeVisible();
  await page.getByLabel('Prescription No. (وصفة)').fill(prescriptionNo);
  await page.getByLabel('Patient National ID / Iqama').fill('1234567890');
  await page.getByLabel('Prescriber name').fill('Dr. E2E');
  await page.getByRole('button', { name: 'Start dispense' }).click();
  await expect(page.getByText(/Wasfaty dispense in progress/)).toBeVisible();
}

async function scan(page: Page, barcode: string) {
  const field = page.getByLabel(/Scan barcode/);
  await field.fill(barcode);
  await field.press('Enter');
}

test.describe('Wasfaty / NUPCO dispensing', () => {
  test('a covered item is invoiced at the approved price and the patient pays 0.00', async ({ page }) => {
    await page.goto('/');
    await startWasfaty(page, 'RX-E2E-1001');
    await scan(page, AMOXICILLIN_BARCODE);

    // Option A: the line is repriced from 12.00 retail to the 11.50 NUPCO-approved value.
    await expect(page.getByText('Amoxicillin Syrup')).toBeVisible();
    await expect(page.getByText(`Wasfaty · ${AMOXICILLIN_BARCODE}`)).toBeVisible();
    await expect(page.getByText('Wasfaty coverage')).toBeVisible();
    await expect(page.getByText('Patient pays SAR 0.00', { exact: true })).toBeVisible();
    await expect(page.getByText('SAR 11.50', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByText(/Fully covered by Wasfaty/)).toBeVisible();
    await expect(page.getByText('NUPCO coverage')).toBeVisible();

    await page.getByRole('button', { name: 'Dispense & complete' }).click();

    // Seed data links dosage instructions to Amoxicillin, so the post-payment directions step
    // appears before the receipt. Skipping must still reach the receipt.
    await expect(page.getByText('Directions for this sale')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    await expect(page.getByText(/^Invoice /)).toBeVisible();
    const receipt = await page.locator('#receipt-print-area').innerText();
    expect(receipt).toContain('Wasfaty');
    expect(receipt).toContain('RX-E2E-1001');
    expect(receipt).toContain('11.50');
  });

  test('an eligible item with no NUPCO code blocks checkout instead of charging the patient', async ({ page }) => {
    await page.goto('/');
    await startWasfaty(page, 'RX-E2E-1002');
    await scan(page, VITAMIN_D_BARCODE);

    await expect(page.getByText('Wasfaty · no NUPCO code')).toBeVisible();
    await expect(page.getByText(/Blocked until mapped: Vitamin D3/)).toBeVisible();

    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByText(/Map these items before dispensing/)).toBeVisible();
    await expect(page.getByText('Payment', { exact: true })).toHaveCount(0);
  });

  test('mapping an item on the Wasfaty screen makes it dispensable', async ({ page }) => {
    await page.goto('/wasfaty-mapping');
    await expect(page.getByText('Wasfaty / NUPCO Mapping')).toBeVisible();

    const row = page.getByRole('row', { name: /Vitamin D3/ });
    await expect(row).toBeVisible();
    await row.getByPlaceholder('13-digit NUPCO code').fill(VITAMIN_D_NUPCO_CODE);
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Saved')).toBeVisible();

    await page.goto('/');
    await startWasfaty(page, 'RX-E2E-1003');
    await scan(page, VITAMIN_D_BARCODE);

    await expect(page.getByText(`Wasfaty · ${VITAMIN_D_NUPCO_CODE}`)).toBeVisible();
    await expect(page.getByText(/Blocked until mapped/)).toHaveCount(0);
    await expect(page.getByText('Patient pays SAR 0.00', { exact: true })).toBeVisible();
  });

  test('bulk NUPCO import previews errors and maps several items in one batch', async ({ page }) => {
    await page.goto('/wasfaty-mapping');
    await page.getByRole('button', { name: 'Import NUPCO list' }).click();
    await expect(page.getByText('Import the NUPCO approved item list')).toBeVisible();

    const input = page.getByPlaceholder(/nupco_code,barcode/);
    await input.fill([
      'nupco_code,barcode,price',
      `${VITAMIN_D_NUPCO_CODE},${VITAMIN_D_BARCODE},21.00`,
      '6281007320052,6281007320052,47.00',
      '123,not-a-code,1.00',
    ].join('\n'));

    // An invalid row blocks the whole batch: the preview shows the error and Apply stays disabled.
    await expect(page.getByText('1 error(s)')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Apply/ })).toBeDisabled();

    await input.fill([
      'nupco_code,barcode,price',
      `${VITAMIN_D_NUPCO_CODE},${VITAMIN_D_BARCODE},21.00`,
      '6281007320052,6281007320052,47.00',
    ].join('\n'));

    await expect(page.getByText('2 ready')).toBeVisible();
    await page.getByRole('button', { name: 'Apply 2 mappings' }).click();
    await expect(page.getByText('2 item(s) mapped from the NUPCO list.')).toBeVisible();

    // The change is auditable: the history panel records both rows as an import.
    const history = page.getByRole('button', { name: /Mapping history/ });
    await expect(history).toContainText('2 change(s)');
    await history.click();
    await expect(page.getByText('2 change(s)')).toBeVisible();
    await expect(page.locator('.MuiAccordionDetails-root').getByText('Import').first()).toBeVisible();

    // The imported mapping is live: Vitamin D3 now dispenses at the approved 21.00.
    await page.goto('/');
    await startWasfaty(page, 'RX-E2E-1004');
    await scan(page, VITAMIN_D_BARCODE);
    await expect(page.getByText(`Wasfaty · ${VITAMIN_D_NUPCO_CODE}`)).toBeVisible();
    await expect(page.getByRole('cell', { name: '21.00', exact: true })).toBeVisible();
    await expect(page.getByText('SAR 24.15', { exact: false }).first()).toBeVisible();
  });

  test('claim report exports Excel and opens the printable report', async ({ page }) => {
    await page.goto('/');
    await startWasfaty(page, 'RX-E2E-1005');
    await scan(page, AMOXICILLIN_BARCODE);
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Dispense & complete' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();

    await page.goto('/wasfaty-claims');
    await expect(page.getByText('Wasfaty / NUPCO claims')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Excel' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('wasfaty-claims-all.xlsx');

    await page.getByRole('button', { name: 'Print' }).click();
    await expect(page.getByText('Wasfaty / NUPCO claim report')).toBeVisible();
    const printArea = page.locator('#wasfaty-claims-print-area');
    await expect(printArea).toContainText('RX-E2E-1005');
    await expect(printArea).toContainText(AMOXICILLIN_BARCODE);
    await expect(printArea).toContainText('11.50');
  });

  test('server claim ledger submits a claim and records a reconciliation', async ({ page }) => {
    // The dev server used by this suite has no Wasfaty API, so the ledger is mocked at the network
    // boundary. This keeps the test about the screen's submit/reconcile behaviour rather than
    // requiring the separate API process and its on-disk ledger.
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': '*',
    };
    let claim = {
      id: 'claim-e2e-1',
      dispenseId: 'disp-e2e-1',
      invoiceNo: 'SIM-E2E-1',
      prescriptionNo: 'RX-E2E-2001',
      month: '2026-11',
      expectedAmount: 9,
      status: 'pending',
      createdAt: '2026-11-08T08:00:00.000Z',
      updatedAt: '2026-11-08T08:00:00.000Z',
    };
    const json = (route: Route, body: unknown) =>
      route.fulfill({ status: 200, headers: cors, json: body });

    await page.route('**/api/wasfaty/**', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/health')) {
        await json(route, {
          ok: true,
          provider: 'mock',
          configured: true,
          environment: 'e2e',
          capabilities: {
            lookupPrescription: true,
            requestAuthorization: true,
            submitDispense: true,
            submitClaim: true,
          },
          checkedAt: '2026-11-08T08:00:00.000Z',
        });
        return;
      }
      if (path.endsWith('/claims') && request.method() === 'GET') {
        await json(route, { claims: [claim], total: 1 });
        return;
      }
      if (path.endsWith('/claims/claim-e2e-1/submit')) {
        claim = { ...claim, status: 'reported', reportedAmount: 9 };
        await json(route, { claim });
        return;
      }
      if (path.endsWith('/claims/claim-e2e-1/reconcile')) {
        const body = JSON.parse(request.postData() ?? '{}');
        claim = {
          ...claim,
          status: 'variance',
          reportedAmount: 9,
          paidAmount: body.paidAmount,
          varianceReason: 'Paid below expected.',
        };
        await json(route, { claim });
        return;
      }
      await route.fulfill({ status: 404, headers: cors, body: '{}' });
    });

    await page.goto('/wasfaty-claims');
    await expect(page.getByText('Server claim ledger')).toBeVisible();
    const row = page.getByRole('row', { name: /claim-e2e-1/ });
    await expect(row.getByText('pending')).toBeVisible();

    await row.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Claim claim-e2e-1 submitted — status reported.')).toBeVisible();
    await expect(row.getByText('reported')).toBeVisible();

    await row.getByRole('button', { name: 'Reconcile' }).click();
    await expect(page.getByText('Reconcile claim')).toBeVisible();
    await page.getByLabel('Paid amount').fill('8.00');
    await expect(page.getByText(/below the expected amount by SAR 1.00/)).toBeVisible();
    await page.getByRole('button', { name: 'Save reconciliation' }).click();

    await expect(page.getByText('Claim claim-e2e-1 reconciled — status variance.')).toBeVisible();
    await expect(row.getByText('variance')).toBeVisible();
    await expect(row.getByText('Paid below expected.')).toBeVisible();
  });

  test('the connector panel reports capabilities and stays honest when the server is down', async ({ page }) => {
    // Settings > Wasfaty (docs/wasfaty-screens/08-wasfaty-settings.png). The panel must show which
    // adapter this installation uses and exactly which contract operations NUPCO still has to
    // supply, and it must degrade to a plain warning - not a blank panel - when the API is down.
    const cors = { 'access-control-allow-origin': '*' };
    await page.route('**/api/wasfaty/health', (route) =>
      route.fulfill({
        status: 200,
        headers: cors,
        json: {
          ok: true,
          provider: 'mock',
          configured: true,
          environment: 'sandbox',
          capabilities: {
            lookupPrescription: true,
            requestAuthorization: true,
            submitDispense: true,
            submitClaim: true,
          },
          contract: {
            source: 'file',
            version: '1.0',
            missingOperations: ['cancelDispense', 'reconcileClaim'],
          },
          checkedAt: '2026-11-08T08:00:00.000Z',
        },
      }),
    );

    await page.goto('/settings');
    await expect(page.getByText('Wasfaty / NUPCO connector')).toBeVisible();
    await expect(page.getByText('Provider: mock')).toBeVisible();
    await expect(page.getByText('Environment: sandbox')).toBeVisible();
    await expect(page.getByRole('row', { name: /Prescription lookup/ })).toContainText('Yes');
    await expect(page.getByRole('row', { name: /Claim submission/ })).toContainText('Yes');
    await expect(page.getByText(/The contract is missing: cancelDispense, reconcileClaim/)).toBeVisible();
    await expect(page.getByText('Catalogue coverage')).toBeVisible();

    await page.unroute('**/api/wasfaty/health');
    await page.route('**/api/wasfaty/health', (route) => route.abort());
    await page.getByRole('button', { name: /Check connection/ }).click();
    await expect(page.getByText(/Wasfaty server not reachable/)).toBeVisible();
  });
});
