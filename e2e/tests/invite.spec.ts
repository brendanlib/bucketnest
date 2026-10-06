import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

/** Two people, two browsers: the owner invites, the other person joins and sees the same budget. */
const PASSWORD = 'correct horse battery staple';

async function register(page: Page, name: string, email: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.keyboard.press('Escape'); // the first-login welcome
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test('owner invites a partner, who joins and sees the same budget', async ({ page, browser }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  await register(page, 'Alex', `alex-${stamp}@example.com`);
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  await page.getByLabel('Name').fill('Joint account');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: /Joint account/ })).toBeVisible();

  await page.goto('/settings?section=Household');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = await page.getByLabel('Invite link').inputValue();
  expect(link).toMatch(/\/invite#.{43}$/);

  // The partner, in their own browser.
  const partner = await newPage(browser);
  await partner.goto(link);
  await expect(partner.getByRole('heading', { name: /Join Alex.s household/ })).toBeVisible();
  await expect(partner).toHaveURL(/\/invite$/); // the code is out of the address bar
  const axe = await new AxeBuilder({ page: partner }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await partner.screenshot({ path: `test-results/invite-join-${testInfo.project.name}.png` });
  await partner.getByLabel('Your name').fill('Sam');
  await partner.getByLabel('Email').fill(`sam-${stamp}@example.com`);
  await partner.getByLabel('Password').fill(PASSWORD);
  await partner.getByRole('button', { name: 'Create account and join' }).click();
  await expect(partner).toHaveURL(/\/dashboard/);
  await partner.keyboard.press('Escape');
  await partner.goto('/accounts');
  await expect(partner.getByRole('link', { name: /Joint account/ })).toBeVisible();

  // The link can't be used twice.
  const third = await newPage(browser);
  await third.goto(link);
  await expect(third.getByRole('heading', { name: 'This invite can’t be used' })).toBeVisible();

  // The owner sees the new member.
  await page.reload();
  await expect(page.getByText('Sam', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/invite-members-${testInfo.project.name}.png`, fullPage: true });
});

test('someone with their own household joins and switches between the two', async ({ page, browser }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  await register(page, 'Pat', `pat-${stamp}@example.com`);
  await page.goto('/settings?section=Household');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = await page.getByLabel('Invite link').inputValue();

  const jo = await newPage(browser);
  await register(jo, 'Jo', `jo-${stamp}@example.com`);
  await jo.goto(link);
  await jo.getByRole('button', { name: /Join Pat.s household/ }).click();
  await expect(jo).toHaveURL(/\/dashboard/);
  const switcher = jo.getByLabel('Household');
  await expect(switcher.locator('option:checked')).toHaveText(/Pat.s household/);
  await switcher.selectOption({ label: "Jo's household" });
  await expect(jo.getByText("Now working in Jo's household")).toBeVisible();
});
