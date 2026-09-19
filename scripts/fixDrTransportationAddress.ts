import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { geocodeSavedLocationAddress } from "../src/lib/savedLocations";

// Same manual .env.local load as geocodeSchools.ts/geocodeRoute.ts -
// this runs outside Next.js, which is the only thing that auto-loads
// it otherwise. Only fills in keys not already set, so a real
// shell-exported value (CI's own secrets.ORS_API_KEY/secrets.DATABASE_URL)
// always wins.
const ENV_LOCAL_PATH = join(process.cwd(), ".env.local");
function loadEnvLocal(): void {
  if (!existsSync(ENV_LOCAL_PATH)) return;
  for (const line of readFileSync(ENV_LOCAL_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

/**
 * One-off correction for the D&R Transportation depot's own address -
 * an ORS free-text match once landed on a same-named street in
 * California instead of the real "569 Meadowlark Ln" in La Vergne, TN,
 * and that wrong point got cached. It's been stuck there ever since:
 * the waypoint cache is content-addressed by the literal typed text
 * (see waypointCacheKey's own doc comment, src/lib/waypointCache.ts) -
 * a wrong cache entry never expires or gets flagged as wrong on its
 * own, it just keeps answering the same way forever, for every route
 * that names this depot.
 *
 * Fixes both real sources of that wrong point in one pass:
 *   - The address book's own SavedLocation row, so a route that
 *     matches it going forward gets the right address/point
 *     immediately (StepRowEditor's own matchedSavedLocation,
 *     EditRouteScreen's own School field).
 *   - Every existing Waypoint cache row whose own key names this
 *     depot, so every route step already pointing at the bad cache
 *     entry is corrected too, without an admin having to open and
 *     re-fetch each affected route by hand.
 *
 * NAME_PATTERN matches loosely ("d&r transp...", spacing/ampersand-
 * spelling aside) rather than one exact string, since a SavedLocation
 * row and a hand-typed route waypoint don't have to agree on whether
 * it's "D&R Transportation Headquarters" (this app's own doc-comment
 * example - see deriveWaypoints.ts) or a shorter "D&R Transportation"/
 * "D&R Transpo" someone typed directly into a route.
 *
 * Run with `npm run fix-dr-transportation-address -- --dry-run` first
 * to see exactly what would change without writing anything, then
 * again without the flag to actually apply it. Needs DATABASE_URL and
 * ORS_API_KEY - the correct coordinates are geocoded fresh here, not
 * hardcoded, since nobody's manually verified a specific lat/lon for
 * this address the way scripts/fixSchoolCoordinates.ts's own
 * corrections were.
 */
const CORRECT_ADDRESS = "569 Meadowlark Ln, La Vergne, TN 37086";
const NAME_PATTERN = /d\s*&\s*r\s*transp/i;

async function main() {
  loadEnvLocal();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL isn't set - see .env.local.example.");
  }
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const geocoded = await geocodeSavedLocationAddress(CORRECT_ADDRESS);
    if ("error" in geocoded) {
      throw new Error(`Couldn't geocode "${CORRECT_ADDRESS}": ${geocoded.error}`);
    }
    const { lat, lon } = geocoded;
    console.log(`Geocoded "${CORRECT_ADDRESS}" -> ${lat}, ${lon}\n`);

    const savedLocations = await prisma.savedLocation.findMany();
    const matchingLocations = savedLocations.filter((loc) => NAME_PATTERN.test(loc.name));
    for (const loc of matchingLocations) {
      console.log(
        `SavedLocation "${loc.name}"\n` +
          `  address  "${loc.address}" -> "${CORRECT_ADDRESS}"\n` +
          `  point    (${loc.lat}, ${loc.lon}) -> (${lat}, ${lon})`,
      );
      if (!dryRun) {
        await prisma.savedLocation.update({
          where: { id: loc.id },
          data: { address: CORRECT_ADDRESS, lat, lon },
        });
      }
    }
    if (matchingLocations.length === 0) {
      console.log("No SavedLocation row matched - nothing to update there.");
    }

    const addressWaypoints = await prisma.waypoint.findMany({
      where: { cacheKey: { startsWith: "address:" } },
    });
    const matchingWaypoints = addressWaypoints.filter((w) =>
      NAME_PATTERN.test(w.cacheKey.slice("address:".length)),
    );
    for (const w of matchingWaypoints) {
      console.log(
        `\nWaypoint cache "${w.cacheKey}"\n` +
          `  point    (${w.lat}, ${w.lon}) -> (${lat}, ${lon})`,
      );
      if (!dryRun) {
        await prisma.waypoint.update({
          where: { cacheKey: w.cacheKey },
          data: {
            status: "ok",
            lat,
            lon,
            displayName: CORRECT_ADDRESS,
            source: w.cacheKey.slice("address:".length),
            provider: "openrouteservice",
            message: null,
            raw: null,
          },
        });
      }
    }
    if (matchingWaypoints.length === 0) {
      console.log("No waypoint cache entries matched - nothing to update there.");
    }

    console.log(
      `\n${dryRun ? "Dry run - would update" : "Updated"} ${matchingLocations.length} saved location(s) and ${matchingWaypoints.length} waypoint cache entr${matchingWaypoints.length === 1 ? "y" : "ies"}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
