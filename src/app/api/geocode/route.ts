import { NextResponse } from "next/server";
import type { WaypointQuery } from "@/lib/deriveWaypoints";
import { extractCityState } from "@/lib/geocode";
import type { GeocodableQuery } from "@/lib/geocode";
import { resolveGeocodableQuery, resolveSchoolAnchor } from "@/lib/resolveWaypoint";
import type { WaypointCacheEntry } from "@/lib/waypointCache";

/**
 * Server-side endpoint behind EditRouteScreen.tsx's "Fetch Location"
 * (one row) and "Fetch All Locations" (every unresolved row) buttons -
 * a route handler, not a client-side call, specifically so
 * `ORS_API_KEY` stays a server-only environment variable and is never
 * shipped to the browser. Resolves each query the same way
 * scripts/geocodeRoute.ts does for the batch pipeline (see
 * resolveWaypoint.ts, shared by both) - ORS for a plain address,
 * Overpass for an intersection, anchored on the school's own address
 * for the search box.
 *
 * Deliberately synchronous/one-shot: the whole batch resolves before
 * this responds, no incremental per-row streaming - acceptable for the
 * handful of stops one route has, and far simpler than a
 * Server-Sent-Events/WebSocket setup would be for what's still an
 * admin-only tool.
 */

const SEARCH_RADIUS_DEG = 0.06;
const RATE_LIMIT_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GeocodeRequestBody {
  /** One query, or a batch - always normalized to an array below. */
  query: WaypointQuery | WaypointQuery[];
  schoolAddress: string;
  /** The school's own already-known anchor point, if the caller has
   * one from an earlier call this session - skips re-geocoding the
   * school address for every single "Fetch Location" click. */
  anchor?: { lat: number; lon: number };
}

export interface GeocodeResponseBody {
  /** The anchor actually used (whether supplied or freshly geocoded
   * here) - callers should cache this and pass it back on their next
   * request rather than making this endpoint re-geocode the school
   * address every time. Null if no query in the batch needed one
   * (every query was a plain address, or all were unresolvable). */
  anchor: { lat: number; lon: number } | null;
  /** Parallel to the request's own query array - null for an
   * "unresolvable" query (nothing to look up at all, see
   * deriveWaypoints.ts), an entry otherwise. */
  results: (WaypointCacheEntry | null)[];
}

export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ORS_API_KEY isn't configured on the server - see .env.local.example." },
      { status: 500 },
    );
  }

  let body: GeocodeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const queries: WaypointQuery[] = Array.isArray(body.query) ? body.query : [body.query];
  const schoolAddress = body.schoolAddress?.trim();
  if (!schoolAddress) {
    return NextResponse.json({ error: "schoolAddress is required." }, { status: 400 });
  }
  const locationContext = extractCityState(schoolAddress);
  if (!locationContext) {
    return NextResponse.json(
      { error: `Couldn't pull a "City, ST" context out of schoolAddress: "${schoolAddress}"` },
      { status: 400 },
    );
  }

  let anchor = body.anchor ?? null;
  let lastResolved = anchor;
  const results: (WaypointCacheEntry | null)[] = [];

  for (const [index, query] of queries.entries()) {
    if (query.kind === "unresolvable") {
      results.push(null);
      continue;
    }
    if (index > 0) await sleep(RATE_LIMIT_MS);

    const geocodable = query as GeocodableQuery;

    if (geocodable.kind === "intersection" && !anchor) {
      const { entry: anchorEntry, point } = await resolveSchoolAnchor(schoolAddress, locationContext, apiKey);
      if (!point) {
        return NextResponse.json(
          {
            error: `Couldn't geocode the school address itself: ${
              anchorEntry.status === "error" ? anchorEntry.message : "unknown error"
            }`,
          },
          { status: 502 },
        );
      }
      anchor = point;
      lastResolved = lastResolved ?? anchor;
      await sleep(RATE_LIMIT_MS);
    }

    const { entry, resolvedPoint } = await resolveGeocodableQuery(geocodable, {
      locationContext,
      apiKey,
      anchor,
      near: lastResolved,
      searchRadiusDeg: SEARCH_RADIUS_DEG,
    });
    if (resolvedPoint) lastResolved = resolvedPoint;
    results.push(entry);
  }

  const responseBody: GeocodeResponseBody = { anchor, results };
  return NextResponse.json(responseBody);
}
