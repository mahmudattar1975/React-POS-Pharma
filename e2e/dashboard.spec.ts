import { test, expect } from './fixtures';

// The dashboard is a read-only analysis screen: it must open from the single sidebar entry, show
// every named section, and keep returns as their own positive figures instead of minus rows.
test.describe('business dashboard', () => {
  test('opens from the sidebar and shows every analysis section', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Dashboard & Reports' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Dashboard and Reports share one workspace, so both tabs are always present.
    await expect(page.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Reports' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Business Dashboard' })).toBeVisible();
    await expect(page.getByText('Goods on the Shelf', { exact: true })).toBeVisible();
    await expect(page.getByText('Sales Analysis', { exact: true })).toBeVisible();
    await expect(page.getByText('Purchasing Analysis', { exact: true })).toBeVisible();
    await expect(page.getByText('Returns Watch', { exact: true })).toBeVisible();
    await expect(page.getByText('Vendors & Customers', { exact: true })).toBeVisible();
    await expect(page.getByText('Stagnant Items', { exact: true })).toBeVisible();

    // Return figures are their own cards, not a minus row inside sales/purchases.
    await expect(page.getByText('Sales returns', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Purchase returns', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /^-\d/ })).toHaveCount(0);

    // The period chips re-filter without leaving the page.
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveClass(/MuiChip-filled/);

    // And the owner can jump to the detailed, printable reports in the same workspace.
    await page.getByRole('button', { name: 'Detailed reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Stagnant Items', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Days Idle', { exact: true })).toBeVisible();

    // The tab strip itself switches back without touching the sidebar.
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Business Dashboard' })).toBeVisible();
  });
});
