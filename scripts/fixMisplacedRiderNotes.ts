import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off cleanup for a real data-quality problem in some already-
 * imported steps sheets: a district's own sheet (or a lossy paste/
 * upload through EditRouteScreen.tsx's import tool) landed a row's
 * real driver note in the `rider_count` column instead of `notes` -
 * `rider_count` is only ever supposed to hold a plain non-negative
 * integer (StepRowEditor's own "# of Riders" field, read as
 * `Number(riderCount)` by buildRouteFromRows), so any row whose stored
 * value isn't that (empty is fine - that's just "no count entered")
 * is misplaced text, not a real count.
 *
 * For each such row: moves the stray text into `notes` (appended after
 * whatever's already there, if anything - the common case is `notes`
 * being blank, since this really was a single-column shift, but never
 * assume that and silently drop existing real notes) and blanks
 * `rider_count` back to "" rather than leaving it holding text
 * `buildRouteFromRows`'s own `Number(riderCount)` would silently turn
 * into `NaN`.
 *
 * Run with `npm run fix-misplaced-rider-notes -- --dry-run` first to
 * see exactly which rows would change without writing anything, then
 * again without the flag to actually apply them. Needs DATABASE_URL
 * (no ORS_API_KEY - this makes no geocoding calls).
 */

function isPlainRiderCount(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || /^\d+$/.test(trimmed);
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
      where: { riderCount: { not: "" } },
      orderBy: [{ routeId: "asc" }, { sequence: "asc" }],
    });

    const misplaced = steps.filter((step) => !isPlainRiderCount(step.riderCount));
    if (misplaced.length === 0) {
      console.log("No misplaced rider-count values found - nothing to fix.");
      return;
    }

    console.log(
      `${misplaced.length} row${misplaced.length === 1 ? "" : "s"} with non-numeric rider_count ${dryRun ? "(dry run - not writing anything)" : "to fix"}:\n`,
    );

    for (const step of misplaced) {
      const strayText = step.riderCount.trim();
      const newNotes = step.notes ? `${step.notes} ${strayText}` : strayText;
      console.log(
        `  ${step.routeId} #${step.sequence} (${step.action} at "${step.location}")\n` +
          `    rider_count: "${step.riderCount}" -> ""\n` +
          `    notes:       "${step.notes}" -> "${newNotes}"`,
      );
      if (!dryRun) {
        await prisma.routeStep.update({
          where: { id: step.id },
          data: { riderCount: "", notes: newNotes },
        });
      }
    }

    console.log(
      `\n${misplaced.length} row${misplaced.length === 1 ? "" : "s"} ${dryRun ? "would be" : ""} fixed${dryRun ? "" : "."}${dryRun ? " - re-run without --dry-run to apply." : ""}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
