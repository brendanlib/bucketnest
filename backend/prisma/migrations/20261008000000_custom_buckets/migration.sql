-- Households can add, rename, reorder and remove buckets. The key becomes free
-- text: BILLS and FIRE_EXTINGUISHER keep their meaning; new buckets get CUSTOM_*.
ALTER TABLE "buckets" ALTER COLUMN "key" TYPE TEXT USING "key"::text;
DROP TYPE "BucketKey";
