import type { WaypointQuery } from "./deriveWaypoints";
import type { WaypointCache } from "./waypointCache";
import { waypointCacheKey } from "./waypointCache";

/**
 * Per-row auto-resolve status, decoupled from wherever the actual
 * geocoding calls happen (ORS/Overpass via scripts/geocodeRoute.ts
 * today; a future in-app "auto-resolve coordinates" pass per the
 * README's "Next steps" - a green check + lat/lon, or a red X, live per
 * row as it runs). This module only reads a WaypointCache someone else
 * populated - it has no fetch of its own - so it works the same way
 * whether that cache came from a committed sidecar file or a live
 * in-progress run.
 */
export type RowResolutionStatus =
  | { stepId: number; status: "resolved"; lat: number; lon: number; displayName: string }
  // `reason` is always the short, friendly line the main interface
  // shows ("Not yet geocoded", or - for a real lookup failure - a
  // specific "\"Road\" not found" (see notFoundReason below) when the
  // failure was a genuine not-found, "Couldn't look up coordinates"
  // otherwise). `detail`/`raw` are both behind a "View Error" popup
  // instead, only present once an actual lookup attempt has failed
  // (never for a plain unattempted row, which has nothing technical to
  // show): `detail` is this app's own explanation, `raw` is the literal
  // response body a geocoder actually returned (when there was a real
  // HTTP response to quote at all - see WaypointCacheEntry's own doc).
  | { stepId: number; status: "unresolved"; reason: string; detail?: string; raw?: string }
  // A row deriveWaypoints.ts flagged as "unresolvable" (a driver
  // instruction, not a real road) - never queried at all, so it's kept
  // distinct from a real miss rather than shown as one.
  | { stepId: number; status: "skipped"; reason: string };

/** Every road name that appears on *both* sides of some other
 * already-resolved intersection elsewhere in this same route's cache -
 * a road a real intersection lookup actually found, so it's confirmed
 * correct as spelled. Built from the cache's own keys
 * (`intersection:${roadA} & ${roadB}`, see waypointCacheKey) rather
 * than re-deriving every waypoint's own roadA/roadB, since the keys
 * already carry exactly that pairing.
 *
 * Deliberately intersection-only, not address-derived - stripping a
 * house number back off an address string to guess its road name
 * would be its own source of false positives, for a case (a stop's own
 * literal address) this app doesn't otherwise need to solve. */
function confirmedRoadNames(cache: WaypointCache): Set<string> {
  const roads = new Set<string>();
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.status !== "ok" || !key.startsWith("intersection:")) continue;
    for (const road of key.slice("intersection:".length).split(" & ")) {
      if (road) roads.add(road);
    }
  }
  return roads;
}

/** The friendly, specific line for a genuine not-found (see
 * WaypointCacheEntry's own `notFound` doc) - quotes the actual
 * address/road name(s) rather than a generic "coordinates not found."
 * For an intersection, if exactly one of its two roads has already
 * resolved successfully elsewhere on this same route, that road's
 * spelling is confirmed correct - so the *other* one is the far more
 * likely typo, and gets called out on its own instead of naming both
 * roads as equally suspect. */
function notFoundReason(
  waypoint: Extract<WaypointQuery, { kind: "address" | "intersection" }>,
  confirmedRoads: Set<string>,
): string {
  if (waypoint.kind === "address") {
    return `"${waypoint.text}" not found`;
  }
  const aConfirmed = confirmedRoads.has(waypoint.roadA);
  const bConfirmed = confirmedRoads.has(waypoint.roadB);
  if (aConfirmed && !bConfirmed) {
    return `"${waypoint.roadB}" not found ("${waypoint.roadA}" confirmed by other stops on this route)`;
  }
  if (bConfirmed && !aConfirmed) {
    return `"${waypoint.roadA}" not found ("${waypoint.roadB}" confirmed by other stops on this route)`;
  }
  return `"${waypoint.roadA}" & "${waypoint.roadB}" not found`;
}

export function summarizeRouteResolution(
  waypoints: WaypointQuery[],
  cache: WaypointCache,
): RowResolutionStatus[] {
  const confirmedRoads = confirmedRoadNames(cache);

  return waypoints.map((waypoint) => {
    if (waypoint.kind === "unresolvable") {
      return { stepId: waypoint.stepId, status: "skipped", reason: waypoint.description };
    }

    const entry = cache[waypointCacheKey(waypoint)];
    if (entry?.status === "ok") {
      return {
        stepId: waypoint.stepId,
        status: "resolved",
        lat: entry.lat,
        lon: entry.lon,
        displayName: entry.displayName,
      };
    }

    if (entry?.status === "error") {
      return {
        stepId: waypoint.stepId,
        status: "unresolved",
        reason: entry.notFound ? notFoundReason(waypoint, confirmedRoads) : "Couldn't look up coordinates",
        detail: entry.message,
        raw: entry.raw,
      };
    }
    return { stepId: waypoint.stepId, status: "unresolved", reason: "Not yet geocoded" };
  });
}

export interface RouteResolutionCounts {
  resolved: number;
  unresolved: number;
  skipped: number;
  total: number;
}

export function resolutionCounts(rows: RowResolutionStatus[]): RouteResolutionCounts {
  return {
    resolved: rows.filter((r) => r.status === "resolved").length,
    unresolved: rows.filter((r) => r.status === "unresolved").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    total: rows.length,
  };
}
