import { test as base, expect, type Page } from '@playwright/test';

// Every page in this app now sits behind RequireAuth (a persisted cashier session) and DrawerGate
// (an open shift from the separate dotnet-pos API on :5000). That's correct for production, but it
// means a bare page.goto('/') just lands on /login. Tests still want a genuinely fresh browser
// context (fresh seed data/localStorage - see playwright.config.ts), so instead of sharing a
// pre-authenticated context we seed the two things that gate entry, per context:
//   1. the zustand-persisted auth session, via addInitScript (runs before the app boots);
//   2. dotnet-pos itself, stubbed at the network layer - these specs are about this app's own
//      behaviour, and the real backend needs SQL Server plus a cashier login to exist.
// Any dotnet-pos endpoint a test happens to hit gets a benign empty JSON body; a failed mirror is
// already a no-op by design (see POSPage.tsx's completeSale), so this never hides a real failure.
export const TEST_SESSION = {
  token: 'e2e-token',
  cashierId: 1,
  username: 'cashier',
  fullName: 'E2E Cashier',
  isAdmin: true,
};

const OPEN_SHIFT = {
  id: 1,
  cashierId: TEST_SESSION.cashierId,
  openedAt: '2026-01-01T08:00:00.000Z',
  closedAt: null,
  openingFloat: 500,
  closingAmount: null,
  status: 1, // ShiftStatus.Open
  commissionEarned: 0,
  totalSales: 0,
  totalReturns: 0,
};

async function seedCashierAndShift(page: Page) {
  await page.addInitScript((session) => {
    localStorage.setItem('pharmacy-auth', JSON.stringify({ state: { session }, version: 0 }));
  }, TEST_SESSION);

  await page.route('http://localhost:5000/**', (route) => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    };
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers });
    }
    if (request.url().includes('/Shift/Current')) {
      return route.fulfill({ status: 200, headers, json: OPEN_SHIFT });
    }
    if (request.url().includes('/Pos/Create')) {
      // Match PosSaleResult: the app zips request items to response items by index, so supply
      // enough placeholder ids for any one sale in these specs rather than an empty array.
      const items = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
      return route.fulfill({ status: 200, headers, json: { id: 1, items } });
    }
    return route.fulfill({ status: 200, headers, json: {} });
  });
}

// After "Complete Sale" the app may show the post-payment directions step before the receipt. That
// step is optional, so specs that only care about the receipt can skip it. Race the two possible
// outcomes instead of assuming one: whether the step appears depends on the sold item having dosage
// instructions linked in the seed data, which is a data detail these specs should not encode.
export async function dismissDirectionsIfShown(page: Page): Promise<void> {
  const directions = page.getByText('Directions for this sale');
  const invoice = page.getByText(/^Invoice /);
  await expect(directions.or(invoice).first()).toBeVisible();
  if (await directions.isVisible()) {
    await page.getByRole('button', { name: 'Skip' }).click();
  }
  await expect(invoice).toBeVisible();
}

export const test = base.extend({
  // Named `provide` rather than Playwright's conventional `use` so oxlint's react-hooks rule
  // doesn't mistake it for React's use() hook (this is a Playwright fixture, not a component).
  page: async ({ page }, provide) => {
    await seedCashierAndShift(page);
    await provide(page);
  },
});

export { expect };
