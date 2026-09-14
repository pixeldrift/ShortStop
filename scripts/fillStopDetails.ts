import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off fill-in for real "stop" rows a district's own sheet (or a
 * plain-CSV import with just action/location, no side/rider_count
 * columns) never gave a side-of-street or rider count - both fields
 * StepRowEditor's own "Side"/"# of Riders" boxes ask an admin to fill
 * in by hand otherwise. Only ever touches a row that's blank in that
 * field already - a row that already has a real value (imported from a
 * sheet that did carry one) is left exactly as it is.
 *
 * `side` gets a random "Left"/"Right" (StepRowEditor's own two real
 * options - see its Side <select>). `rider_count` gets a random
 * integer 1-5 (this app's own placeholder-until-corrected range, not a
 * claim about a real district's actual ridership - an admin reviewing
 * stops still corrects each one to the real count).
 *
 * Only ever applies to a "stop" row (case-sensitive lowercase - see
 * EditRouteScreen.tsx's own stopNumbers computation, `action ===
 * "stop"`) - a turn/other action row has neither field exposed in the
 * UI at all, so leaves it alone regardless of whatever's stored there.
 *
 * Run with `npm run fill-stop-details -- --dry-run` first to see
 * exactly which rows would change without writing anything, then again
 * without the flag to actually apply them. Needs DATABASE_URL (no
 * ORS_API_KEY - this makes no geocoding calls).
 */

const SIDES = ["Left", "Right"] as const;

function randomSide(): string {
  return SIDES[Math.floor(Math.random() * SIDES.length)];
}

function randomRiderCount(): string {
  return String(1 + Math.floor(Math.random() * 5));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL isn't set - see .env.local.example.");
  }
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const steps = await prisma.routeStep.findMany({
      where: { action: "stop" },
      orderBy: [{ routeId: "asc" }, { sequence: "asc" }],
    });

    const blank = steps.filter((step) => step.side === "" || step.riderCount === "");
    if (blank.length === 0) {
      console.log("No stop rows missing a side or rider count - nothing to fill in.");
    } else {
      console.log(
        `${blank.length} stop row${blank.length === 1 ? "" : "s"} missing a side and/or rider count ${dryRun ? "(dry run - not writing anything)" : "to fill in"}:\n`,
      );

      for (const step of blank) {
        const side = step.side === "" ? randomSide() : step.side;
        const riderCount = step.riderCount === "" ? randomRiderCount() : step.riderCount;
        console.log(
          `  ${step.routeId} #${step.sequence} (stop at "${step.location}")\n` +
            (step.side === "" ? `    side:        "" -> "${side}"\n` : "") +
            (step.riderCount === "" ? `    rider_count: "" -> "${riderCount}"\n` : ""),
        );
        if (!dryRun) {
          await prisma.routeStep.update({
            where: { id: step.id },
            data: { side, riderCount },
          });
        }
      }

      console.log(
        `\n${blank.length} row${blank.length === 1 ? "" : "s"} ${dryRun ? "would be" : ""} filled in${dryRun ? "" : "."}${dryRun ? " - re-run without --dry-run to apply." : ""}`,
      );
    }

    const routes = await prisma.route.findMany({
      where: { startTime: "" },
      select: { id: true, routeNumber: true, schoolName: true },
    });
    if (routes.length > 0) {
      console.log(
        `\n${routes.length} route${routes.length === 1 ? "" : "s"} missing a start time - needs a real value, not a guess, so review by hand:`,
      );
      for (const route of routes) {
        console.log(`  ${route.id} (route ${route.routeNumber}, ${route.schoolName})`);
      }
    } else {
      console.log("\nEvery route already has a start time - nothing to fill in there.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
