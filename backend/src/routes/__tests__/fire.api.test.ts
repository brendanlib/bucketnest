import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bucketIds, categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
let main: { id: string };
const clock = new TestClock();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-05T01:00:00Z'); // 5 Oct 2026, midday in Melbourne
  app = await createTestApp({ clock });
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000, openingDate: '2026-01-01' });
});
afterEach(async () => {
  await app.close();
});

/** Moves the clock and logs in fresh (a long jump correctly expires the old session). */
async function jumpTo(iso: string) {
  clock.current = new Date(iso);
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000, openingDate: '2026-01-01' });
}

describe('sinking funds', () => {
  it('recommends $50 a month for $900 rego with $300 saved and 12 months to go (spec §9)', async () => {
    const rego = await categoryId(client, 'Car registration (rego)');
    const res = await client.post('/api/sinking-funds', {
      name: 'Car rego', targetCents: 90000, dueDate: '2027-10-04', contributionFrequency: 'MONTHLY', contributionAnchorDate: '2026-10-15',
      categoryId: rego, manualCurrentCents: 30000,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ targetCents: 90000, currentCents: 30000, currentSource: 'contributions', remainingCents: 60000, datesLeft: 12, recommendedContributionCents: 5000, status: 'on_track', bucketKey: 'BILLS' });
  });

  it('tracks contributions without an account, and payments from the fund', async () => {
    const fund = (await client.post('/api/sinking-funds', { name: 'Christmas', targetCents: 60000, dueDate: '2026-12-20', contributionFrequency: 'FORTNIGHTLY', contributionAnchorDate: '2026-10-08' })).body;
    expect(fund).toMatchObject({ datesLeft: 6, recommendedContributionCents: 10000 });
    const after = await client.post(`/api/sinking-funds/${fund.id}/contributions`, { amountCents: 25000, date: '2026-10-08' });
    expect(after.status).toBe(201);
    expect(after.body).toMatchObject({ currentCents: 25000, remainingCents: 35000, recommendedContributionCents: 5834 });
    expect(after.body.contributions).toHaveLength(1);

    const gifts = await categoryId(client, 'Gifts');
    await client.post('/api/transactions', { date: '2026-10-10', description: 'Presents', amountCents: 5000, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: gifts, amountCents: 5000, sinkingFundId: fund.id }] });
    const fresh = (await client.get(`/api/sinking-funds/${fund.id}`)).body;
    expect(fresh).toMatchObject({ currentCents: 20000, paymentsCents: 5000, contributionsCents: 25000 });

    const removed = await client.delete(`/api/sinking-funds/${fund.id}/contributions/${after.body.contributions[0].id}`);
    expect(removed.body.currentCents).toBe(-5000);
  });

  it('moves money into a linked account, or links a transfer already recorded', async () => {
    const savings = await createAccount(client, { name: 'Bills saver', type: 'SAVINGS', openingBalanceCents: 10000 });
    const fund = (await client.post('/api/sinking-funds', { name: 'Insurance', targetCents: 120000, dueDate: '2027-03-01', contributionFrequency: 'MONTHLY', accountId: savings.id })).body;
    expect(fund).toMatchObject({ currentCents: 10000, currentSource: 'account' });
    expect((await client.post(`/api/sinking-funds/${fund.id}/contributions`, { amountCents: 20000, date: '2026-10-05' })).status).toBe(400); // needs a from-account
    const moved = await client.post(`/api/sinking-funds/${fund.id}/contributions`, { amountCents: 20000, date: '2026-10-05', fromAccountId: main.id });
    expect(moved.body).toMatchObject({ currentCents: 30000, contributionsCents: 20000 });
    expect((await client.get(`/api/accounts/${main.id}`)).body.balanceCents).toBe(980000);

    const t = (await client.post('/api/transactions', { date: '2026-10-06', description: 'Top up', amountCents: 5000, type: 'TRANSFER', accountId: main.id, toAccountId: savings.id })).body;
    const linked = await client.post(`/api/sinking-funds/${fund.id}/contributions`, { transactionId: t.id, date: '2026-10-06' });
    expect(linked.body.contributionsCents).toBe(25000);
    expect((await client.post(`/api/sinking-funds/${fund.id}/contributions`, { transactionId: t.id, date: '2026-10-06' })).status).toBe(400);
    // Deleting the transfer removes its contribution too.
    await client.delete(`/api/transactions/${t.id}`);
    expect((await client.get(`/api/sinking-funds/${fund.id}`)).body.contributionsCents).toBe(20000);
  });

  it('takes the target and due date from a linked bill and rolls forward after it is paid (spec §9)', async () => {
    const rego = await categoryId(client, 'Car registration (rego)');
    const bill = (await client.post('/api/recurring-transactions', { name: 'Rego', type: 'EXPENSE', amountCents: 90000, frequency: 'ANNUALLY', startDate: '2026-12-15', accountId: main.id, categoryId: rego })).body;
    const fund = (await client.post('/api/sinking-funds', { name: 'Rego fund', recurringId: bill.id, contributionFrequency: 'MONTHLY', contributionAnchorDate: '2026-10-15' })).body;
    expect(fund).toMatchObject({ targetCents: 90000, dueDate: '2026-12-15', targetSource: 'schedule', categoryId: rego, datesLeft: 2, recommendedContributionCents: 45000 });

    await client.post(`/api/recurring-transactions/${bill.id}/occurrences/2026-12-15/post`);
    const rolled = (await client.get(`/api/sinking-funds/${fund.id}`)).body;
    expect(rolled.dueDate).toBe('2027-12-15');
  });

  it('flags a fund that is due and short', async () => {
    await jumpTo('2026-12-01T01:00:00Z');
    const fund = (await client.post('/api/sinking-funds', { name: 'Holiday', targetCents: 100000, dueDate: '2026-12-01', contributionFrequency: 'MONTHLY', repeats: false, manualCurrentCents: 40000 })).body;
    expect(fund).toMatchObject({ status: 'due_short', shortfallCents: 60000, datesLeft: 0, recommendedContributionCents: 60000 });
    const soon = (await client.post('/api/sinking-funds', { name: 'Gift', targetCents: 10000, dueDate: '2026-12-20', contributionFrequency: 'WEEKLY' })).body;
    expect(soon.status).toBe('due_soon');
    const dash = (await client.get('/api/dashboard')).body;
    expect(dash.watch.map((w: { name: string; status: string }) => [w.name, w.status])).toEqual([
      ['Holiday', 'due_short'],
      ['Gift', 'due_soon'],
    ]);
  });

  it('a $900 rego paid from its fund does not show December as over budget (spec §9)', async () => {
    await jumpTo('2026-12-16T01:00:00Z');
    const rego = await categoryId(client, 'Car registration (rego)');
    const fund = (await client.post('/api/sinking-funds', { name: 'Rego fund', targetCents: 90000, dueDate: '2027-12-15', contributionFrequency: 'MONTHLY', contributionAnchorDate: '2026-12-01', categoryId: rego, manualCurrentCents: 90000 })).body;
    await client.post('/api/sinking-funds/' + fund.id + '/contributions', { amountCents: 7500, date: '2026-12-01' });
    await client.post('/api/transactions', { date: '2026-12-15', description: 'Rego', amountCents: 90000, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: rego, amountCents: 90000, sinkingFundId: fund.id }] });
    const budget = (await client.get('/api/budgets')).body.items[0];
    const summary = (await client.get(`/api/budgets/${budget.id}/summary`)).body;
    const lines = summary.buckets.find((b: { key: string }) => b.key === 'BILLS').groups.flatMap((g: { lines: unknown[] }) => g.lines);
    const fundLine = lines.find((l: { sinkingFundId?: string }) => l.sinkingFundId === fund.id);
    expect(fundLine).toMatchObject({ name: 'Rego fund', actualCents: 7500 });
    expect(lines.find((l: { categoryId: string; sinkingFundId?: string }) => l.categoryId === rego && !l.sinkingFundId)).toBeUndefined(); // the bill itself is not a variance
    expect(summary.total.actualCents).toBe(7500);
    // The payment still appears in the category's history.
    expect((await client.get(`/api/transactions?categoryId=${rego}`)).body.total).toBe(1);
  });

  it('validates funds', async () => {
    expect((await client.post('/api/sinking-funds', { name: 'x', contributionFrequency: 'MONTHLY' })).status).toBe(400);
    expect((await client.post('/api/sinking-funds', { name: 'x', targetCents: 100, dueDate: '2027-01-01', contributionFrequency: 'EVERY_N_WEEKS' })).status).toBe(400);
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD' });
    expect((await client.post('/api/sinking-funds', { name: 'x', targetCents: 100, dueDate: '2027-01-01', contributionFrequency: 'MONTHLY', accountId: card.id })).status).toBe(400);
    expect((await client.post('/api/sinking-funds', { name: 'x', targetCents: 100, dueDate: '2027-01-01', contributionFrequency: 'MONTHLY', categoryId: await categoryId(client, 'Bonus') })).status).toBe(400);
  });
});

