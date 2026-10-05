-- AlterTable
ALTER TABLE "sinking_funds" ADD COLUMN     "contribution_anchor_date" DATE NOT NULL DEFAULT CURRENT_DATE;

-- CreateTable
CREATE TABLE "sinking_fund_contributions" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "sinking_fund_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "transaction_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sinking_fund_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sinking_fund_contributions_transaction_id_key" ON "sinking_fund_contributions"("transaction_id");

-- CreateIndex
CREATE INDEX "sinking_fund_contributions_household_id_date_idx" ON "sinking_fund_contributions"("household_id", "date");

-- CreateIndex
CREATE INDEX "sinking_fund_contributions_sinking_fund_id_idx" ON "sinking_fund_contributions"("sinking_fund_id");

-- AddForeignKey
ALTER TABLE "sinking_fund_contributions" ADD CONSTRAINT "sinking_fund_contributions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_fund_contributions" ADD CONSTRAINT "sinking_fund_contributions_sinking_fund_id_fkey" FOREIGN KEY ("sinking_fund_id") REFERENCES "sinking_funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_fund_contributions" ADD CONSTRAINT "sinking_fund_contributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "sinking_fund_contributions" ADD CONSTRAINT "sinking_fund_contributions_amount_positive" CHECK ("amount_cents" > 0);
