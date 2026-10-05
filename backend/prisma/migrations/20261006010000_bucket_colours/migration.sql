-- The original default bucket colours left Smile and Splurge indistinguishable
-- under red-green colour blindness. Move households still on the old defaults to
-- the validated set. Colours a user chose themselves are left alone.
UPDATE "buckets" SET "colour" = '#2A78D6' WHERE "key" = 'BILLS' AND upper("colour") = '#2563EB';
UPDATE "buckets" SET "colour" = '#4A3AA7' WHERE "key" = 'SMILE' AND upper("colour") = '#DB2777';
UPDATE "buckets" SET "colour" = '#1BAF7A' WHERE "key" = 'SPLURGE' AND upper("colour") = '#0D9488';
UPDATE "buckets" SET "colour" = '#EB6834' WHERE "key" = 'FIRE_EXTINGUISHER' AND upper("colour") = '#EA580C';
