import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { lookupCoordinates } from "../src/lib/resolveWaypoint";
import { formatAddress } from "../src/lib/schoolAddress";

// See scripts/geocodeRoute.ts's own doc comment for why this exists
// (no .env.local auto-loading outside Next.js) and why it only fills
// in keys not already set - a real shell-exported value (CI's own
// `secrets.ORS_API_KEY`/`secrets.DATABASE_URL`) always wins.
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

// Same pacing as geocodeRoute.ts's RATE_LIMIT_MS - kept in step with
// it rather than re-derived, since both hit the same ORS account-wide
// quota.
const RATE_LIMIT_MS = 1100;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Geocodes every school's own address directly (School.lat/lon),
 * independent of any route - unlike the Waypoint cache, which only
 * ever learns a school's address as a side effect of resolving one of
 * its routes' intersection-kind stops (see resolveWaypoint.ts's
 * ensureAnchor), so a school with no routes yet, or whose routes are
 * all address-kind stops, never otherwise gets geocoded at all.
 *
 * Idempotent and safe to re-run: skips a school that already has
 * lat/lon on file unless --force is passed (e.g. after a school's
 * address changes in schools.csv/the schools table).
 *
 * Run with `npm run geocode:schools`. Needs ORS_API_KEY (see
 * geocodeRoute.ts) and DATABASE_URL, both either in a gitignored
 * .env.local or as CI/shell environment variables.
 */
async function main() {
  loadEnvLocal();
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ORS_API_KEY isn't set. Get a free key at openrouteservice.org, then either export it, " +
        "put it in a gitignored .env.local (ORS_API_KEY=...), or set it as a repository secret in CI.",
    );
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL isn't set - see .env.local.example.");
  }

  const force = process.argv.includes("--force");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const schools = await prisma.school.findMany({ orderBy: { name: "asc" } });

    let geocoded = 0;
    let alreadyHad = 0;
    let failed = 0;

    for (const school of schools) {
      if (!force && school.lat != null && school.lon != null) {
        alreadyHad++;
        continue;
      }

      const address = formatAddress(school);
      const locationContext = `${school.city}, ${school.state}`;

      const entry = await lookupCoordinates({ kind: "address", text: address }, locationContext, { apiKey });
      await sleep(RATE_LIMIT_MS);

      if (entry.status === "ok") {
        await prisma.school.update({ where: { id: school.id }, data: { lat: entry.lat, lon: entry.lon } });
        geocoded++;
        console.log(`  ok    ${school.name}\n        -> ${entry.lat}, ${entry.lon} (${entry.displayName})`);
      } else {
        failed++;
        console.log(`  FAIL  ${school.name} ("${address}"): ${entry.message}`);
      }
    }

    console.log(
      `\n${geocoded} newly geocoded, ${alreadyHad} already on file, ${failed} failed - ` +
        `${schools.length} school(s) total.`,
    );
    if (failed > 0) {
      console.log("Failed lookups usually need a wording fix in schools.csv - re-run this once that's fixed.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
