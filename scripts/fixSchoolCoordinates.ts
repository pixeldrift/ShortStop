import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Overwrites School.lat/lon for a small, fixed list of schools whose
 * ORS-geocoded coordinates (scripts/geocodeSchools.ts) only resolved
 * to city/town-center precision instead of their real street address
 * - ORS returned an "ok" match for every one of these, just an
 * imprecise one, so geocodeSchools.ts's own re-run (even with
 * --force) wouldn't fix them on its own. These values were manually
 * looked up and handed back by the district, not re-derived from any
 * automated geocoder.
 *
 * One-off by nature (this table only makes sense for the specific
 * schools it names), not meant to be extended into a general
 * "manual overrides" mechanism - if more corrections come in later,
 * add them to this same table and re-run.
 *
 * Run with `npm run fix-school-coordinates`. Needs DATABASE_URL,
 * either in a gitignored .env.local or as a CI/shell environment
 * variable (no ORS_API_KEY needed - this makes no geocoding calls).
 */
const CORRECTIONS: Record<string, { lat: number; lon: number }> = {
  "Brown's Chapel Elementary School": { lat: 35.9029308, lon: -86.5196206 },
  "Buchanan Elementary School": { lat: 35.7575702, lon: -86.3366067 },
  "Poplar Hill Elementary School": { lat: 35.8914384, lon: -86.5020437 },
  "Poplar Hill Middle School": { lat: 35.8930627, lon: -86.5008394 },
  "Walter Hill Elementary School": { lat: 35.9533052, lon: -86.3789243 },
  "Whitworth-Buchanan Middle School": { lat: 35.7691831, lon: -86.3364244 },
  "Wilson Elementary School": { lat: 35.9815457, lon: -86.4014746 },
  "Christiana Elementary School": { lat: 35.7309037, lon: -86.4108768 },
  "Christiana Middle School": { lat: 35.7324806, lon: -86.4075388 },
  "Plainview Elementary School": { lat: 35.6998483, lon: -86.3334327 },
  "John Colemon Elementary School": { lat: 36.0079897, lon: -86.4884463 },
  "Rocky Fork Elementary School": { lat: 35.9613875, lon: -86.5528538 },
  "Rocky Fork Middle School": { lat: 35.9617272, lon: -86.5480832 },
  "Rockvale High School": { lat: 35.7851128, lon: -86.4971158 },
  "Rockvale Middle School": { lat: 35.7842775, lon: -86.5007435 },
  "Kittrell Elementary School": { lat: 35.827001, lon: -86.2491262 },
  "Lascassas Elementary School": { lat: 35.9263938, lon: -86.2796433 },
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL isn't set - see .env.local.example.");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    let updated = 0;
    let notFound = 0;
    for (const [name, { lat, lon }] of Object.entries(CORRECTIONS)) {
      const school = await prisma.school.findUnique({ where: { name } });
      if (!school) {
        console.log(`  MISSING  "${name}" - no school with this exact name on file`);
        notFound++;
        continue;
      }
      await prisma.school.update({ where: { name }, data: { lat, lon } });
      console.log(`  ok    ${name}\n        -> ${lat}, ${lon} (was ${school.lat}, ${school.lon})`);
      updated++;
    }
    console.log(`\n${updated} corrected, ${notFound} not found - ${Object.keys(CORRECTIONS).length} total.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
