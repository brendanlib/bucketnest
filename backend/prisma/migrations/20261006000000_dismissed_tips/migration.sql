-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dismissed_tips" TEXT[] DEFAULT ARRAY[]::TEXT[];

