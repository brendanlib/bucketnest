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

export function createServices(deps: Deps) {
  const transactions = createTransactionService(deps);
  const accounts = createAccountService(deps);
  const budgets = createBudgetService(deps);
  const recurring = createRecurringService(deps, transactions);
  const rules = createRuleService(deps, transactions);
  return {
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
    dashboard: createDashboardService(deps, { budgets, recurring, accounts, transactions }),
  };
}

export type Services = ReturnType<typeof createServices>;
