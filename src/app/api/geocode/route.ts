import { NextResponse } from "next/server";
import { extractCityState, getLastKnownOrsQuota } from "@/lib/geocode";
import type { ApiQuota, GeocodableQuery } from "@/lib/geocode";
import { fetchLocationList, fetchOneLocation } from "@/lib/resolveWaypoint";
import type { WaypointCacheEntry } from "@/lib/waypointCache";

/**
 * Server-side endpoint behind EditRouteScreen.tsx's "Fetch Location"
 * (one row), "Fetch Missing", and "Re-fetch All" buttons - a route
 * handler, not a client-side call, specifically so `ORS_API_KEY` stays
 * a server-only environment variable and is never shipped to the
 * browser. Resolves each query the same way scripts/geocodeRoute.ts
 * does for the batch pipeline (see resolveWaypoint.ts) - ORS for a
 * plain address, Overpass for an intersection, anchored on the
 * school's own address for the search box - just via
 * resolveWaypoint.ts's own admin-facing pair,
 * fetchOneLocation/fetchLocationList, rather than the CLI script's own
 * resolveGeocodableQuery.
 *
 * Deliberately synchronous/one-shot: the whole batch resolves before
 * this responds, no incremental per-row streaming - acceptable for the
 * handful of stops one route has, and far simpler than a
 * Server-Sent-Events/WebSocket setup would be for what's still an
 * admin-only tool.
 */

const RATE_LIMIT_MS = 1100;

interface GeocodeRequestBody {
  /** One query, or a batch - every query here is always geocodable
   * (see fetchLocation/runFetchAll, EditRouteScreen.tsx): an
   * "unresolvable" WaypointQuery (deriveWaypoints.ts) is filtered out
   * client-side before it ever reaches this endpoint, so this doesn't
   * need to handle - or even accept - that kind at all. */
  query: GeocodableQuery | GeocodableQuery[];
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
   * (every query was a plain address). */
  anchor: { lat: number; lon: number } | null;
  /** Parallel to the request's own query array. */
  results: WaypointCacheEntry[];
  /** OpenRouteService's own account-wide rate limit, if this batch made
   * at least one real ORS request and it happened to report one (see
   * geocode.ts's own getLastKnownOrsQuota) - null otherwise, including
   * when every query in the batch was an Overpass intersection lookup
   * instead. */
  quota: ApiQuota | null;
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

  const anchor = body.anchor ?? null;
  const adminCtx = { schoolAddress, locationContext, apiKey, anchor };

  // A single query (the "Fetch Location" button) and a list (either
  // Fetch Coordinates modal button) are genuinely different requests,
  // not the same loop run once vs. many times - fetchOneLocation has
  // no `near` point to carry anywhere, and fetchLocationList's pacing
  // between calls would be pure overhead for exactly one.
  if (!Array.isArray(body.query)) {
    const result = await fetchOneLocation(body.query, adminCtx);
    if ("error" in result) return NextResponse.json({ error: result.error, raw: result.raw }, { status: 502 });
    const responseBody: GeocodeResponseBody = {
      anchor: result.anchor,
      results: [result.entry],
      quota: getLastKnownOrsQuota(),
    };
    return NextResponse.json(responseBody);
  }

  const result = await fetchLocationList(body.query, { ...adminCtx, rateLimitMs: RATE_LIMIT_MS });
  if ("error" in result) return NextResponse.json({ error: result.error, raw: result.raw }, { status: 502 });
  const responseBody: GeocodeResponseBody = {
    anchor: result.anchor,
    results: result.results,
    quota: getLastKnownOrsQuota(),
  };
  return NextResponse.json(responseBody);
}
