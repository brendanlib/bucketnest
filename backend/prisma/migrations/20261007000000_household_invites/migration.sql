-- Household invites, and the household each session works in.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "household_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_household_id" UUID;

-- CreateTable
CREATE TABLE "household_invites" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "household_invites_token_hash_key" ON "household_invites"("token_hash");

-- CreateIndex
CREATE INDEX "household_invites_household_id_idx" ON "household_invites"("household_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_last_household_id_fkey" FOREIGN KEY ("last_household_id") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

