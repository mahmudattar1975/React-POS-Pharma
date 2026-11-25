import { test, expect, dismissDirectionsIfShown } from './fixtures';

// Phase 3 of the RSD work: a sale must complete locally even when the RSD server is down, and the
// queued pack must be visible afterwards. The browser suite runs only Vite (no RSD server), which
// is exactly the "server down" case the local-first rule is about.
test.describe('RSD reporting', () => {
  test('queues a sold drug pack with the server down and shows it in the monitor', async ({ page }) => {
    // Force the "server down" case even when a local backend is running for manual mock testing.
    await page.route('http://localhost:4300/api/rsd/**', (route) => route.abort());
    await page.goto('/settings');
    await expect(page.getByText('SFDA RSD (Drug Track & Trace)')).toBeVisible();

    // Reporting is opt-in; the panel starts in the off state.
    await expect(page.getByText('Reporting off', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(page.getByText('Reporting on this register', { exact: true })).toBeVisible();

    // Sell one serialised pack. The checkout must not wait for (or fail on) the RSD server.
    await page.goto('/');
    const scan = page.getByLabel(/Scan barcode/);
    await scan.fill('010628100732002110AX24C09\x1d21SNE2E100');
    await scan.press('Enter');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Complete Sale' }).click();
    await dismissDirectionsIfShown(page);
    await expect(page.getByText(/^Invoice /)).toBeVisible();

    // The monitor is the other half of the sale: what still has to reach SFDA.
    await page.goto('/rsd-reporting');
    await expect(page.getByRole('tab', { name: 'RSD Reporting' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('RSD server not reachable', { exact: false })).toBeVisible();

    const row = page.getByRole('row', { name: /SIM-000001/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Sale');
    await expect(row).toContainText('SNE2E100');
    await expect(row).toContainText('Queued');
  });
});
