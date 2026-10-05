import type { Deps } from './context.js';
import { createAuthService } from './auth.service.js';
import { createSettingsService } from './settings.service.js';
import { createBucketService } from './bucket.service.js';
import { createCategoryService } from './category.service.js';
import { createAccountService } from './account.service.js';
import { createTransactionService } from './transaction.service.js';
import { createRecurringService } from './recurring.service.js';
import { createBudgetService } from './budget.service.js';
import { createDashboardService } from './dashboard.service.js';
import { createRuleService } from './rule.service.js';
import { createImportService } from './import.service.js';
import { createSinkingFundService } from './sinking-fund.service.js';
import { createGoalService } from './goal.service.js';
import { createDebtService } from './debt.service.js';

export function createServices(deps: Deps) {
  const transactions = createTransactionService(deps);
  const accounts = createAccountService(deps);
  // eslint-disable-next-line prefer-const
  let sinkingFunds: ReturnType<typeof createSinkingFundService>;
  const budgets = createBudgetService(deps, () => sinkingFunds);
  sinkingFunds = createSinkingFundService(deps, transactions);
  const goals = createGoalService(deps, transactions);
  const debts = createDebtService(deps, { transactions, budgets });
  const recurring = createRecurringService(deps, transactions);
  const rules = createRuleService(deps, transactions);
  return {
    sinkingFunds,
    goals,
    debts,
    rules,
    imports: createImportService(deps, { transactions, recurring, rules }),
    auth: createAuthService(deps),
    settings: createSettingsService(deps),
    buckets: createBucketService(deps),
    categories: createCategoryService(deps),
    accounts,
    transactions,
    budgets,
    recurring,
    dashboard: createDashboardService(deps, { budgets, recurring, accounts, transactions, sinkingFunds, goals }),
  };
}

export type Services = ReturnType<typeof createServices>;
