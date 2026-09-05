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
  | { stepId: number; status: "unresolved"; reason: string }
  // A row deriveWaypoints.ts flagged as "unresolvable" (a driver
  // instruction, not a real road) - never queried at all, so it's kept
  // distinct from a real miss rather than shown as one.
  | { stepId: number; status: "skipped"; reason: string };

export function summarizeRouteResolution(
  waypoints: WaypointQuery[],
  cache: WaypointCache,
): RowResolutionStatus[] {
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

    return {
      stepId: waypoint.stepId,
      status: "unresolved",
      reason: entry?.status === "error" ? entry.message : "Not yet geocoded",
    };
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
