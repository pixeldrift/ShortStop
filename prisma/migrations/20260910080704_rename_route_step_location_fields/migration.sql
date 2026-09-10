-- Renames route_steps' fromAt/ontoAt into location/fromLocation, and
-- migrates existing data to match the new fields' own meaning - not a
-- plain rename, since the old two fields played three different roles
-- depending on the row (see RawRouteRow's own doc comment in
-- parseRouteCsv.ts and deriveWaypoints.ts): ontoAt was always this
-- row's own real position when present, but a row with no ontoAt at
-- all stored *its own* position in fromAt instead (a lone-value
-- shorthand), not a context road. `location` now always holds this
-- row's own real position either way; `fromLocation` only ever holds
-- an explicit context road (blank means "infer it from the previous
-- row," same tracking deriveWaypoints.ts already did).

-- ontoAt's own data was always this row's own real position when
-- present, so the rename alone is correct for it - no value needs to
-- change, just the column's name.
ALTER TABLE "route_steps" RENAME COLUMN "ontoAt" TO "location";

ALTER TABLE "route_steps" ADD COLUMN "fromLocation" TEXT NOT NULL DEFAULT '';

-- A row whose old onto_at was populated (location <> '' after the
-- rename above) had a genuinely explicit context road in fromAt -
-- carry it into fromLocation unchanged, typos included, so nothing
-- already resolved needs re-verifying, but it's now something an
-- admin can actually edit.
UPDATE "route_steps" SET "fromLocation" = "fromAt" WHERE "location" <> '';

-- A row whose old onto_at was blank had no real position of its own to
-- rename - fromAt was carrying its own single value under the
-- "lone-value is the destination" shorthand (parseRouteCsv.ts's own
-- doc comment). Move that value into location instead of fromLocation
-- - it was always this row's own place, never a context road -
-- leaving fromLocation blank for the same "infer it" behavior as
-- before.
UPDATE "route_steps" SET "location" = "fromAt" WHERE "location" = '';

ALTER TABLE "route_steps" DROP COLUMN "fromAt";
