import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off fill-in for real routes still missing a start time (an
 * earlier import that never carried one, or a hand-added row nobody's
 * set yet) - fillStopDetails.ts already finds these same rows but
 * deliberately leaves them alone ("needs a real value, not a guess, so
 * review by hand"). This is that guess, for a district that would
 * rather have every route show *some* plausible time on the list than
 * a permanently-blank one - an admin still corrects each to the real
 * scheduled time.
 *
 * The random time is scoped to the row's own tripType, not one flat
 * range for every route - a pickup gets a morning time, a dropoff an
 * afternoon one, a fieldtrip/other (no fixed time of day) a broad
 * mid-day range - so a fake time at least reads as plausible for what
 * kind of run it is.
 *
 * Run with `npm run fill-start-times -- --dry-run` first to see
 * exactly which routes would change without writing anything, then
 * again without the flag to actually apply them. Needs DATABASE_URL
 * (no ORS_API_KEY - this makes no geocoding calls).
 */

function randomTime(minMinutes: number, maxMinutes: number): string {
  const minutes = minMinutes + Math.floor(Math.random() * (maxMinutes - minMinutes + 1));
  const rounded = Math.round(minutes / 5) * 5;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function randomStartTime(tripType: string): string {
  if (tripType === "pickup") return randomTime(6 * 60 + 30, 8 * 60 + 30);
  if (tripType === "dropoff") return randomTime(14 * 60 + 30, 16 * 60 + 30);
  return randomTime(8 * 60, 15 * 60);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL isn't set - see .env.local.example.");
  }
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const routes = await prisma.route.findMany({
      where: { startTime: "" },
      select: { id: true, routeNumber: true, schoolName: true, tripType: true },
    });

    if (routes.length === 0) {
      console.log("Every route already has a start time - nothing to fill in.");
      return;
    }

    console.log(
      `${routes.length} route${routes.length === 1 ? "" : "s"} missing a start time ${dryRun ? "(dry run - not writing anything)" : "to fill in"}:\n`,
    );

    for (const route of routes) {
      const startTime = randomStartTime(route.tripType);
      console.log(
        `  ${route.id} (route ${route.routeNumber}, ${route.schoolName}, ${route.tripType}): "" -> "${startTime}"`,
      );
      if (!dryRun) {
        await prisma.route.update({ where: { id: route.id }, data: { startTime } });
      }
    }

    console.log(
      `\n${routes.length} route${routes.length === 1 ? "" : "s"} ${dryRun ? "would be" : ""} filled in${dryRun ? "" : "."}${dryRun ? " - re-run without --dry-run to apply." : ""}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
