-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "matched_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "merged_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skipped_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "undone_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "import_links" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_links_household_id_idx" ON "import_links"("household_id");

-- CreateIndex
CREATE INDEX "import_links_import_batch_id_idx" ON "import_links"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_links_account_id_fingerprint_key" ON "import_links"("account_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "import_links_transaction_id_account_id_key" ON "import_links"("transaction_id", "account_id");

-- AddForeignKey
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A link's transaction must touch the linked account, in the same household.
CREATE FUNCTION "check_import_link"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "transactions" t
    WHERE t."id" = NEW."transaction_id" AND t."household_id" = NEW."household_id"
      AND (t."account_id" = NEW."account_id" OR t."to_account_id" = NEW."account_id")
  ) THEN
    RAISE EXCEPTION 'Import link does not match its transaction' USING ERRCODE = '23514', CONSTRAINT = 'import_links_transaction';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "import_links_transaction"
  BEFORE INSERT OR UPDATE ON "import_links"
  FOR EACH ROW EXECUTE FUNCTION "check_import_link"();
