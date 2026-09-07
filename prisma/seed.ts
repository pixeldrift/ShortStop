/**
 * One-time (re-runnable) load of the district's original source files
 * under public/data/ into Postgres - route-master-list.csv,
 * schools.csv, each route's own steps sheet, and each route's
 * *-waypoints.json geocode sidecar. Those files stay in the repo as
 * the district's original documents and as this script's own input;
 * Postgres becomes what the running app actually reads from (see the
 * API routes under src/app/api/).
 *
 * Safe to re-run: every write is an upsert keyed on the same identity
 * the source file itself uses (route id, school name, sequence within
 * a route, waypoint cache key), so re-running after a source file
 * changes updates existing rows instead of duplicating them.
 *
 * Run via `npx prisma db seed` (wired up in prisma7.config.ts) or
 * automatically after `prisma migrate dev`/`migrate reset`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type SchoolLevelDb, type TripTypeDb } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { parseRouteCsvRows } from "../src/lib/parseRouteCsv";
import { parseSchoolsCsv } from "../src/lib/parseSchoolsCsv";
import { stepsCsvBaseName } from "../src/lib/parseRouteMasterList";
import { parseAddress } from "../src/lib/schoolAddress";
import type { WaypointCache } from "../src/lib/waypointCache";

const DATA_DIR = join(process.cwd(), "public", "data");

const SCHOOL_TYPE_TO_LEVEL: Record<string, SchoolLevelDb> = {
  EL: "elementary",
  MS: "middle",
  HS: "high",
};

interface MasterListRow {
  id: string;
  status: string;
  routeNumber: string;
  busNumber: string;
  schoolName: string;
  schoolLevel: SchoolLevelDb;
  tripType: TripTypeDb;
  startTime: string;
  endTime: string | null;
}

/** Same tab-separated master list schema parseRouteMasterList.ts
 * parses (route_id, route_number, bus_number, am_pm, school_type,
 * school_name, start_time, end_time, stop_count, rider_count, status)
 * - kept as its own small parser here rather than reusing that one
 * because this needs the raw start_time/end_time text (what Postgres
 * stores, and what /api/route-master-list hands back out unchanged),
 * where parseRouteMasterList already converts those into a display
 * string and a derived duration for the app's own use. */
function parseMasterListForSeed(csvText: string): MasterListRow[] {
  const [headerLine, ...dataLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split("\t").map((h) => h.trim());

  return dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split("\t").map((v) => v.trim());
      const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
      const tripType: TripTypeDb = row.am_pm.toUpperCase() === "AM" ? "pickup" : "dropoff";
      const schoolLevel = SCHOOL_TYPE_TO_LEVEL[row.school_type.toUpperCase()];
      const id = row.route_id || `${row.route_number}-${tripType}-${schoolLevel}`;
      return {
        id,
        status: row.status.toLowerCase(),
        routeNumber: row.route_number,
        busNumber: row.bus_number,
        schoolName: row.school_name,
        schoolLevel,
        tripType,
        startTime: row.start_time,
        endTime: row.end_time || null,
      };
    });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set - copy .env.local.example to .env.local and fill it in first.",
    );
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const schoolsCsv = readFileSync(join(DATA_DIR, "schools.csv"), "utf8");
    const schools = parseSchoolsCsv(schoolsCsv);
    for (const [name, info] of Object.entries(schools)) {
      const { street, city, state, zip } = parseAddress(info.address);
      await prisma.school.upsert({
        where: { name },
        create: { name, street, city, state, zip, level: info.schoolLevel },
        update: { street, city, state, zip, level: info.schoolLevel },
      });
    }
    console.log(`Seeded ${Object.keys(schools).length} schools.`);

    const masterListCsv = readFileSync(join(DATA_DIR, "route-master-list.csv"), "utf8");
    const masterList = parseMasterListForSeed(masterListCsv);

    let stepRowCount = 0;
    for (const route of masterList) {
      await prisma.route.upsert({
        where: { id: route.id },
        create: {
          id: route.id,
          status: route.status as "published" | "draft",
          routeNumber: route.routeNumber,
          busNumber: route.busNumber,
          schoolName: route.schoolName,
          schoolLevel: route.schoolLevel,
          tripType: route.tripType,
          startTime: route.startTime,
          endTime: route.endTime,
        },
        update: {
          status: route.status as "published" | "draft",
          routeNumber: route.routeNumber,
          busNumber: route.busNumber,
          schoolName: route.schoolName,
          schoolLevel: route.schoolLevel,
          tripType: route.tripType,
          startTime: route.startTime,
          endTime: route.endTime,
        },
      });

      // Not every master-list row has a steps sheet committed yet
      // (route-master-list.csv can list a route ahead of its sheet
      // arriving) - skipped rather than erroring, same tolerance
      // page.tsx's own loader already has for this.
      const baseName = stepsCsvBaseName(route);
      const stepsPath = findStepsCsv(baseName);
      if (!stepsPath) continue;

      const stepsCsv = readFileSync(stepsPath, "utf8");
      const rows = parseRouteCsvRows(stepsCsv);

      await prisma.routeStep.deleteMany({ where: { routeId: route.id } });
      if (rows.length > 0) {
        await prisma.routeStep.createMany({
          data: rows.map((row, sequence) => ({
            routeId: route.id,
            sequence,
            action: row.action,
            fromAt: row.fromAt,
            ontoAt: row.ontoAt,
            riderCount: row.riderCount,
            side: row.side,
            notes: row.notes,
            skip: row.skip,
          })),
        });
      }
      stepRowCount += rows.length;
    }
    console.log(`Seeded ${masterList.length} routes, ${stepRowCount} steps rows.`);

    let waypointCount = 0;
    for (const fileName of readdirSync(DATA_DIR)) {
      if (!fileName.endsWith("-waypoints.json")) continue;
      const cache: WaypointCache = JSON.parse(readFileSync(join(DATA_DIR, fileName), "utf8"));
      for (const [cacheKey, entry] of Object.entries(cache)) {
        await prisma.waypoint.upsert({
          where: { cacheKey },
          create: {
            cacheKey,
            status: entry.status,
            lat: entry.status === "ok" ? entry.lat : null,
            lon: entry.status === "ok" ? entry.lon : null,
            displayName: entry.status === "ok" ? entry.displayName : null,
            source: entry.source,
            provider: entry.provider,
            message: entry.status === "error" ? entry.message : null,
            raw: entry.status === "error" ? (entry.raw ?? null) : null,
          },
          update: {
            status: entry.status,
            lat: entry.status === "ok" ? entry.lat : null,
            lon: entry.status === "ok" ? entry.lon : null,
            displayName: entry.status === "ok" ? entry.displayName : null,
            source: entry.source,
            provider: entry.provider,
            message: entry.status === "error" ? entry.message : null,
            raw: entry.status === "error" ? (entry.raw ?? null) : null,
          },
        });
        waypointCount += 1;
      }
    }
    console.log(`Seeded ${waypointCount} waypoint cache entries.`);
  } finally {
    await prisma.$disconnect();
  }
}

/** A route's steps sheet is committed under the district's own naming
 * convention (stepsCsvBaseName) but the file extension varies by which
 * route it is (route-125's is comma-separated and named with a
 * "route-" style header row but ends in .csv same as route-120's
 * tab-separated ones) - both are simply "<baseName>.csv" today, so
 * this is a single lookup, kept as its own function only so a future
 * second extension (e.g. a .tsv the district sends some other way)
 * has one obvious place to add. */
function findStepsCsv(baseName: string): string | null {
  const path = join(DATA_DIR, `${baseName}.csv`);
  return existsSync(path) ? path : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
