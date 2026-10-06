-- Direct bank connections (Up), their accounts, and folder import.

-- CreateEnum
CREATE TYPE "BankProvider" AS ENUM ('UP');

-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('ACTIVE', 'ERROR');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "inbox_folder" TEXT;

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "provider" "BankProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "token_ciphertext" TEXT NOT NULL,
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_feed_accounts" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "balance_cents" BIGINT NOT NULL,
    "account_id" UUID,
    "sync_from" DATE,
    "last_sync_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_feed_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_connections_household_id_idx" ON "bank_connections"("household_id");

-- CreateIndex
CREATE INDEX "bank_feed_accounts_household_id_idx" ON "bank_feed_accounts"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_feed_accounts_connection_id_external_id_key" ON "bank_feed_accounts"("connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_feed_accounts_account_id_key" ON "bank_feed_accounts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_inbox_folder_key" ON "accounts"("inbox_folder");

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_accounts" ADD CONSTRAINT "bank_feed_accounts_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_accounts" ADD CONSTRAINT "bank_feed_accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_accounts" ADD CONSTRAINT "bank_feed_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

