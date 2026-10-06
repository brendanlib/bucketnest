import { expect, test } from '@playwright/test';

test('rename, add and remove buckets', async ({ page }, testInfo) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Robin');
  await page.getByLabel('Email').fill(`buckets-${testInfo.project.name}-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.keyboard.press('Escape');

  await page.goto('/settings?section=Budget');
  // Rename the saving bucket; the menu follows.
  await page.getByLabel('Name of bucket 4').fill('Savings');
  await page.getByRole('button', { name: 'Save buckets' }).click();
  await expect(page.getByText('Buckets saved')).toBeVisible();
  await page.goto('/fire-extinguisher');
  await expect(page.getByRole('heading', { level: 1, name: 'Savings' })).toBeVisible();
  await page.goto('/settings?section=Budget');

  // Add a bucket, then give it a share.
  await page.getByLabel('Add a bucket').fill('Kids');
  await page.getByRole('button', { name: 'Add bucket' }).click();
  await expect(page.getByText('Kids added at 0%')).toBeVisible();
  await expect(page.getByLabel('Name of bucket 2')).toHaveValue('Kids'); // new buckets go in after Bills
  await page.getByLabel('Bills percentage').fill('55');
  await page.getByLabel('Kids percentage').fill('5');
  await expect(page.getByTestId('percentage-total')).toHaveText('100.00%');
  await page.getByRole('button', { name: 'Save buckets' }).click();
  await expect(page.getByText('Buckets saved')).toBeVisible();

  // The budget table's bucket rows stay table rows (a class clash once made them grids).
  if (testInfo.project.name === 'desktop') {
    await page.goto('/budget');
    const row = page.locator('.budget-table tr.bucket-row').first();
    await expect(row).toContainText('Bills');
    expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('table-row');
  }

  await page.goto('/dashboard');
  await expect(page.getByRole('article', { name: 'Kids' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Savings' })).toBeVisible();
  await page.screenshot({ path: `test-results/buckets-dashboard-${testInfo.project.name}.png`, fullPage: true });

  // Remove it again; its share goes to Smile.
  await page.goto('/settings?section=Budget');
  await page.screenshot({ path: `test-results/buckets-editor-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Remove Kids' }).click();
  await page.getByLabel('Move everything to').selectOption({ label: 'Smile' });
  await page.getByRole('button', { name: 'Remove and move to Smile' }).click();
  await expect(page.getByText(/Bucket removed/)).toBeVisible();
  await expect(page.getByLabel('Smile percentage')).toHaveValue('15.00');
  await expect(page.getByRole('button', { name: 'Remove Bills' })).toHaveCount(0);
});
