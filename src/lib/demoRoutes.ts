import type { Route, SchoolLevel } from "./types";

const NAME_PREFIXES = [
  "Oakwood",
  "Riverbend",
  "Maple Grove",
  "Sunset Hills",
  "Cedar Creek",
  "Willow Park",
  "Pinecrest",
  "Meadowbrook",
  "Silver Lake",
  "Eagle Ridge",
  "Briarwood",
  "Foxglove",
  "Harmony",
  "Northgate",
  "Stonebridge",
  "Ashford",
  "Clearwater",
  "Hilltop",
  "Magnolia",
  "Prairie View",
  "Redwood",
  "Sycamore",
  "Timberline",
  "Windsor",
];
// Paired rather than two separate arrays - each demo route needs both
// the display suffix and the real schoolLevel it implies (turn-by-turn
// instructions genuinely differ by level, not just cosmetically - see
// SchoolLevel in types.ts), and picking them independently could land
// on a suffix/level mismatch (a "High School" that's secretly
// "elementary"). Dropped the old fourth option, "Academy" - it didn't
// map to any real SchoolLevel.
const NAME_SUFFIXES: { suffix: string; level: SchoolLevel }[] = [
  { suffix: "Elementary", level: "elementary" },
  { suffix: "Middle School", level: "middle" },
  { suffix: "High School", level: "high" },
];
const TRIP_LABELS = ["Morning Pickup", "Afternoon Drop Off"] as const;
const DRIVER_FIRST = [
  "Maria",
  "James",
  "Linda",
  "Carlos",
  "Patricia",
  "Kevin",
  "Angela",
  "Brian",
  "Nicole",
  "Tyrell",
];
const DRIVER_LAST = [
  "Garcia",
  "Nguyen",
  "Smith",
  "Johnson",
  "Patel",
  "Brown",
  "Davis",
  "Lee",
  "Martinez",
  "Coleman",
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Picks n distinct elements out of arr, without replacement.
function pickRandomSubset<T>(rng: () => number, arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const index = Math.floor(rng() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

// The real route (see placeholderMeta.ts) is always a favorite; this
// many *demo* routes join it, for six total.
const FAVORITE_DEMO_COUNT = 5;

// A tiny seeded PRNG (mulberry32) rather than Math.random() - keeps the
// demo list stable across re-renders and navigating back to it within a
// session, instead of reshuffling every time this screen remounts.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDepartureTime(rng: () => number): string {
  const hour24 = 6 + Math.floor(rng() * 11); // 6:00 AM - 4:55 PM
  const minute = Math.floor(rng() * 12) * 5;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/**
 * Fabricates filler routes for the route-list screen, so its scrolling
 * (and now search filtering) can actually be exercised - there's only
 * one real route (route-125.csv) right now. Each one reuses the real
 * route's turn-by-turn steps under fabricated display metadata, marked
 * `status: "demo"` (see RouteStatus in types.ts) so the list can tell
 * them apart from real district data at a glance - the same "not real,
 * just a placeholder" spirit as the "Demo only placeholder, not actual
 * map" label elsewhere in the app, just formalized as a real field
 * instead of only a visual convention. Tapping one still leads to a
 * working trip-summary/step flow instead of a dead end.
 */
export function buildDemoRoutes(base: Route, count: number): Route[] {
  const rng = mulberry32(42);
  const usedNumbers = new Set([base.routeNumber]);

  const routes: Route[] = Array.from({ length: count }, () => {
    let routeNumber: string;
    do {
      routeNumber = String(100 + Math.floor(rng() * 900));
    } while (usedNumbers.has(routeNumber));
    usedNumbers.add(routeNumber);

    // Its own draw, deliberately independent of routeNumber - real
    // routes' bus number *is* their route number (see
    // route-125-meta.csv and Route.id's own doc comment in types.ts),
    // so a demo route deliberately keeping them mismatched is now one
    // more signal (alongside status: "demo" below) that it's fake, not
    // real district data. Only re-rolls against a collision with its
    // *own* route's number - unlike routeNumber, bus numbers aren't
    // expected to be unique across routes (a district reuses buses).
    let busNumber: string;
    do {
      busNumber = String(100 + Math.floor(rng() * 900));
    } while (busNumber === routeNumber);

    const { suffix, level: schoolLevel } = pick(rng, NAME_SUFFIXES);
    const school = `${pick(rng, NAME_PREFIXES)} ${suffix}`;
    const tripLabel = pick(rng, TRIP_LABELS);
    const tripType = tripLabel === "Morning Pickup" ? "pickup" : "dropoff";

    return {
      ...base,
      // Same `${routeNumber}-${tripType}-${schoolLevel}` convention as
      // the real route (see Route.id's doc comment in types.ts) -
      // routeNumber alone is already unique across every demo route
      // (usedNumbers, above), so this doesn't need its own collision
      // check.
      id: `${routeNumber}-${tripType}-${schoolLevel}`,
      status: "demo",
      routeNumber,
      name: `${school} — ${tripLabel}`,
      schoolName: school,
      schoolLevel,
      driverName: `${pick(rng, DRIVER_FIRST)} ${pick(rng, DRIVER_LAST)}`,
      busNumber,
      departureTime: randomDepartureTime(rng),
      tripType,
      distance: `${(4 + rng() * 12).toFixed(1)} mi`,
      durationMinutes: 15 + Math.floor(rng() * 35),
      isFavorite: false,
    };
  });

  // Only routes numbered higher than the real one are eligible - so
  // that one always sorts/reads first among favorites, "125" being the
  // lowest of the bunch, purely for demo legibility (see
  // RouteListScreen's Favorites view, which pins it first).
  const eligible = routes.filter((r) => Number(r.routeNumber) > Number(base.routeNumber));
  const favoriteNumbers = new Set(
    pickRandomSubset(rng, eligible, FAVORITE_DEMO_COUNT).map((r) => r.routeNumber),
  );

  return routes.map((r) => (favoriteNumbers.has(r.routeNumber) ? { ...r, isFavorite: true } : r));
}
