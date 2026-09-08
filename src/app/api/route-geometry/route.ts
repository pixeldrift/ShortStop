import { NextResponse } from "next/server";
import { computeRouteGeometry } from "@/lib/routing/route";
import type { RouteWaypoint } from "@/lib/routing/types";

/**
 * Server-side endpoint behind RouteMap.tsx's own road-following route
 * line - a route handler, not a client-side call, specifically so
 * ORS_API_KEY stays a server-only environment variable and is never
 * shipped to the browser, same reasoning src/app/api/geocode/route.ts
 * already documents for that same key. Takes an ordered list of
 * already-geocoded waypoints - RouteMap.tsx resolves these itself from
 * the shared waypoint cache plus the route's own school point (see its
 * own doc comment for where the school gets spliced in) - this
 * endpoint has no waypoint-cache concerns of its own, purely routing.
 * Hands back normalized GeoJSON geometry (src/lib/routing/types.ts),
 * independent of whichever provider (src/lib/routing/route.ts)
 * actually computed it.
 */

interface RouteGeometryRequestBody {
  waypoints: RouteWaypoint[];
}

function isValidWaypoint(w: unknown): w is RouteWaypoint {
  return (
    typeof w === "object" &&
    w !== null &&
    typeof (w as RouteWaypoint).lat === "number" &&
    typeof (w as RouteWaypoint).lon === "number"
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: RouteGeometryRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.waypoints) || body.waypoints.length < 2) {
    return NextResponse.json({ error: "At least two waypoints are required." }, { status: 400 });
  }
  if (!body.waypoints.every(isValidWaypoint)) {
    return NextResponse.json({ error: "Every waypoint needs a numeric lat and lon." }, { status: 400 });
  }

  try {
    const result = await computeRouteGeometry(body.waypoints);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
