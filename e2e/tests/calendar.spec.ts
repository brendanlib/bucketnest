import { expect, test, type Page } from '@playwright/test';

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function setup(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Cal');
  await page.getByLabel('Email').fill(`${name}-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.keyboard.press('Escape');
  // An account and a monthly bill on the 25th, through the API like the forms do.
  return page.evaluate(async () => {
    const { csrfToken } = await (await fetch('/api/auth/csrf')).json();
    const call = async (path: string, body: unknown) =>
      (await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) })).json();
    const now = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const account = await call('/accounts', { name: 'Everyday', type: 'TRANSACTION', openingBalanceCents: 100000, openingDate: first });
    const cats = (await (await fetch('/api/categories')).json()).items as { id: string; name: string; isGroup: boolean }[];
    const gym = cats.find((c) => c.name === 'Hobbies' && !c.isGroup)!.id;
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-25`;
    await call('/recurring-transactions', { name: 'Gym', type: 'EXPENSE', amountCents: 4500, frequency: 'MONTHLY', startDate: start, accountId: account.id, categoryId: gym });
    return start;
  });
}

/** A day in the grid by its full date (the grid also shows the ends of the months either side). */
const dayButton = (page: Page, date: string) => {
  const month = new Intl.DateTimeFormat('en-AU', { month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  return page.getByRole('button', { name: new RegExp(`^\\w+ ${Number(date.slice(8))} ${month} ${date.slice(0, 4)}`) });
};

test('paid bills are struck through, can be hidden; reschedule and move to next period', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the month grid is the desktop view');
  const start = await setup(page, 'cal');
  await page.goto('/calendar');

  // Pay this month's: only that one is struck through.
  await dayButton(page, start).click();
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByRole('dialog', { name: /Pay Gym/ }).getByRole('button', { name: /Save|Record/ }).click();
  await expect(page.getByText(/Recorded|Transaction added/)).toBeVisible();
  await page.keyboard.press('Escape');
  const paid = page.locator('.cal-grid .cal-item.posted', { hasText: 'Gym' });
  await expect(paid).toHaveCount(1);
  await expect(paid).toHaveCSS('text-decoration-line', 'line-through');
  await page.screenshot({ path: `test-results/calendar-paid-${info.project.name}.png` });

  await page.getByRole('button', { name: 'Hide paid' }).click();
  await expect(page.locator('.cal-grid .cal-item', { hasText: 'Gym' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show paid' }).click();

  // Next month: still scheduled. Reschedule it two days later.
  await page.getByRole('button', { name: 'Next month' }).click();
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  await dayButton(page, iso(next)).click();
  await page.getByRole('button', { name: 'Reschedule this Gym' }).click();
  const later = new Date(next.getTime() + 2 * 86_400_000);
  const d = iso(later);
  await page.getByLabel('New date').fill(`${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByText(/Gym moved to/)).toBeVisible();
  await page.keyboard.press('Escape');
  await dayButton(page, d).click();
  await expect(page.getByText(/moved from/)).toBeVisible();

  // Skip → move to the next period: it leaves this month.
  await page.getByRole('button', { name: 'Skip…' }).click();
  await page.getByRole('button', { name: /Move to the next period/ }).click();
  await expect(page.getByText(/Gym moved to/)).toBeVisible();
  await page.keyboard.press('Escape');
  // Gone from its day (the grid's trailing days may already show it on the 1st of next month).
  await expect.poll(async () => dayButton(page, d).getAttribute('aria-label')).not.toMatch(/item/);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.locator('.cal-grid .cal-item', { hasText: 'Gym' })).toHaveCount(2); // the moved one on the 1st, plus that month's own
});
