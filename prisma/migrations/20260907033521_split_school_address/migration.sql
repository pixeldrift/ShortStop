-- Splits the schools table's single combined `address` column
-- ("{street}, {city}, {ST} {zip}" - every real row matches this shape,
-- see src/lib/schoolAddress.ts) into separate street/city/state/zip
-- columns, in place, without dropping the real data that's already in
-- the address column: add the new columns nullable, backfill them
-- from `address` via split_part, THEN make them NOT NULL and drop
-- `address` - a plain "drop address, add these as NOT NULL" would
-- fail outright against a schools table that already has rows (see
-- prisma/schema.prisma's own doc on this table).

-- AlterTable: add the new columns, nullable for now
ALTER TABLE "schools"
  ADD COLUMN     "street" TEXT,
  ADD COLUMN     "city"   TEXT,
  ADD COLUMN     "state"  TEXT,
  ADD COLUMN     "zip"    TEXT;

-- Backfill: split_part(address, ',', 1) is the street; part 2 is the
-- city (leading space trimmed); part 3 is " ST ZIP" (leading space
-- trimmed, then split on the remaining single space into state/zip).
UPDATE "schools" SET
  "street" = split_part("address", ',', 1),
  "city"   = trim(split_part("address", ',', 2)),
  "state"  = split_part(trim(split_part("address", ',', 3)), ' ', 1),
  "zip"    = split_part(trim(split_part("address", ',', 3)), ' ', 2);

-- AlterTable: now that every row has real values, enforce NOT NULL
-- and drop the now-redundant combined column.
ALTER TABLE "schools"
  ALTER COLUMN "street" SET NOT NULL,
  ALTER COLUMN "city"   SET NOT NULL,
  ALTER COLUMN "state"  SET NOT NULL,
  ALTER COLUMN "zip"    SET NOT NULL,
  DROP COLUMN  "address";
