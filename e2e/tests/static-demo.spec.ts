import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The website's read-only demo (frontend: npm run build:static-demo), served from its sub-path:
 *   E2E_STATIC_DEMO_URL=http://localhost:4174/demo/app npx playwright test static-demo
 * Checks that every page and view control is covered by the recorded snapshot.
 */
const DEMO = process.env.E2E_STATIC_DEMO_URL?.replace(/\/$/, '');
test.skip(!DEMO, 'set E2E_STATIC_DEMO_URL to a served static demo build');

const PAGES = ['/dashboard', '/budget', '/bills', '/recurring', '/import', '/rules', '/sinking-funds', '/fire-extinguisher', '/debts', '/reports', '/net-worth', '/calendar', '/transactions', '/accounts', '/categories', '/settings'];

const misses = (page: Page) => page.evaluate(() => (window as unknown as { __staticDemoMisses?: string[] }).__staticDemoMisses ?? []);

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(150);
}

/** The same controls the recorder steps through: segmented buttons, tabs and selects outside forms. */
async function explore(page: Page) {
  const tabs = await page.locator('main [role="tab"]').all();
  for (const tab of tabs.length ? tabs : [null]) {
    if (tab) {
      if (!(await tab.isVisible())) continue;
      await tab.click();
      await settle(page);
    }
    for (const b of await page.locator('main [role="group"].segmented button').all()) {
      if ((await b.isVisible()) && (await b.isEnabled())) await b.click();
    }
    for (const select of await page.locator('main select').all()) {
      if (!(await select.isVisible()) || (await select.evaluate((el) => !!el.closest('form, [role="dialog"]')))) continue;
      for (const v of await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))) await select.selectOption(v);
    }
    await settle(page);
  }
}

test('every page and view works from the snapshot, with no console errors', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${DEMO}/`);
  await expect(page).toHaveURL(/\/demo\/app\/dashboard/);
  await expect(page.getByRole('note').filter({ hasText: 'changes aren’t saved' })).toBeVisible();

  const overflow: string[] = [];
  for (const path of PAGES) {
    await page.goto(DEMO + path);
    await settle(page);
    await expect(page.locator('main h1').first()).toBeVisible();
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) overflow.push(path);
    await explore(page);
  }
  for (const path of ['/dashboard', '/budget', '/bills', '/calendar']) {
    for (const dir of ['Previous', 'Next']) {
      await page.goto(DEMO + path);
      await settle(page);
      for (let i = 0; i < 6; i++) {
        const step = page.getByRole('button', { name: new RegExp(`^${dir} (period|month)$`) }).first();
        if (!(await step.isVisible())) break;
        await step.click();
        await settle(page);
      }
    }
  }
  // Detail pages, reached the way a visitor would.
  await page.goto(`${DEMO}/accounts`);
  await page.locator('main a[href*="/accounts/"]').first().click();
  await settle(page);
  await page.goto(`${DEMO}/debts`);
  await page.locator('main a[href*="/debts/"]').first().click();
  await settle(page);
  await page.getByRole('spinbutton').or(page.locator('main input[inputmode="decimal"]')).first().fill('123');
  await settle(page);

  expect(await misses(page)).toEqual([]);
  expect(errors).toEqual([]);
  expect(overflow, 'pages that scroll sideways').toEqual([]);
});

test('transactions filter and page in the browser', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the fake API is the same on every screen; the table is desktop-only');
  await page.goto(`${DEMO}/transactions`);
  const rows = page.locator('main tbody tr');
  await expect(rows.first()).toBeVisible();
  await page.getByLabel('Search transactions').fill('woolworths');
  await page.getByLabel('Search transactions').press('Enter');
  await expect(page).toHaveURL(/search=woolworths/);
  await settle(page);
  const texts = await rows.allInnerTexts();
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) expect(t.toLowerCase()).toContain('woolworths');
});

test('saving is refused politely; the demo passes axe', async ({ page }, info) => {
  await page.goto(`${DEMO}/categories`);
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog').getByText(/This demo is read-only/)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`${DEMO}/dashboard`);
  await settle(page);
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map((x) => x.id);
  expect(v).toEqual([]);
  await page.screenshot({ path: `test-results/static-demo-dashboard-${info.project.name}.png` });
});