describe('goals', () => {
  it('tracks progress, required contribution and projected completion (spec §10)', async () => {
    const ids = await bucketIds(client);
    const emergency = await createAccount(client, { name: 'Emergency', type: 'SAVINGS', bucketTagId: ids.FIRE_EXTINGUISHER, openingBalanceCents: 250000 });
    const goal = await client.post('/api/goals', {
      name: 'Three months of expenses', type: 'EMERGENCY_FUND', targetCents: 1000000, targetDate: '2027-09-30', accountId: emergency.id,
      contributionCents: 50000, contributionFrequency: 'MONTHLY',
    });
    expect(goal.status).toBe(201);
    expect(goal.body).toMatchObject({ currentCents: 250000, currentSource: 'account', progressPercent: 25, remainingCents: 750000, reached: false, onTrack: false });
    expect(goal.body.requiredContributionCents).toBeGreaterThan(50000);

    await client.post('/api/transactions', { date: '2026-10-05', description: 'Save', amountCents: 50000, type: 'SAVINGS_CONTRIBUTION', accountId: main.id, toAccountId: emergency.id, goalId: goal.body.id });
    const after = (await client.get(`/api/goals/${goal.body.id}`)).body;
    expect(after).toMatchObject({ currentCents: 300000, contributedCents: 50000, progressPercent: 30 });

    const manual = (await client.post('/api/goals', { name: 'Shares', type: 'INVESTMENT', targetCents: 500000, manualCurrentCents: 600000 })).body;
    expect(manual).toMatchObject({ reached: true, currentSource: 'manual' });
    const list = (await client.get('/api/goals')).body.items;
    expect(list.map((g: { name: string }) => g.name)).toEqual(['Three months of expenses', 'Shares']);
    expect((await client.get('/api/dashboard')).body.buckets.find((b: { key: string }) => b.key === 'FIRE_EXTINGUISHER').fire.goals).toHaveLength(2);

    expect((await client.put(`/api/goals/${manual.id}`, { name: 'Shares', type: 'INVESTMENT', targetCents: 500000, contributionCents: 100 })).status).toBe(400);
    expect((await client.delete(`/api/goals/${manual.id}`)).status).toBe(204);
  });
});

