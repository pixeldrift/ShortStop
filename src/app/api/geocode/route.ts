import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractCityState } from "@/lib/geocode";
import type { GeocodableQuery } from "@/lib/geocode";
import { fetchOneLocation } from "@/lib/resolveWaypoint";
import type { FallbackDetail } from "@/lib/resolveWaypoint";
import { CARDINAL_LABELS, intersectionVariantKey, waypointCacheKey } from "@/lib/waypointCache";
import type { WaypointCache, WaypointCacheEntry } from "@/lib/waypointCache";
import { toEntry } from "@/app/api/waypoints/route";

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
  /** True only for EditRouteScreen.tsx's own single-row Fetch button -
   * opts this request into the street-type/spelling/loop-snap fallback
   * pipeline (resolveWaypoint.ts's own lookupCoordinatesWithFallback)
   * when the plain lookup fails, rather than just reporting the plain
   * miss. Omitted (or false) for a batch call ("Fetch Missing"/
   * "Re-fetch All"), which has no way to pause and ask an admin to
   * confirm a fallback match the way GeocodeConfirmModal does. */
  allowFallback?: boolean;
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
  /** The cache key `result` actually belongs under - see
   * fetchOneLocation's own doc comment. The caller persists `result`
   * under *this* key (via /api/waypoints), not necessarily whatever
   * its own client-side waypointCacheKey(query) would compute - the
   * two only ever differ for an intersection query bound to a known
   * second crossing instead of its own base key. */
  key: string;
  result: WaypointCacheEntry;
  /** A second real candidate this request just discovered for an
   * intersection query - see fetchOneLocation's own doc comment. Null
   * the overwhelming rest of the time. The caller should persist this
   * too, the same way it persists `key`/`result`. */
  discoveredAlternate: { key: string; entry: WaypointCacheEntry } | null;
  /** Set only when `allowFallback` was sent and a fallback strategy is
   * what actually produced `result` - null for a plain exact match, or
   * whenever `allowFallback` wasn't sent at all. EditRouteScreen.tsx's
   * fetchLocation holds off on persisting `result` and shows
   * GeocodeConfirmModal instead whenever this isn't null. */
  fallback: FallbackDetail | null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ORS_API_KEY isn't configured on the server - see .env.local.example.",
      },
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
    return NextResponse.json(
      { error: "schoolAddress is required." },
      { status: 400 },
    );
  }
  const locationContext = extractCityState(schoolAddress);
  if (!locationContext) {
    return NextResponse.json(
      {
        error: `Couldn't pull a "City, ST" context out of schoolAddress: "${schoolAddress}"`,
      },
      { status: 400 },
    );
  }

  const anchor = body.anchor ?? null;

  // Only an intersection query can have a known second crossing to
  // bind to (resolveIntersectionKeyed's own doc, resolveWaypoint.ts) -
  // a plain address never does, so this stays an empty object (no
  // query) for the overwhelming majority of requests. Read straight
  // from Postgres rather than trusting anything the client claims is
  // cached - the shared cache table is the one source of truth here,
  // not whatever this particular browser tab happened to fetch last.
  let cache: WaypointCache = {};
  if (body.query.kind === "intersection") {
    const baseKey = waypointCacheKey(body.query);
    const keys = [baseKey, ...CARDINAL_LABELS.map((label) => intersectionVariantKey(baseKey, label))];
    const rows = await prisma.waypoint.findMany({ where: { cacheKey: { in: keys } } });
    cache = Object.fromEntries(rows.map((row) => [row.cacheKey, toEntry(row)]));
  }

  const result = await fetchOneLocation(body.query, {
    schoolAddress,
    locationContext,
    apiKey,
    anchor,
    allowFallback: body.allowFallback,
    cache,
  });
  if ("error" in result)
    return NextResponse.json(
      { error: result.error, raw: result.raw },
      { status: 502 },
    );

  const responseBody: GeocodeResponseBody = {
    anchor: result.anchor,
    anchorEntry: result.anchorEntry,
    key: result.key,
    result: result.entry,
    discoveredAlternate: result.discoveredAlternate,
    fallback: result.fallback,
  };
  return NextResponse.json(responseBody);
}
