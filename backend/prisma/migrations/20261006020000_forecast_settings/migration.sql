-- CreateEnum
CREATE TYPE "ForecastMethod" AS ENUM ('AVG3', 'AVG6', 'AVG12', 'MANUAL');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "forecast_manual_cents" BIGINT,
ADD COLUMN     "forecast_method" "ForecastMethod";

-- AlterTable
ALTER TABLE "households" ADD COLUMN     "forecast_method" "ForecastMethod" NOT NULL DEFAULT 'AVG3';

