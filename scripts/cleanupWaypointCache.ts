import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { deriveWaypoints } from "../src/lib/deriveWaypoints";
import type { RawRouteRow } from "../src/lib/parseRouteCsv";
import { STREET_SUFFIX_ABBREVIATIONS } from "../src/lib/parseRouteImport";
import { SCHOOL_ADDRESS_NOT_YET_PROVIDED } from "../src/lib/placeholderMeta";
import { formatAddress } from "../src/lib/schoolAddress";
import { normalizeLocationWhitespace, waypointCacheKey } from "../src/lib/waypointCache";

/**
 * Tidies up the Postgres waypoint cache (see waypointCache.ts) in two
 * passes:
 *
 * 1. Deletes every cache row no route step references anymore - the
 *    "auto-clean" the cache never had: nothing today ever removes a
 *    Waypoint row, so retyping a stop from "Holland Ridge" to "Holland
 *    Ridge Rd" leaves the old "address:Holland Ridge" entry sitting
 *    around forever, geocoded and cached, referenced by nothing. This
 *    pass recomputes deriveWaypoints/waypointCacheKey for every route's
 *    current steps (the exact same derivation page.tsx and
 *    EditRouteScreen.tsx already run) and deletes whichever cache rows
 *    fall outside that live set. Always safe: a pruned row is only
 *    ever a re-geocode away from coming right back if some future edit
 *    ever types its exact text again.
 *
 * 2. Reports (never auto-fixes) two kinds of near-duplicate names still
 *    in *active* use - still referenced by at least one route step, so
 *    pass 1 above won't touch them on its own:
 *      - Whitespace/case-only duplicates ("Holland Ridge Dr" vs
 *        "holland ridge dr ") - the exact bug waypointCacheKey's own
 *        normalizeLocationWhitespace now prevents going forward, for
 *        any row typed before that fix.
 *      - Missing-suffix duplicates ("Holland Ridge" alongside "Holland
 *        Ridge Rd") - deliberately never auto-merged: a suffix-less
 *        name is sometimes a genuinely different, real road, not
 *        always a typo, so this only flags the *possibility* and names
 *        the exact route step(s) to go look at and retype by hand.
 *        Once retyped, the old entry stops being live - the very next
 *        run of pass 1 deletes it with no further action needed,
 *        which is the "change it once, the cruft cleans itself up"
 *        workflow this script exists for.
 *
 * Run with `npm run cleanup-waypoint-cache -- --dry-run` first to see
 * exactly what would be deleted (and every near-duplicate report)
 * without writing anything, then again without the flag to actually
 * delete the orphaned rows. Needs DATABASE_URL (no ORS_API_KEY - this
 * makes no geocoding calls, it only reads/deletes already-cached rows).
 */

interface RouteStepRef {
  routeId: string;
  sequence: number;
  location: string;
  fromLocation: string;
}

/** Every street-suffix word this app already recognizes (both spelled
 * out and abbreviated - "Road" and "Rd" alike), for the missing-suffix
 * duplicate check below. Reuses parseRouteImport.ts's own table rather
 * than inventing a second list that could drift from what
 * normalizeStreetSuffix already treats as a real suffix. */
const SUFFIX_WORDS: string[] = Array.from(
  new Set(
    Object.entries(STREET_SUFFIX_ABBREVIATIONS).flatMap(([full, abbr]) => [
      full.toLowerCase(),
      abbr.toLowerCase(),
    ]),
  ),
);

/** Parses one cache key back into its display name(s) - the same
 * house-number-stripped address text, or split-apart intersection road
 * pair, that locationSuggestions.ts's extractLocationSuggestions
 * already produces for the Location field's own dropdown. Duplicated
 * narrowly here (rather than imported) because this needs each name
 * paired with the exact key it came from, which that shared helper
 * intentionally doesn't expose. */
function namesFromKey(key: string): string[] {
  if (key.startsWith("address:")) {
    const address = key.slice("address:".length).trim().replace(/^\d+\s+/, "");
    return address ? [address] : [];
  }
  if (key.startsWith("intersection:")) {
    return key
      .slice("intersection:".length)
      .split(" & ")
      .map((road) => road.trim())
      .filter(Boolean);
  }
  return [];
}

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

