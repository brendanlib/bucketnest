import type { Deps } from './context.js';
import { createAuthService } from './auth.service.js';
import { createSettingsService } from './settings.service.js';
import { createBucketService } from './bucket.service.js';
import { createCategoryService } from './category.service.js';
import { createAccountService } from './account.service.js';
import { createTransactionService } from './transaction.service.js';

export function createServices(deps: Deps) {
  return {
    auth: createAuthService(deps),
    settings: createSettingsService(deps),
    buckets: createBucketService(deps),
    categories: createCategoryService(deps),
    accounts: createAccountService(deps),
    transactions: createTransactionService(deps),
  };
}

export type Services = ReturnType<typeof createServices>;
