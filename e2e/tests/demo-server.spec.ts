import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Runs against a server started with DEMO_MODE=true:  E2E_DEMO_SERVER=1 npx playwright test demo-server */
test.skip(!process.env.E2E_DEMO_SERVER, 'set E2E_DEMO_SERVER=1 and point E2E_BASE_URL at a DEMO_MODE server');

test('a visitor starts their own demo; outside features are off', async ({ page }, info) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Try BucketNest' })).toBeVisible();
  await page.screenshot({ path: `test-results/demo-login-${info.project.name}.png` });
  await page.getByRole('link', { name: 'Start the demo' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note').filter({ hasText: 'Demo' })).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', /github\.com/);
  if (info.project.name === 'mobile') await page.keyboard.press('Escape');
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map((x) => x.id);
  expect(v).toEqual([]);
  await page.screenshot({ path: `test-results/demo-dashboard-${info.project.name}.png` });
  await page.goto('/settings?section=Bank feeds');
  await page.getByLabel('Personal access token').fill('up:yeah:abc');
  await page.getByRole('button', { name: 'Connect Up' }).click();
  await expect(page.getByText(/isn’t available in the demo/)).toBeVisible();
});
