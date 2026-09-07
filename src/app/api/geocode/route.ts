import { NextResponse } from "next/server";
import { extractCityState, getLastKnownOrsQuota } from "@/lib/geocode";
import type { ApiQuota, GeocodableQuery } from "@/lib/geocode";
import { fetchOneLocation } from "@/lib/resolveWaypoint";
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
 * resolveWaypoint.ts's own admin-facing `fetchOneLocation`, rather
 * than the CLI script's own `resolveGeocodableQuery`.
 *
 * One query per request, always - "Fetch Missing"/"Re-fetch All" used
 * to send their whole list in a single request (resolved server-side
 * via a since-removed `fetchLocationList`), but that gave the client no
 * way to show real progress partway through a batch, only "did the
 * whole thing finish yet." EditRouteScreen.tsx's own `runFetchAll` now
 * loops one request at a time instead, pacing itself between calls
 * client-side - simpler than building real incremental server-side
 * streaming (Server-Sent-Events/WebSocket) for what's still an
 * admin-only tool, and this endpoint's own shape stays exactly the
 * same either way.
 */

interface GeocodeRequestBody {
  /** Always geocodable (see fetchLocation/runFetchAll,
   * EditRouteScreen.tsx): an "unresolvable" WaypointQuery
   * (deriveWaypoints.ts) is filtered out client-side before it ever
   * reaches this endpoint, so this doesn't need to handle - or even
   * accept - that kind at all. */
  query: GeocodableQuery;
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
   * address every time. Null if this query didn't need one (a plain
   * address). */
  anchor: { lat: number; lon: number } | null;
  /** The school's own address, as a real cache entry - only present
   * when this exact request is what freshly resolved it (see
   * fetchOneLocation's own doc comment). The caller should persist
   * this under the school address's own cache key so the interactive
   * Fetch Location/Fetch All flow actually saves it somewhere real,
   * not just this session's own `anchor` state above. */
  anchorEntry: WaypointCacheEntry | null;
  result: WaypointCacheEntry;
  /** OpenRouteService's own account-wide rate limit, if this request
   * made a real ORS request and it happened to report one (see
   * geocode.ts's own getLastKnownOrsQuota) - null otherwise, including
   * for an Overpass intersection lookup that reused an already-known
   * anchor. */
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
  const result = await fetchOneLocation(body.query, { schoolAddress, locationContext, apiKey, anchor });
  if ("error" in result) return NextResponse.json({ error: result.error, raw: result.raw }, { status: 502 });

  const responseBody: GeocodeResponseBody = {
    anchor: result.anchor,
    anchorEntry: result.anchorEntry,
    result: result.entry,
    quota: getLastKnownOrsQuota(),
  };
  return NextResponse.json(responseBody);
}