describe('debts', () => {
  async function mortgage(extra: Record<string, unknown> = {}) {
    const loan = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 30000000, openingDate: '2026-01-01' });
    const res = await client.post('/api/debts', { accountId: loan.id, annualRate: '6.00', minRepaymentCents: 179865, repaymentFrequency: 'MONTHLY', dueDay: 15, ...extra });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return { loan, debt: res.body };
  }

  it('creates a profile on a liability and projects the payoff', async () => {
    const { debt } = await mortgage();
    expect(debt).toMatchObject({ originalBalanceCents: 30000000, currentBalanceCents: 30000000, annualRate: '6.0000', percentRepaid: 0, warning: null, indexationOnly: false, includeInPayoff: true });
    expect(debt.payoffDate >= '2056-01-01').toBe(true);
    expect(debt.nextInterestCents).toBe(147945); // 15 Sep – 15 Oct: 30 days
    expect((await client.post('/api/debts', { accountId: debt.accountId, annualRate: 6, minRepaymentCents: 1, repaymentFrequency: 'MONTHLY' })).body.error.code).toBe('DEBT_EXISTS');
    expect((await client.post('/api/debts', { accountId: main.id, annualRate: 6, minRepaymentCents: 1, repaymentFrequency: 'MONTHLY' })).status).toBe(400);
  });

  it('compares minimum-only with extra repayments (spec §10)', async () => {
    const { debt } = await mortgage();
    const res = await client.get(`/api/debts/${debt.id}/payoff?extraCents=50000`);
    expect(res.status).toBe(200);
    expect(res.body.extraCents).toBe(50000);
    expect(res.body.monthsSaved).toBeGreaterThan(90);
    expect(res.body.interestSavedCents).toBeGreaterThan(10000000);
    expect(res.body.withExtra.schedule.length).toBeLessThan(res.body.minimum.schedule.length);
  });

  it('reduces interest by linked offset accounts', async () => {
    const { loan, debt } = await mortgage();
    await createAccount(client, { name: 'Offset', type: 'OFFSET', openingBalanceCents: 5000000, offsetForAccountId: loan.id });
    const after = (await client.get(`/api/debts/${debt.id}`)).body;
    expect(after.offsetCents).toBe(5000000);
    expect(after.nextInterestCents).toBe(123288); // (300,000 − 50,000) × 6% × 30 ÷ 365
    expect(after.offsetAccounts).toHaveLength(1);
    expect(after.payoffDate < debt.payoffDate).toBe(true);
  });

  it('warns when the repayment does not cover the interest', async () => {
    const { debt } = await mortgage({ minRepaymentCents: 100000 });
    expect(debt).toMatchObject({ warning: 'REPAYMENT_TOO_LOW', payoffDate: null });
  });

  it('reports principal reduced this period from actual repayments and interest', async () => {
    const { loan, debt } = await mortgage();
    await client.post('/api/transactions', { date: '2026-10-02', description: 'Repay', amountCents: 300000, type: 'DEBT_REPAYMENT', accountId: main.id, toAccountId: loan.id });
    await client.post('/api/transactions', { date: '2026-10-03', description: 'Interest', amountCents: 150000, type: 'INTEREST_CHARGE', accountId: loan.id });
    const after = (await client.get(`/api/debts/${debt.id}`)).body;
    expect(after).toMatchObject({ principalReducedThisPeriodCents: 150000, currentBalanceCents: 29850000, repaidCents: 150000, percentRepaid: 0.5 });
    // The repayment split used the profile's minimum.
    const tx = (await client.get('/api/transactions?type=DEBT_REPAYMENT')).body.items[0];
    expect(tx.splits.map((s: { amountCents: number }) => s.amountCents)).toEqual([179865, 120135]);
  });

  it('defaults HECS/HELP to indexation and leaves it out of payoff planning', async () => {
    const hecs = await createAccount(client, { name: 'HECS', type: 'HECS_HELP', openingBalanceCents: 2500000 });
    const d = (await client.post('/api/debts', { accountId: hecs.id, annualRate: '3.2', minRepaymentCents: 0, repaymentFrequency: 'ANNUALLY' })).body;
    expect(d).toMatchObject({ indexationOnly: true, includeInPayoff: false });
    const plan = (await client.get('/api/debts/plan')).body;
    expect(plan.debts).toEqual([]);
  });

  it('plans payoff order and rolls repayments into the next debt (spec §10)', async () => {
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD', openingBalanceCents: 300000 });
    const car = await createAccount(client, { name: 'Car', type: 'CAR_LOAN', openingBalanceCents: 1500000 });
    await client.post('/api/debts', { accountId: card.id, annualRate: '20', minRepaymentCents: 10000, repaymentFrequency: 'MONTHLY', extraRepaymentCents: 50000 });
    await client.post('/api/debts', { accountId: car.id, annualRate: '8', minRepaymentCents: 20000, repaymentFrequency: 'FORTNIGHTLY' });
    const plan = (await client.get('/api/debts/plan')).body;
    expect(plan).toMatchObject({ strategy: 'SNOWBALL', extraMonthlyCents: 50000 });
    expect(plan.debts.map((d: { name: string }) => d.name)).toEqual(['Visa', 'Car']);
    expect(plan.debts[0].payoffDate < plan.debts[1].payoffDate).toBe(true);
    expect(plan.alternative.strategy).toBe('AVALANCHE');
    const custom = (await client.get('/api/debts/plan?strategy=AVALANCHE&extraMonthlyCents=0')).body;
    expect(custom).toMatchObject({ strategy: 'AVALANCHE', extraMonthlyCents: 0 });
  });

  it('updates and deletes a profile', async () => {
    const { debt } = await mortgage();
    const upd = await client.put(`/api/debts/${debt.id}`, { accountId: debt.accountId, annualRate: '5.5', minRepaymentCents: 179865, repaymentFrequency: 'MONTHLY', extraRepaymentCents: 20000, dueDay: 15 });
    expect(upd.body).toMatchObject({ annualRate: '5.5000', extraRepaymentCents: 20000 });
    expect(upd.body.minimumOnlyPayoffDate > upd.body.payoffDate).toBe(true);
    expect((await client.delete(`/api/debts/${debt.id}`)).status).toBe(204);
    expect((await client.get('/api/debts')).body.items).toEqual([]);
  });
});

