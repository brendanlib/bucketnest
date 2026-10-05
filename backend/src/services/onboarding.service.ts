import type { Deps } from './context.js';
import type { BudgetService } from './budget.service.js';
import { notFound } from '../lib/errors.js';

export const ONBOARDING_TIP = 'getting-started';
export const WELCOME_TIP = 'welcome';
const MAX_TIPS = 100;

export type StepKey = 'accounts' | 'income' | 'bills' | 'budget' | 'transactions' | 'savings';

/** The getting-started checklist. Each step is done when the data says so, never by ticking a box. */
export function createOnboardingService(deps: Deps, budgets: BudgetService) {
  const { db } = deps;

  async function tipsOf(userId: string) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { dismissedTips: true } });
    if (!u) throw notFound('User');
    return u.dismissedTips;
  }

  return {
    async status(householdId: string, userId: string) {
      const budget = await budgets.ensureActive(householdId);
      const [accounts, income, bills, items, transactions, funds, goals, tips] = await Promise.all([
        db.account.count({ where: { householdId } }),
        db.recurringTransaction.count({ where: { householdId, type: 'INCOME' } }),
        db.recurringTransaction.count({ where: { householdId, type: { in: ['EXPENSE', 'DEBT_REPAYMENT'] } } }),
        db.budgetItem.count({ where: { householdId, budgetId: budget.id, category: { kind: 'EXPENSE' } } }),
        db.transaction.count({ where: { householdId } }),
        db.sinkingFund.count({ where: { householdId } }),
        db.financialGoal.count({ where: { householdId } }),
        tipsOf(userId),
      ]);
      const steps: { key: StepKey; done: boolean }[] = [
        { key: 'accounts', done: accounts > 0 },
        { key: 'income', done: income > 0 },
        { key: 'bills', done: bills > 0 },
        { key: 'budget', done: items > 0 },
        { key: 'transactions', done: transactions > 0 },
        { key: 'savings', done: funds + goals > 0 },
      ];
      const completed = steps.filter((s) => s.done).length;
      return {
        dismissed: tips.includes(ONBOARDING_TIP),
        showWelcome: !tips.includes(WELCOME_TIP) && completed === 0,
        steps,
        completed,
        total: steps.length,
      };
    },

    tipsOf,

    async dismiss(userId: string, key: string) {
      const tips = await tipsOf(userId);
      if (tips.includes(key)) return tips;
      const next = [...tips, key].slice(-MAX_TIPS);
      await db.user.update({ where: { id: userId }, data: { dismissedTips: next } });
      return next;
    },

    async reset(userId: string) {
      await db.user.update({ where: { id: userId }, data: { dismissedTips: [] } });
      return [] as string[];
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
