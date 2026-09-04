import type { WaypointQuery } from "./deriveWaypoints";
import type { WaypointCacheEntry } from "./waypointCache";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy requires a real, identifying User-Agent on
// every request - not optional, and not the default one `fetch` sends.
const USER_AGENT = "ShortStop-prototype (https://github.com/pixeldrift/ShortStop)";

/** Pulls "City, ST" off the end of a full street address, e.g.
 * "1425 Lake Forest Dr, Smyrna, TN 37167" -> "Smyrna, TN" - used to
 * give every other query in the route (which don't carry their own
 * city/state) the same geographic context to search within. */
export function extractCityState(address: string): string | null {
  const match = address.match(/,\s*([^,]+,\s*[A-Z]{2})\s*\d{5}\s*$/);
  return match ? match[1] : null;
}

/** True for an address that already ends in a state code (and
 * usually a zip) of its own, so appending the route's shared
 * city/state context would just repeat it. */
function hasStateSuffix(address: string): boolean {
  return /,\s*[A-Z]{2}(\s+\d{5})?\s*$/.test(address.trim());
}

/** Builds the free-text search string sent to Nominatim for one
 * derived waypoint. */
export function queryTextFor(query: WaypointQuery, locationContext: string): string {
  if (query.kind === "address") {
    return hasStateSuffix(query.text) ? query.text : `${query.text}, ${locationContext}`;
  }
  return `${query.roadA} and ${query.roadB}, ${locationContext}`;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Looks up one query via Nominatim's free-text search - a single
 * best-guess result (`limit=1`), US-only (`countrycodes=us`) since
 * this app has no routes outside it yet. Returns a cache-ready
 * WaypointCacheEntry either way, never throws for "no result" (that's
 * an `error` entry, not an exception) - only a genuine network/HTTP
 * failure throws, since retrying that is a different concern than a
 * query that just didn't resolve to anything.
 */
export async function geocodeQuery(
  query: WaypointQuery,
  locationContext: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WaypointCacheEntry> {
  const source = queryTextFor(query, locationContext);
  const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(source)}`;

  const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Nominatim returned ${res.status} ${res.statusText} for "${source}"`);
  }

  const results = (await res.json()) as NominatimResult[];
  const [first] = results;
  if (!first) {
    return { status: "error", message: "No geocoding result", source };
  }

  return {
    status: "ok",
    lat: Number(first.lat),
    lon: Number(first.lon),
    displayName: first.display_name,
    source,
  };
}
