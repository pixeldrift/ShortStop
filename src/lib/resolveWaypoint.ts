import { geocodeQuery } from "./geocode";
import type { GeocodableQuery } from "./geocode";
import { boundingBoxAround, OverpassHttpError, pickNearest, resolveIntersection } from "./overpassGeocode";
import type { BoundingBox } from "./overpassGeocode";
import type { WaypointCacheEntry } from "./waypointCache";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `geocodeQuery` only ever throws for a genuinely unexpected failure
 * now (a network exception, a malformed JSON body) - a real HTTP-level
 * error (403/429/5xx) returns a normal error entry directly (see
 * geocode.ts's own doc). Every caller in this module still needs a
 * WaypointCacheEntry back either way, never a rejected promise, so
 * this is the one place that safety-net catch lives instead of every
 * call site repeating it. Nothing "raw" to attach here - an exception
 * this generic was never a real HTTP response with a body to quote. */
async function safeGeocodeQuery(
  query: GeocodableQuery,
  locationContext: string,
  apiKey: string,
): Promise<WaypointCacheEntry> {
  try {
    return await geocodeQuery(query, locationContext, apiKey);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      source: query.kind === "address" ? query.text : `${query.roadA} and ${query.roadB}, ${locationContext}`,
      provider: "openrouteservice",
    };
  }
}

/**
 * `lookupCoordinates` at the bottom is the one real implementation of
 * "turn an address or cross-street intersection into a lat/lon" -
 * everything else in this module (`resolveSchoolAnchor`,
 * `resolveGeocodableQuery`, both shared between scripts/geocodeRoute.ts
 * - the batch CLI/CI pipeline - and src/app/api/geocode/route.ts - the
 * Add/Edit Route screen's on-demand "Fetch Location"/"Fetch All
 * Locations" buttons) is a thin wrapper around it that adds the
 * batch-pipeline bookkeeping (`anchor`/`near` carried across many
 * calls, an already-known API key threaded through rather than re-read
 * per call) those two callers need. Reach for `lookupCoordinates`
 * itself directly for a standalone lookup that doesn't need any of
 * that; reach for the batch wrappers when resolving a whole route's
 * worth of queries in one pass.
 */

/** The bounding-box half-width (in degrees) `lookupCoordinates` and
 * src/app/api/geocode/route.ts both search an intersection query
 * within - shared so the two don't drift to different values. Wide
 * enough to comfortably contain a school's attendance zone, narrow
 * enough that two same-named roads in different towns don't collide
 * inside it (see overpassGeocode.ts's own boundingBoxAround). */
export const DEFAULT_SEARCH_RADIUS_DEG = 0.06;

/**
 * Resolves one intersection-kind query against Overpass within `box`,
 * tie-breaking an ambiguous (multi-node) result via pickNearest against
 * `near`, and packages the result as a WaypointCacheEntry.
 */
async function resolveIntersectionToEntry(
  query: { roadA: string; roadB: string },
  box: BoundingBox,
  near: { lat: number; lon: number },
  locationContext: string,
): Promise<WaypointCacheEntry> {
  const label = `${query.roadA} & ${query.roadB}`;
  const source = `${query.roadA} and ${query.roadB}, ${locationContext}`;

  try {
    const resolution = await resolveIntersection(query.roadA, query.roadB, box);

    if (resolution.status === "ok") {
      return { status: "ok", lat: resolution.lat, lon: resolution.lon, displayName: label, source, provider: "overpass" };
    }
    if (resolution.status === "ambiguous") {
      const picked = pickNearest(resolution.candidates, near);
      return { status: "ok", lat: picked.lat, lon: picked.lon, displayName: label, source, provider: "overpass" };
    }
    return { status: "error", message: "No shared node found in the search box", source, provider: "overpass" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      raw: err instanceof OverpassHttpError ? err.raw : undefined,
      source,
      provider: "overpass",
    };
  }
}

/** The one address-or-intersection query a caller actually has in hand
 * - everything the resolvers below need beyond this (a `stepId` for
 * cache/CSV bookkeeping a standalone caller has no CSV row for at all)
 * is filled in internally rather than pushed onto the caller. */
export type CoordinateQuery = { kind: "address"; text: string } | { kind: "intersection"; roadA: string; roadB: string };

export interface LookupContext {
  /** A rough point to search near - only meaningful for an intersection
   * query (Overpass searches a bounding box, not the whole planet);
   * ignored for a plain address. Omit to have this resolve one itself
   * by geocoding `locationContext` (e.g. "La Vergne, TN") as a plain
   * address first - costs an extra call, and is less precise than a
   * caller-supplied anchor (e.g. a school's own coordinates). */
  anchor?: { lat: number; lon: number };
  /** Tie-breaks an intersection query with more than one shared node
   * (two roads crossing twice, a road split across multiple OSM ways)
   * toward whichever candidate is closest to this point - defaults to
   * `anchor` itself when omitted. Irrelevant for a plain address. */
  near?: { lat: number; lon: number };
  /** Defaults to DEFAULT_SEARCH_RADIUS_DEG. */
  searchRadiusDeg?: number;
  /** Overrides reading `ORS_API_KEY` from the server environment - the
   * batch wrappers below already have their own copy (loaded once up
   * front by their own caller, not re-read per query) and pass it
   * through here instead of relying on the environment fallback. */
  apiKey?: string;
}