async function main() {
  loadEnvLocal();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL isn't set - see .env.local.example.");
  }
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const [routes, allSteps, schools, savedLocations, waypoints] = await Promise.all([
      prisma.route.findMany({ select: { id: true, schoolName: true } }),
      prisma.routeStep.findMany({ orderBy: [{ routeId: "asc" }, { sequence: "asc" }] }),
      prisma.school.findMany(),
      prisma.savedLocation.findMany(),
      prisma.waypoint.findMany({ select: { cacheKey: true } }),
    ]);

    const stepsByRouteId = new Map<string, typeof allSteps>();
    for (const step of allSteps) {
      const list = stepsByRouteId.get(step.routeId);
      if (list) list.push(step);
      else stepsByRouteId.set(step.routeId, [step]);
    }
    const schoolsByName = new Map(schools.map((s) => [s.name, s]));
    const savedLocationsByName = new Map(
      savedLocations.map((loc) => [loc.name.trim().toLowerCase(), loc]),
    );

    // The live set of cache keys every route's own current steps
    // actually resolve to today (deriveWaypoints/waypointCacheKey -
    // same derivation the app itself runs), each paired with which
    // route step(s) produced it, for pass 2's reporting.
    const referencesByKey = new Map<string, RouteStepRef[]>();
    for (const route of routes) {
      const steps = stepsByRouteId.get(route.id);
      if (!steps || steps.length === 0) continue;

      const rows: RawRouteRow[] = steps.map((step) => ({
        action: step.action,
        location: step.location,
        fromLocation: step.fromLocation,
        riderCount: step.riderCount,
        side: step.side,
        notes: step.notes,
        skip: step.skip,
      }));

      const school = schoolsByName.get(route.schoolName);
      const savedLocation = savedLocationsByName.get(route.schoolName.trim().toLowerCase());
      const schoolAddress = school
        ? formatAddress(school)
        : (savedLocation?.address ?? SCHOOL_ADDRESS_NOT_YET_PROVIDED);

      const queries = deriveWaypoints(rows, schoolAddress);
      for (const query of queries) {
        if (query.kind === "unresolvable") continue;
        const key = waypointCacheKey(query);
        const step = steps[query.stepId];
        const ref: RouteStepRef = {
          routeId: route.id,
          sequence: step.sequence,
          location: step.location,
          fromLocation: step.fromLocation,
        };
        const list = referencesByKey.get(key);
        if (list) list.push(ref);
        else referencesByKey.set(key, [ref]);
      }
    }

    const liveKeys = new Set(referencesByKey.keys());
    const existingKeys = waypoints.map((w) => w.cacheKey);
    const orphanedKeys = existingKeys.filter((key) => !liveKeys.has(key));

    console.log(
      `${routes.length} route(s), ${allSteps.length} step(s), ${existingKeys.length} cached ` +
        `waypoint(s), ${liveKeys.size} still referenced by a route step.\n`,
    );

    if (orphanedKeys.length === 0) {
      console.log("No orphaned cache entries - every cached waypoint is still in use.\n");
    } else {
      console.log(
        `${orphanedKeys.length} orphaned cache entr${orphanedKeys.length === 1 ? "y" : "ies"} ` +
          `(no route step references them anymore):`,
      );
      for (const key of orphanedKeys.sort((a, b) => a.localeCompare(b))) {
        console.log(`  ${key}`);
        if (!dryRun) await prisma.waypoint.delete({ where: { cacheKey: key } });
      }
      console.log(
        `${dryRun ? "Would delete" : "Deleted"} ${orphanedKeys.length} orphaned entr${orphanedKeys.length === 1 ? "y" : "ies"}${dryRun ? " - re-run without --dry-run to apply." : "."}\n`,
      );
    }

    // Pass 2: report-only near-duplicate names among cache rows that
    // are BOTH already resolved (a real DB row) AND still live (some
    // route step still asks for them) - exactly the set that can show
    // up twice in the Location field's own suggestion dropdown.
    const activeKeys = existingKeys.filter((key) => liveKeys.has(key));
    const namesToKeys = new Map<string, Set<string>>();
    for (const key of activeKeys) {
      for (const name of namesFromKey(key)) {
        const set = namesToKeys.get(name);
        if (set) set.add(key);
        else namesToKeys.set(name, new Set([key]));
      }
    }
    const uniqueNames = Array.from(namesToKeys.keys());

    function describeName(name: string): string {
      const lines: string[] = [];
      for (const key of Array.from(namesToKeys.get(name) ?? [])) {
        const refs = referencesByKey.get(key) ?? [];
        for (const ref of refs) {
          const from = ref.fromLocation ? `, from "${ref.fromLocation}"` : "";
          lines.push(
            `      ${key}  <- ${ref.routeId} step ${ref.sequence + 1}: "${ref.location}"${from}`,
          );
        }
      }
      return lines.join("\n");
    }

    const whitespaceGroups = new Map<string, Set<string>>();
    for (const name of uniqueNames) {
      const normalized = normalizeLocationWhitespace(name).toLowerCase();
      const set = whitespaceGroups.get(normalized);
      if (set) set.add(name);
      else whitespaceGroups.set(normalized, new Set([name]));
    }
    const whitespaceDuplicates = Array.from(whitespaceGroups.values()).filter((set) => set.size > 1);

    if (whitespaceDuplicates.length > 0) {
      console.log(
        `${whitespaceDuplicates.length} possible whitespace/case duplicate group(s) still in use:`,
      );
      for (const group of whitespaceDuplicates) {
        console.log(`  ${Array.from(group).map((n) => `"${n}"`).join(" / ")}`);
        for (const name of group) console.log(describeName(name));
      }
      console.log(
        "  Retype the route step(s) above to one shared spelling - the entry left with no " +
          "references becomes orphaned, and this script's next run deletes it automatically.\n",
      );
    }

    const nameSet = new Set(uniqueNames.map((n) => n.toLowerCase()));
    const suffixDuplicates: { short: string; long: string }[] = [];
    for (const name of uniqueNames) {
      for (const suffix of SUFFIX_WORDS) {
        const candidate = `${name} ${suffix}`.toLowerCase();
        if (nameSet.has(candidate)) {
          const long = uniqueNames.find((n) => n.toLowerCase() === candidate);
          if (long) suffixDuplicates.push({ short: name, long });
        }
      }
    }

    if (suffixDuplicates.length > 0) {
      console.log(
        `${suffixDuplicates.length} possible missing-suffix duplicate(s) still in use - ` +
          `these MAY be the same real road, or may not be, so nothing here is changed automatically:`,
      );
      for (const { short, long } of suffixDuplicates) {
        console.log(`  "${short}" looks like it might be missing a suffix - compare to "${long}"`);
        console.log(describeName(short));
      }
      console.log(
        "  If a pair above really is the same road, retype the short route step(s) to the " +
          "fuller name - the short entry then becomes orphaned and gets cleaned up automatically " +
          "on this script's next run.\n",
      );
    }

    if (whitespaceDuplicates.length === 0 && suffixDuplicates.length === 0) {
      console.log("No near-duplicate names found among cache entries still in use.\n");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
