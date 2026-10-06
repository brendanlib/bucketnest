import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility scan (WCAG 2.2 AA rules) of every page, filled with the demo household.
 * Needs the demo data: SEED_DEMO=true or `npm run seed:demo`, then
 *   E2E_DEMO_PASSWORD=... npx playwright test a11y
 */
const password = process.env.E2E_DEMO_PASSWORD;
test.skip(!password, 'set E2E_DEMO_PASSWORD to the demo login to run the accessibility scan');

const PAGES = [
  '/dashboard', '/calendar', '/reports', '/net-worth', '/transactions', '/accounts', '/budget', '/bills',
  '/sinking-funds', '/recurring', '/import', '/fire-extinguisher', '/debts', '/categories', '/rules',
  '/settings', '/settings?section=Notifications', '/settings?section=Data', '/settings?section=Security', '/settings?section=Household',
];

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const problems = results.violations.map((v) => `${label}: ${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`);
  return problems;
}

test('every page passes axe, in light and dark themes, with no console errors', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/login');
  expect(await scan(page, '/login')).toEqual([]);
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/dashboard/);

  const problems: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      problems.push(...(await scan(page, `${scheme} ${path}`)));
    }
  }
  // A form dialog and the notification panel.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  problems.push(...(await scan(page, 'transaction form')));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  problems.push(...(await scan(page, 'notifications panel')));

  expect(problems, problems.join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});
