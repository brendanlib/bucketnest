import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** What an authenticator app does: RFC 6238, SHA-1, 30 s, 6 digits. */
function totp(base32: string, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32.replace(/\s/g, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}

const PASSWORD = 'correct horse battery staple';
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`);

test('turn on two-step sign-in, then sign in with a code and with a recovery code', async ({ page }, info) => {
  const email = `mfa-${info.project.name}-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Morgan');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.keyboard.press('Escape');

  await page.goto('/settings?section=Security');
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `test-results/mfa-setup-${info.project.name}.png` });
  await page.getByText('Can’t scan it? Enter this key instead').click();
  const secret = (await page.locator('.secret-key').textContent())!.replace(/\s/g, '');
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();

  await expect(page.locator('.recovery-codes code')).toHaveCount(10);
  const codes = (await page.locator('.recovery-codes code').allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(10);
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
  await page.getByLabel('I’ve saved these codes').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();

  // Sign out and back in: password, then a code (the next step's, since the setup code is used).
  const signIn = async () => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
  };
  await signIn();
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `test-results/mfa-login-${info.project.name}.png` });
  await page.getByLabel('6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/That code didn’t work/)).toBeVisible();
  await page.getByLabel('6-digit code').fill(totp(secret, 1));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // And with a recovery code instead.
  await signIn();
  await page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
  await page.getByLabel('Recovery code').fill(codes[0]!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/settings?section=Security');
  await expect(page.getByText(/9 recovery codes left/)).toBeVisible();
});
