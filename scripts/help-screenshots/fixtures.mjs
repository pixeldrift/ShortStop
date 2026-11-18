// Mock backend for the help-screenshot harness (capture.mjs): serves the
// bundled sample data under public/data as the same JSON the real API
// routes return from Postgres, so the app can be screenshotted with no
// database. Run through tsx (it imports the app's own TypeScript parsers).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRouteCsvRows } from "../../src/lib/parseRouteCsv.ts";
import { parseSchoolsCsv } from "../../src/lib/parseSchoolsCsv.ts";
import { stepsCsvBaseName } from "../../src/lib/parseRouteMasterList.ts";
import { parseAddress, formatAddress } from "../../src/lib/schoolAddress.ts";
import { tripTypeFullLabel } from "../../src/lib/tripType.ts";
import { durationBetween24HourTimes, format24HourAsAmPm } from "../../src/lib/time.ts";

const DATA = join(process.cwd(), "public", "data");
const LEVEL = { EL: "elementary", MS: "middle", HS: "high" };

export function buildFixtures() {
  const schoolsRaw = parseSchoolsCsv(readFileSync(join(DATA, "schools.csv"), "utf8"));
  const schools = Object.fromEntries(
    Object.entries(schoolsRaw).map(([name, info]) => [
      name,
      { address: formatAddress(parseAddress(info.address)), schoolLevel: info.schoolLevel, lat: info.lat ?? null, lon: info.lon ?? null },
    ]),
  );

  const [header, ...lines] = readFileSync(join(DATA, "route-master-list.csv"), "utf8").trim().split(/\r?\n/);
  const heads = header.split("\t").map((h) => h.trim());
  const masterList = [];
  const steps = {};
  for (const line of lines.filter((l) => l.trim())) {
    const v = line.split("\t").map((x) => x.trim());
    const row = Object.fromEntries(heads.map((h, i) => [h, v[i] ?? ""]));
    const tripType = row.am_pm.toUpperCase() === "AM" ? "pickup" : "dropoff";
    const schoolLevel = LEVEL[row.school_type.toUpperCase()];
    const id = row.route_id || `${row.route_number}-${tripType}-${schoolLevel}`;
    masterList.push({
      id,
      status: row.status.toLowerCase(),
      routeNumber: row.route_number,
      name: `${row.school_name} — ${tripTypeFullLabel(tripType)}`,
      busNumber: row.bus_number,
      schoolName: row.school_name,
      schoolLevel,
      tripType,
      departureTime: format24HourAsAmPm(row.start_time),
      durationMinutes: row.end_time ? durationBetween24HourTimes(row.start_time, row.end_time) : undefined,
      nextRouteId: null,
    });
    try {
      const csv = readFileSync(join(DATA, `${stepsCsvBaseName({ routeNumber: row.route_number, tripType, schoolLevel })}.csv`), "utf8");
      steps[id] = parseRouteCsvRows(csv).map((r) => ({ ...r, overrideLat: null, overrideLon: null }));
    } catch {
      /* no steps sheet for this route */
    }
  }

  const waypoints = {};
  for (const f of readdirSync(DATA).filter((n) => n.endsWith("-waypoints.json"))) {
    Object.assign(waypoints, JSON.parse(readFileSync(join(DATA, f), "utf8")));
  }

  const savedLocations = [
    { id: 1, name: "Bus Yard", address: "100 Transportation Way, La Vergne, TN 37086", lat: 36.0451, lon: -86.5528 },
  ];

  return { schools, masterList, steps, waypoints, savedLocations };
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function hav(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line stand-in for the ORS road geometry. */
export function fakeGeometry(waypoints) {
  const dists = [0];
  for (let i = 1; i < waypoints.length; i++) dists.push(dists[i - 1] + hav(waypoints[i - 1], waypoints[i]));
  return {
    geometry: { type: "LineString", coordinates: waypoints.map((w) => [w.lon, w.lat]) },
    distanceMeters: dists[dists.length - 1],
    durationSeconds: dists[dists.length - 1] / 10,
    waypointDistances: dists,
    provider: "mock",
  };
}