/**
 * The plain version of "look this up": one address or cross-street
 * intersection in, one WaypointCacheEntry out - the caller never needs
 * to know whether that meant a free-text geocoder (ORS) or an Overpass
 * road-graph query under the hood, and swapping which service answers
 * either kind of query (see geocode.ts/overpassGeocode.ts) never
 * changes this function's signature or what it returns.
 *
 * Server-side only - reads `ORS_API_KEY` from the environment by
 * default (see `ctx.apiKey` above to override that), the same secret
 * every other geocoding call in this app relies on staying off the
 * client (see src/app/api/geocode/route.ts's own doc on why).
 */
export async function lookupCoordinates(
  query: CoordinateQuery,
  locationContext: string,
  ctx: LookupContext = {},
): Promise<WaypointCacheEntry> {
  const apiKey = ctx.apiKey ?? process.env.ORS_API_KEY;
  const source =
    query.kind === "address" ? query.text : `${query.roadA} and ${query.roadB}, ${locationContext}`;
  if (!apiKey) {
    return {
      status: "error",
      message: "ORS_API_KEY isn't configured on the server - see .env.local.example.",
      source,
      provider: "none",
    };
  }

  if (query.kind === "address") {
    return safeGeocodeQuery({ stepId: -1, ...query }, locationContext, apiKey);
  }

  let anchor = ctx.anchor ?? null;
  if (!anchor) {
    const roughAnchor = await safeGeocodeQuery(
      { stepId: -1, kind: "address", text: locationContext },
      locationContext,
      apiKey,
    );
    if (roughAnchor.status !== "ok") {
      // Only fold the anchor lookup's own message in when there's no
      // `raw` to fall back on - once `raw` is set, the caller shows the
      // literal provider response separately, so repeating a paraphrase
      // of it here would just be redundant.
      return {
        status: "error",
        message: roughAnchor.raw
          ? `Couldn't resolve a search anchor for "${locationContext}"`
          : `Couldn't resolve a search anchor for "${locationContext}": ${roughAnchor.message}`,
        raw: roughAnchor.raw,
        source,
        provider: "overpass",
      };
    }
    anchor = { lat: roughAnchor.lat, lon: roughAnchor.lon };
  }

  const box = boundingBoxAround(anchor.lat, anchor.lon, ctx.searchRadiusDeg ?? DEFAULT_SEARCH_RADIUS_DEG);
  return resolveIntersectionToEntry(query, box, ctx.near ?? anchor, locationContext);
}

/** Geocodes the school's own address, for anchoring Overpass's search
 * box - reuses `cachedEntry` (an "ok" WaypointCacheEntry keyed to this
 * exact address, if the caller already has one) instead of spending a
 * fresh call, since re-querying ORS with the exact literal text it was
 * just asked came back a real 403 in production (see geocodeRoute.ts's
 * own history) - not a hypothetical optimization. */
export async function resolveSchoolAnchor(
  schoolAddress: string,
  locationContext: string,
  apiKey: string,
  cachedEntry?: WaypointCacheEntry,
): Promise<{ entry: WaypointCacheEntry; point: { lat: number; lon: number } | null }> {
  if (cachedEntry?.status === "ok") {
    return { entry: cachedEntry, point: { lat: cachedEntry.lat, lon: cachedEntry.lon } };
  }
  const entry = await lookupCoordinates({ kind: "address", text: schoolAddress }, locationContext, { apiKey });
  return { entry, point: entry.status === "ok" ? { lat: entry.lat, lon: entry.lon } : null };
}

/** What EditRouteScreen.tsx's admin actions need in common to resolve
 * against ORS/Overpass - the school's own address (for lazily
 * resolving an intersection's search anchor, see resolveSchoolAnchor
 * above) plus whatever anchor the admin's edit session already has
 * cached from an earlier click. */
interface AdminFetchContext {
  schoolAddress: string;
  locationContext: string;
  apiKey: string;
  anchor: { lat: number; lon: number } | null;
}

/** Lazily resolves the school's own address as an intersection query's
 * search anchor - shared by fetchOneLocation/fetchLocationList below,
 * both of which need the exact same "do we already have one, and if
 * not, go get it" logic. A plain address query never needs this at
 * all (returns `ctx.anchor` untouched, even if null). */
