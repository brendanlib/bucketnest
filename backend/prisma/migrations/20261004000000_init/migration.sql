-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "BucketKey" AS ENUM ('BILLS', 'SMILE', 'SPLURGE', 'FIRE_EXTINGUISHER');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('TRANSACTION', 'SAVINGS', 'OFFSET', 'CASH', 'INVESTMENT', 'SUPERANNUATION', 'OTHER_ASSET', 'CREDIT_CARD', 'MORTGAGE', 'PERSONAL_LOAN', 'CAR_LOAN', 'HECS_HELP', 'OTHER_LIABILITY');

-- CreateEnum
CREATE TYPE "AccountClass" AS ENUM ('ASSET', 'LIABILITY');

-- CreateEnum
CREATE TYPE "RepaymentTreatment" AS ENUM ('TRANSFER', 'DEBT_REPAYMENT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'REFUND', 'TRANSFER', 'DEBT_REPAYMENT', 'SAVINGS_CONTRIBUTION', 'BALANCE_ADJUSTMENT', 'INTEREST_CHARGE');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'SIX_MONTHLY', 'ANNUALLY', 'EVERY_N_DAYS', 'EVERY_N_WEEKS', 'EVERY_N_MONTHS');

-- CreateEnum
CREATE TYPE "BudgetPeriodType" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "AllocationBasis" AS ENUM ('PLANNED', 'ACTUAL');

-- CreateEnum
CREATE TYPE "AmountKind" AS ENUM ('FIXED', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "WeekendRule" AS ENUM ('NONE', 'PREVIOUS_BUSINESS_DAY', 'NEXT_BUSINESS_DAY');

-- CreateEnum
CREATE TYPE "RecurringType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'DEBT_REPAYMENT', 'SAVINGS_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "ExceptionAction" AS ENUM ('SKIP', 'EDIT');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('EMERGENCY_FUND', 'SAVINGS', 'INVESTMENT');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('PROPERTY', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "RuleMatchField" AS ENUM ('DESCRIPTION', 'PAYEE');

-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('CONTAINS', 'STARTS_WITH', 'EQUALS');

-- CreateEnum
CREATE TYPE "RuleDirection" AS ENUM ('ANY', 'DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "SignConvention" AS ENUM ('NEGATIVE_IS_DEBIT', 'POSITIVE_IS_DEBIT', 'DEBIT_CREDIT_COLUMNS');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('COMMITTED', 'UNDONE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('UPCOMING_BILL', 'OVERSPENDING', 'SINKING_FUND_DEADLINE', 'BUDGET_REVIEW', 'GOAL_MILESTONE');

-- CreateEnum
CREATE TYPE "DebtPayoffStrategy" AS ENUM ('SNOWBALL', 'AVALANCHE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'AUD',
    "locale" TEXT NOT NULL DEFAULT 'en-AU',
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "fy_start_month" SMALLINT NOT NULL DEFAULT 7,
    "week_start_day" SMALLINT NOT NULL DEFAULT 1,
    "budget_period_type" "BudgetPeriodType" NOT NULL DEFAULT 'MONTHLY',
    "budget_anchor_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "display_frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "allocation_basis" "AllocationBasis" NOT NULL DEFAULT 'PLANNED',
    "amber_threshold" DECIMAL(5,2) NOT NULL DEFAULT 90,
    "red_threshold" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "debt_payoff_strategy" "DebtPayoffStrategy" NOT NULL DEFAULT 'SNOWBALL',
    "gst_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buckets" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "key" "BucketKey" NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "bucket_id" UUID,
    "parent_id" UUID,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "kind" "CategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "system_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "class" "AccountClass" NOT NULL,
    "institution" TEXT,
    "opening_balance_cents" BIGINT NOT NULL DEFAULT 0,
    "opening_date" DATE NOT NULL,
    "last4" CHAR(4),
    "bucket_tag_id" UUID,
    "include_in_budget" BOOLEAN NOT NULL DEFAULT true,
    "include_in_net_worth" BOOLEAN NOT NULL DEFAULT true,
    "repayment_treatment" "RepaymentTreatment",
    "offset_for_account_id" UUID,
    "notes" TEXT,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "payee" TEXT,
    "amount_cents" BIGINT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "direction" "AdjustmentDirection",
    "account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "recurring_id" UUID,
    "occurrence_date" DATE,
    "goal_id" UUID,
    "import_batch_id" UUID,
    "fingerprint" TEXT,
    "cleared" BOOLEAN NOT NULL DEFAULT false,
    "gst_cents" BIGINT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_splits" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "is_sinking_fund_payment" BOOLEAN NOT NULL DEFAULT false,
    "is_extra_repayment" BOOLEAN NOT NULL DEFAULT false,
    "sinking_fund_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transaction_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "period_type" "BudgetPeriodType" NOT NULL,
    "anchor_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_items" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "entered_frequency" "Frequency" NOT NULL,
    "frequency_interval" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_transactions" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RecurringType" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "amount_kind" "AmountKind" NOT NULL DEFAULT 'FIXED',
    "frequency" "Frequency" NOT NULL,
    "interval" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "occurrence_count" INTEGER,
    "weekend_rule" "WeekendRule" NOT NULL DEFAULT 'NONE',
    "auto_post" BOOLEAN NOT NULL DEFAULT false,
    "account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "category_id" UUID,
    "payee" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_exceptions" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "recurring_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "action" "ExceptionAction" NOT NULL,
    "override_amount_cents" BIGINT,
    "override_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sinking_funds" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_cents" BIGINT NOT NULL,
    "manual_current_cents" BIGINT,
    "due_date" DATE NOT NULL,
    "contribution_frequency" "Frequency" NOT NULL,
    "contribution_interval" INTEGER,
    "account_id" UUID,
    "category_id" UUID,
    "recurring_id" UUID,
    "repeats" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sinking_funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_goals" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GoalType" NOT NULL,
    "target_cents" BIGINT NOT NULL,
    "manual_current_cents" BIGINT,
    "target_date" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "account_id" UUID,
    "contribution_cents" BIGINT,
    "contribution_frequency" "Frequency",
    "contribution_interval" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debts" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "original_balance_cents" BIGINT NOT NULL,
    "annual_rate" DECIMAL(7,4) NOT NULL,
    "min_repayment_cents" BIGINT NOT NULL,
    "repayment_frequency" "Frequency" NOT NULL,
    "repayment_interval" INTEGER,
    "extra_repayment_cents" BIGINT NOT NULL DEFAULT 0,
    "due_day" SMALLINT,
    "start_date" DATE,
    "category_id" UUID,
    "indexation_only" BOOLEAN NOT NULL DEFAULT false,
    "include_in_payoff" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "include_in_net_worth" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_valuations" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "value_cents" BIGINT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "net_worth_snapshots" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "assets_cents" BIGINT NOT NULL,
    "liabilities_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "net_worth_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorisation_rules" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT,
    "priority" INTEGER NOT NULL,
    "match_field" "RuleMatchField" NOT NULL,
    "match_type" "RuleMatchType" NOT NULL,
    "match_value" TEXT NOT NULL,
    "min_amount_cents" BIGINT,
    "max_amount_cents" BIGINT,
    "direction" "RuleDirection" NOT NULL DEFAULT 'ANY',
    "account_id" UUID,
    "set_category_id" UUID,
    "set_type" "TransactionType",
    "set_to_account_id" UUID,
    "set_payee" TEXT,
    "add_note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categorisation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_profiles" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL DEFAULT ',',
    "has_header" BOOLEAN NOT NULL DEFAULT true,
    "date_format" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "sign_convention" "SignConvention" NOT NULL DEFAULT 'NEGATIVE_IS_DEBIT',
    "date_column" INTEGER NOT NULL,
    "description_column" INTEGER NOT NULL,
    "amount_column" INTEGER,
    "debit_column" INTEGER,
    "credit_column" INTEGER,
    "balance_column" INTEGER,
    "payee_column" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'COMMITTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "days_before" INTEGER,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "household_members_user_id_idx" ON "household_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_members_household_id_user_id_key" ON "household_members"("household_id", "user_id");

-- CreateIndex
CREATE INDEX "buckets_household_id_idx" ON "buckets"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "buckets_household_id_key_key" ON "buckets"("household_id", "key");

-- CreateIndex
CREATE INDEX "categories_household_id_is_active_idx" ON "categories"("household_id", "is_active");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_bucket_id_idx" ON "categories"("bucket_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_household_id_system_key_key" ON "categories"("household_id", "system_key");

-- CreateIndex
CREATE INDEX "accounts_household_id_is_closed_idx" ON "accounts"("household_id", "is_closed");

-- CreateIndex
CREATE INDEX "transactions_household_id_date_idx" ON "transactions"("household_id", "date");

-- CreateIndex
CREATE INDEX "transactions_household_id_account_id_date_idx" ON "transactions"("household_id", "account_id", "date");

-- CreateIndex
CREATE INDEX "transactions_to_account_id_idx" ON "transactions"("to_account_id");

-- CreateIndex
CREATE INDEX "transactions_import_batch_id_idx" ON "transactions"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_fingerprint_key" ON "transactions"("account_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_recurring_id_occurrence_date_key" ON "transactions"("recurring_id", "occurrence_date");

-- CreateIndex
CREATE INDEX "transaction_splits_category_id_idx" ON "transaction_splits"("category_id");

-- CreateIndex
CREATE INDEX "transaction_splits_transaction_id_idx" ON "transaction_splits"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_splits_household_id_idx" ON "transaction_splits"("household_id");

-- CreateIndex
CREATE INDEX "budgets_household_id_idx" ON "budgets"("household_id");

-- CreateIndex
CREATE INDEX "budget_items_household_id_idx" ON "budget_items"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_items_budget_id_category_id_key" ON "budget_items"("budget_id", "category_id");

-- CreateIndex
CREATE INDEX "recurring_transactions_household_id_is_active_idx" ON "recurring_transactions"("household_id", "is_active");

-- CreateIndex
CREATE INDEX "recurring_exceptions_household_id_idx" ON "recurring_exceptions"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_exceptions_recurring_id_occurrence_date_key" ON "recurring_exceptions"("recurring_id", "occurrence_date");

-- CreateIndex
CREATE INDEX "sinking_funds_household_id_is_active_idx" ON "sinking_funds"("household_id", "is_active");

-- CreateIndex
CREATE INDEX "financial_goals_household_id_is_active_idx" ON "financial_goals"("household_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "debts_account_id_key" ON "debts"("account_id");

-- CreateIndex
CREATE INDEX "debts_household_id_idx" ON "debts"("household_id");

-- CreateIndex
CREATE INDEX "assets_household_id_idx" ON "assets"("household_id");

-- CreateIndex
CREATE INDEX "asset_valuations_household_id_idx" ON "asset_valuations"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_valuations_asset_id_date_key" ON "asset_valuations"("asset_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "net_worth_snapshots_household_id_date_key" ON "net_worth_snapshots"("household_id", "date");

-- CreateIndex
CREATE INDEX "categorisation_rules_household_id_is_active_idx" ON "categorisation_rules"("household_id", "is_active");

-- CreateIndex
CREATE INDEX "import_profiles_household_id_idx" ON "import_profiles"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_profiles_account_id_key" ON "import_profiles"("account_id");

-- CreateIndex
CREATE INDEX "import_batches_household_id_idx" ON "import_batches"("household_id");

-- CreateIndex
CREATE INDEX "notifications_household_id_read_at_idx" ON "notifications"("household_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_household_id_type_subject_id_period_key_key" ON "notifications"("household_id", "type", "subject_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_household_id_type_key" ON "notification_settings"("household_id", "type");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buckets" ADD CONSTRAINT "buckets_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "buckets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_bucket_tag_id_fkey" FOREIGN KEY ("bucket_tag_id") REFERENCES "buckets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_offset_for_account_id_fkey" FOREIGN KEY ("offset_for_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "recurring_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "financial_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_sinking_fund_id_fkey" FOREIGN KEY ("sinking_fund_id") REFERENCES "sinking_funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_exceptions" ADD CONSTRAINT "recurring_exceptions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_exceptions" ADD CONSTRAINT "recurring_exceptions_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "recurring_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "recurring_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorisation_rules" ADD CONSTRAINT "categorisation_rules_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorisation_rules" ADD CONSTRAINT "categorisation_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorisation_rules" ADD CONSTRAINT "categorisation_rules_set_category_id_fkey" FOREIGN KEY ("set_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorisation_rules" ADD CONSTRAINT "categorisation_rules_set_to_account_id_fkey" FOREIGN KEY ("set_to_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Integrity rules Prisma cannot express ──────────────────────────────────

-- Emails are stored lower-cased so the unique index is case-insensitive.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- One name per group (top-level names unique too: NULL parents are not distinct).
CREATE UNIQUE INDEX "categories_household_parent_name_key"
  ON "categories" ("household_id", "parent_id", "name") NULLS NOT DISTINCT;

ALTER TABLE "categories" ADD CONSTRAINT "categories_bucket_matches_kind"
  CHECK (("kind" = 'INCOME' AND "bucket_id" IS NULL) OR ("kind" = 'EXPENSE' AND ("bucket_id" IS NOT NULL OR "is_group")));

ALTER TABLE "buckets" ADD CONSTRAINT "buckets_percentage_range" CHECK ("percentage" >= 0 AND "percentage" <= 100);

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_last4_digits" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_date_range" CHECK ("date" >= DATE '1900-01-01' AND "date" <= DATE '2100-12-31');
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accounts_differ" CHECK ("to_account_id" IS NULL OR "to_account_id" <> "account_id");
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_by_type" CHECK (
  ("type" IN ('TRANSFER', 'DEBT_REPAYMENT', 'SAVINGS_CONTRIBUTION')) = ("to_account_id" IS NOT NULL)
);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_direction_by_type" CHECK (
  ("type" = 'BALANCE_ADJUSTMENT') = ("direction" IS NOT NULL)
);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_occurrence_with_recurring" CHECK (
  ("recurring_id" IS NULL) OR ("occurrence_date" IS NOT NULL)
);

ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_amount_nonnegative" CHECK ("amount_cents" >= 0);
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_target_positive" CHECK ("target_cents" > 0);
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_target_positive" CHECK ("target_cents" > 0);
ALTER TABLE "debts" ADD CONSTRAINT "debts_rate_range" CHECK ("annual_rate" >= 0 AND "annual_rate" <= 100);

-- Splits either do not exist (uncategorised, transfers) or sum exactly to the
-- transaction amount. Checked at commit so a transaction and its splits can be
-- written in any order inside one database transaction.
CREATE FUNCTION "check_transaction_splits"() RETURNS trigger AS $$
DECLARE
  tx_id uuid;
  tx_amount bigint;
  split_total bigint;
  split_count integer;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    tx_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    tx_id := OLD."transaction_id";
  ELSE
    tx_id := NEW."transaction_id";
  END IF;

  SELECT "amount_cents" INTO tx_amount FROM "transactions" WHERE "id" = tx_id;
  IF NOT FOUND THEN
    RETURN NULL; -- transaction deleted; its splits cascade
  END IF;

  SELECT COALESCE(SUM("amount_cents"), 0), COUNT(*) INTO split_total, split_count
    FROM "transaction_splits" WHERE "transaction_id" = tx_id;

  IF split_count > 0 AND split_total <> tx_amount THEN
    RAISE EXCEPTION 'Splits for transaction % total % but the transaction is %', tx_id, split_total, tx_amount
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "transaction_splits_sum_on_split"
  AFTER INSERT OR UPDATE OR DELETE ON "transaction_splits"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_transaction_splits"();

CREATE CONSTRAINT TRIGGER "transaction_splits_sum_on_transaction"
  AFTER INSERT OR UPDATE OF "amount_cents" ON "transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_transaction_splits"();

-- A split must belong to the same household as its transaction and category.
CREATE FUNCTION "check_split_household"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t."id" = NEW."transaction_id" AND t."household_id" = NEW."household_id")
     OR NOT EXISTS (SELECT 1 FROM "categories" c WHERE c."id" = NEW."category_id" AND c."household_id" = NEW."household_id") THEN
    RAISE EXCEPTION 'Split household mismatch' USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_household';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transaction_splits_household"
  BEFORE INSERT OR UPDATE ON "transaction_splits"
  FOR EACH ROW EXECUTE FUNCTION "check_split_household"();

-- Transactions may only reference accounts in their own household.
CREATE FUNCTION "check_transaction_household"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = NEW."account_id" AND a."household_id" = NEW."household_id")
     OR (NEW."to_account_id" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "accounts" a WHERE a."id" = NEW."to_account_id" AND a."household_id" = NEW."household_id")) THEN
    RAISE EXCEPTION 'Transaction account household mismatch' USING ERRCODE = '23514', CONSTRAINT = 'transactions_household';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transactions_household"
  BEFORE INSERT OR UPDATE OF "account_id", "to_account_id", "household_id" ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "check_transaction_household"();
