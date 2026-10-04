import { expect, test } from '@playwright/test';

test('register → add account → add transaction → dashboard updates', async ({ page }, testInfo) => {
  const email = `smoke-${testInfo.project.name}-${Date.now()}@example.com`;

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Smoke Test');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/accounts/);

  await page.getByRole('button', { name: 'Add account' }).first().click();
  await page.getByLabel('Name').fill('Everyday');
  await page.getByLabel('Opening balance').fill('1,000.00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: /Everyday/ })).toContainText('$1,000.00');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('$42.50');
  await page.getByLabel('Description').fill('Groceries run');
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday' });
  await page.getByLabel('Category 1').selectOption({ label: 'Groceries' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Groceries run').filter({ visible: true }).first()).toBeVisible();

  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: /Everyday/ })).toContainText('$957.50');

  // The dashboard's Bills bucket now shows the spending.
  await page.goto('/dashboard');
  const bills = page.getByRole('article', { name: 'Bills' });
  await expect(bills).toContainText('$42.50');

  // Data survives a reload (server-side state, not browser storage).
  await page.reload();
  await expect(page.getByRole('article', { name: 'Bills' })).toContainText('$42.50');
});