async function ensureAnchor(
  query: GeocodableQuery,
  ctx: AdminFetchContext,
): Promise<{ lat: number; lon: number } | null | { error: string; raw?: string }> {
  if (query.kind === "address" || ctx.anchor) return ctx.anchor;
  const { entry, point } = await resolveSchoolAnchor(ctx.schoolAddress, ctx.locationContext, ctx.apiKey);
  if (!point) {
    // Same reasoning as lookupCoordinates's own anchor-failure branch -
    // only fold the underlying message in when there's no `raw` for the
    // caller to show separately.
    const detail = entry.status === "error" ? entry.message : "unknown error";
    const raw = entry.status === "error" ? entry.raw : undefined;
    return {
      error: raw ? "Couldn't geocode the school address itself" : `Couldn't geocode the school address itself: ${detail}`,
      raw,
    };
  }
  return point;
}

/** Resolves exactly one geocodable query - EditRouteScreen.tsx's "Fetch
 * Location" (single-row) button's own logic, calling `lookupCoordinates`
 * directly rather than going through the batch-oriented
 * `resolveGeocodableQuery` below (which this no longer needs - a single
 * query has no `near` point to carry across other calls, since there
 * are none). */
export async function fetchOneLocation(
  query: GeocodableQuery,
  ctx: AdminFetchContext,
): Promise<
  | { entry: WaypointCacheEntry; anchor: { lat: number; lon: number } | null }
  | { error: string; raw?: string }
> {
  const anchor = await ensureAnchor(query, ctx);
  if (anchor && "error" in anchor) return anchor;

  const entry = await lookupCoordinates(query, ctx.locationContext, {
    apiKey: ctx.apiKey,
    anchor: anchor ?? undefined,
    near: anchor ?? undefined,
  });
  return { entry, anchor };
}

/** Resolves a whole list of geocodable queries in order, tracking a
 * shared anchor/near point across the batch (same idea as
 * scripts/geocodeRoute.ts's own pipeline) - EditRouteScreen.tsx's
 * "Fetch Missing"/"Re-fetch All" buttons' own logic, calling
 * `lookupCoordinates` directly for each query rather than through
 * `resolveGeocodableQuery`. `rateLimitMs` is the pause this function
 * waits *between* queries in the list - callers still own whether
 * pacing is needed at all (see this module's own top doc). */
export async function fetchLocationList(
  queries: GeocodableQuery[],
  ctx: AdminFetchContext & { rateLimitMs: number },
): Promise<
  | { anchor: { lat: number; lon: number } | null; results: WaypointCacheEntry[] }
  | { error: string; raw?: string }
> {
  let anchor = ctx.anchor;
  let lastResolved = anchor;
  const results: WaypointCacheEntry[] = [];

  for (const [index, query] of queries.entries()) {
    if (index > 0) await sleep(ctx.rateLimitMs);

    const resolvedAnchor = await ensureAnchor(query, { ...ctx, anchor });
    if (resolvedAnchor && "error" in resolvedAnchor) return resolvedAnchor;
    if (resolvedAnchor && !anchor) await sleep(ctx.rateLimitMs);
    anchor = resolvedAnchor;
    lastResolved = lastResolved ?? anchor;

    const entry = await lookupCoordinates(query, ctx.locationContext, {
      apiKey: ctx.apiKey,
      anchor: anchor ?? undefined,
      near: lastResolved ?? undefined,
    });
    if (entry.status === "ok") lastResolved = { lat: entry.lat, lon: entry.lon };
    results.push(entry);
  }

  return { anchor, results };
}

/** Resolves any one geocodable (address or intersection) query,
 * dispatching to ORS or the Overpass helper above (via
 * `lookupCoordinates`) as appropriate - the single entry point
 * scripts/geocodeRoute.ts's own batch pipeline loops over (see
 * fetchOneLocation/fetchLocationList above for the same idea, tailored
 * to EditRouteScreen.tsx's admin actions instead). `anchor`/`near` are
 * only used (and only need to be non-null) for an intersection query;
 * pass whatever the caller already has for `near` (falls back to
 * `anchor` itself, e.g. on the very first intersection resolved). */
export async function resolveGeocodableQuery(
  query: GeocodableQuery,
  ctx: {
    locationContext: string;
    apiKey: string;
    anchor: { lat: number; lon: number } | null;
    near: { lat: number; lon: number } | null;
    searchRadiusDeg: number;
  },
): Promise<{ entry: WaypointCacheEntry; resolvedPoint: { lat: number; lon: number } | null }> {
  if (query.kind === "intersection" && !ctx.anchor) {
    throw new Error("resolveGeocodableQuery: an intersection query needs a non-null anchor");
  }
  const entry = await lookupCoordinates(query, ctx.locationContext, {
    anchor: ctx.anchor ?? undefined,
    near: ctx.near ?? undefined,
    searchRadiusDeg: ctx.searchRadiusDeg,
    apiKey: ctx.apiKey,
  });
  return { entry, resolvedPoint: entry.status === "ok" ? { lat: entry.lat, lon: entry.lon } : null };
}