describe('isolation', () => {
  it('keeps funds, goals and debts per household', async () => {
    const fund = (await client.post('/api/sinking-funds', { name: 'Mine', targetCents: 100, dueDate: '2027-01-01', contributionFrequency: 'MONTHLY' })).body;
    const goal = (await client.post('/api/goals', { name: 'Mine', type: 'SAVINGS', targetCents: 100 })).body;
    const loan = await createAccount(client, { name: 'Loan', type: 'PERSONAL_LOAN', openingBalanceCents: 100000 });
    const debt = (await client.post('/api/debts', { accountId: loan.id, annualRate: '9', minRepaymentCents: 10000, repaymentFrequency: 'MONTHLY' })).body;
    const b = (await registerUser(app)).client;
    for (const [url, body] of [
      [`/api/sinking-funds/${fund.id}`, { name: 'x', targetCents: 1, dueDate: '2027-01-01', contributionFrequency: 'MONTHLY' }],
      [`/api/goals/${goal.id}`, { name: 'x', type: 'SAVINGS', targetCents: 1 }],
      [`/api/debts/${debt.id}`, { accountId: loan.id, annualRate: 1, minRepaymentCents: 1, repaymentFrequency: 'MONTHLY' }],
    ] as const) {
      expect((await b.get(url)).status, url).toBe(404);
      expect((await b.put(url, body as never)).status, url).toBe(404);
      expect((await b.delete(url)).status, url).toBe(404);
    }
    expect((await b.post(`/api/sinking-funds/${fund.id}/contributions`, { amountCents: 1, date: '2026-10-05' })).status).toBe(404);
    expect((await b.get(`/api/debts/${debt.id}/payoff`)).status).toBe(404);
    expect((await b.post('/api/debts', { accountId: loan.id, annualRate: 1, minRepaymentCents: 1, repaymentFrequency: 'MONTHLY' })).status).toBe(400);
    expect((await b.get('/api/sinking-funds')).body.items).toEqual([]);
    expect((await b.get('/api/goals')).body.items).toEqual([]);
    expect((await b.get('/api/debts')).body.items).toEqual([]);
    const own = await createAccount(b, { name: 'B', type: 'TRANSACTION' });
    const spend = await b.post('/api/transactions', { date: '2026-10-05', description: 'x', amountCents: 100, type: 'EXPENSE', accountId: own.id, splits: [{ categoryId: await categoryId(b, 'Gifts'), amountCents: 100, sinkingFundId: fund.id }] });
    expect(spend.status).toBe(400);
  });
});
