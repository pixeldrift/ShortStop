import type { WaypointQuery } from "./deriveWaypoints";
import type { WaypointCacheEntry } from "./waypointCache";

/** Pulls "City, ST" off the end of a full street address, e.g.
 * "1425 Lake Forest Dr, Smyrna, TN 37167" -> "Smyrna, TN" - used to
 * give every other query in the route (which don't carry their own
 * city/state) the same geographic context to search within. Not tied
 * to any particular geocoding provider - every provider below builds
 * its query text off this. */
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

/** A WaypointQuery that's actually geocodable - excludes "unresolvable",
 * which by design never reaches a geocoder at all (see
 * deriveWaypoints.ts). Every free-text provider below takes only this
 * narrowed type, so a caller holding a full WaypointQuery must filter
 * "unresolvable" ones out first - a compile-time guardrail rather than
 * a runtime check that could silently no-op instead. */
export type GeocodableQuery = Extract<WaypointQuery, { kind: "address" | "intersection" }>;

/** Builds the free-text search string sent to whichever geocoding
 * provider is active - shared across all of them below, since it's
 * just plain-English query construction, nothing provider-specific. */
export function queryTextFor(query: GeocodableQuery, locationContext: string): string {
  if (query.kind === "address") {
    return hasStateSuffix(query.text) ? query.text : `${query.text}, ${locationContext}`;
  }
  return `${query.roadA} and ${query.roadB}, ${locationContext}`;
}

/**
 * What every geocoding provider looks like from the outside - callers
 * (scripts/geocodeRoute.ts) only ever talk to this shape, never to a
 * specific provider's own request/response format. Swapping which
 * service actually resolves a query is a one-line change at the
 * bottom of this file (`geocodeQuery`'s assignment), not a change
 * anywhere a query is actually made. `apiKey` is passed through
 * uniformly even though not every provider needs one (Nominatim
 * ignores it) - the caller (which is what reads it out of the
 * environment) shouldn't need to know which providers do.
 */
export type GeocodeProvider = (
  query: GeocodableQuery,
  locationContext: string,
  apiKey: string,
  fetchImpl?: typeof fetch,
) => Promise<WaypointCacheEntry>;

// ---- OpenRouteService (Pelias-based) - the active provider ----
//
// Picked over Nominatim (below) because Nominatim's usage policy is
// enforced by IP address, not an API key - fine for a human clicking
// around a website, but it means GitHub Actions' shared runner IPs get
// blocked outright regardless of how the request identifies itself
// (confirmed: a stronger User-Agent didn't help, three identical
// failures in a row - see README, "Maps, part four"). ORS is key-based
// instead, so CI works, and it's a service this app already needs for
// routing/directions - one API key covers both instead of two separate
// external dependencies. Still ultimately OSM-rooted data (Pelias
// blends OSM with a few other open sources), matching "OSM for our
// data" - just reached through a provider that doesn't block CI.

const ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search";

interface OrsFeature {
  geometry: { coordinates: [number, number] }; // GeoJSON order: [lon, lat]
  properties: { label: string };
}

interface OrsGeocodeResponse {
  features: OrsFeature[];
}

/** OpenRouteService's own account-wide rate limit, as reported by the
 * `X-Ratelimit-*` response headers on the most recent real ORS request
 * this server process has made. Not guaranteed to exist - ORS's exact
 * gating/quota semantics aren't confirmed (see README's own "Next
 * steps" note on this) - so a caller should treat a missing value as
 * "unknown," never as "unlimited" or "zero." Module-level rather than
 * threaded through GeocodeProvider's own per-query return type, since
 * it's one account-wide number every request already reports
 * redundantly, not something specific to whichever query triggered it.
 */
export interface ApiQuota {
  limit: number;
  remaining: number;
}
let lastKnownQuota: ApiQuota | null = null;
export function getLastKnownOrsQuota(): ApiQuota | null {
  return lastKnownQuota;
}

export const geocodeViaOpenRouteService: GeocodeProvider = async (
  query,
  locationContext,
  apiKey,
  fetchImpl = fetch,
) => {
  const source = queryTextFor(query, locationContext);
  const url =
    `${ORS_GEOCODE_URL}?api_key=${encodeURIComponent(apiKey)}` +
    `&text=${encodeURIComponent(source)}&size=1&boundary.country=US`;

  const res = await fetchImpl(url);

  // Read before the ok-check below, deliberately - a request that
  // finally trips the rate limit (a 429) is exactly the response most
  // worth capturing this from.
  const limitHeader = res.headers.get("X-Ratelimit-Limit");
  const remainingHeader = res.headers.get("X-Ratelimit-Remaining");
  if (limitHeader != null && remainingHeader != null) {
    const limit = Number(limitHeader);
    const remaining = Number(remainingHeader);
    if (Number.isFinite(limit) && Number.isFinite(remaining)) {
      lastKnownQuota = { limit, remaining };
    }
  }

  if (!res.ok) {
    // ORS's own error body (when there is one) usually says *why* -
    // "quota exceeded," "rate limit," an invalid key - which a bare
    // status/statusText doesn't distinguish, and every one of those
    // needs a different fix. Best-effort only: a body read failure here
    // shouldn't hide the real HTTP error behind a second, unrelated one.
    // Kept separate from `message` (this app's own explanatory
    // sentence) as `raw` - the literal response body ORS sent back,
    // not this app's own writing, so a caller showing both to someone
    // can keep them visibly distinct instead of one blended string.
    const detail = await res.text().catch(() => "");
    return {
      status: "error",
      message: `OpenRouteService geocoding returned ${res.status} ${res.statusText} for "${source}"`,
      raw: detail || undefined,
      source,
      provider: "openrouteservice",
    };
  }

  const body = (await res.json()) as OrsGeocodeResponse;
  const [first] = body.features;
  if (!first) {
    return { status: "error", message: "No geocoding result", notFound: true, source, provider: "openrouteservice" };
  }

  const [lon, lat] = first.geometry.coordinates;
  return {
    status: "ok",
    lat,
    lon,
    displayName: first.properties.label,
    source,
    provider: "openrouteservice",
  };
};

// ---- Nominatim - kept for reference/local use, not CI-friendly ----
//
// Free, no API key, and it's OSM's own geocoder - great for a human
// running `npm run geocode` from their own machine, where the
// IP-based usage policy isn't an issue. Not currently the active
// provider (see below) purely because of the CI IP-blocking problem
// above, not because anything about it is wrong for this app's data.

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy requires a real, identifying User-Agent on
// every request - not optional, and not the default one `fetch` sends.
const NOMINATIM_USER_AGENT = "ShortStop-prototype (https://github.com/pixeldrift/ShortStop/issues)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export const geocodeViaNominatim: GeocodeProvider = async (
  query,
  locationContext,
  _apiKey,
  fetchImpl = fetch,
) => {
  const source = queryTextFor(query, locationContext);
  const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(source)}`;

  const res = await fetchImpl(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Nominatim returned ${res.status} ${res.statusText} for "${source}"`);
  }

  const results = (await res.json()) as NominatimResult[];
  const [first] = results;
  if (!first) {
    return { status: "error", message: "No geocoding result", notFound: true, source, provider: "nominatim" };
  }

  return {
    status: "ok",
    lat: Number(first.lat),
    lon: Number(first.lon),
    displayName: first.display_name,
    source,
    provider: "nominatim",
  };
};

/** The active provider - every caller in the app goes through this one
 * name. Swap which service actually resolves queries by changing this
 * assignment alone. */
export const geocodeQuery: GeocodeProvider = geocodeViaOpenRouteService;
