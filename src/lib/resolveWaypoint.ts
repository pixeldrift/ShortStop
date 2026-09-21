import { geocodeQuery } from "./geocode";
import type { GeocodableQuery } from "./geocode";
import {
  boundingBoxAround,
  fetchAreaStreetNames,
  fetchStreetNodes,
  OverpassHttpError,
  pickNearest,
  resolveIntersection,
} from "./overpassGeocode";
import type { BoundingBox } from "./overpassGeocode";
import { bestStreetMatch, splitStreetType, streetTypeVariants } from "./geocodeFallback";
import type { FallbackKind } from "./geocodeFallback";
import type { WaypointCacheEntry } from "./waypointCache";

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

/** What actually changed to land a fallback result - GeocodeConfirmModal
 * (EditRouteScreen.tsx) reads this to explain the match and let an
 * admin accept or reject it before anything's persisted. Null (not
 * this type at all) for a plain, first-try exact match - the ordinary,
 * overwhelmingly common case, which still just saves immediately
 * exactly as it always has (see EditRouteScreen.tsx's own
 * onFetch/fetchLocation for where that split actually happens). */
export interface FallbackDetail {
  kind: FallbackKind;
  /** The corrected road name(s) that actually resolved, as one
   * human-readable string - a single road for "street-type"/"fuzzy-
   * name" (whichever side of an intersection needed correcting, or an
   * address's own street), or the one road a "loop-snap" result was
   * placed on. */
  correctedQuery: string;
}

/**
 * The plain address path's own "try common street-type synonyms"
 * fallback (point 1 of the geocoding-accuracy request this exists
 * for) - a human-written route sheet gets a road's own type word wrong
 * often enough ("Road" typed for what's actually "Drive") that it's
 * worth retrying every common synonym before giving up, the same
 * mistake StepRowEditor's own admin keeps finding and fixing by hand.
 * Only ever retries a genuine *not-found* (ORS queried fine and came
 * back empty) - a real HTTP error (403, rate-limited, a missing API
 * key) means every one of these retries would fail identically, so
 * there's nothing to gain by spending them.
 */
async function geocodeAddressWithFallback(
  text: string,
  locationContext: string,
  apiKey: string,
): Promise<{ entry: WaypointCacheEntry; fallback: FallbackDetail | null }> {
  const plain = await safeGeocodeQuery({ stepId: -1, kind: "address", text }, locationContext, apiKey);
  if (plain.status === "ok" || !plain.notFound) return { entry: plain, fallback: null };

  const { base, type } = splitStreetType(text);
  if (!type) return { entry: plain, fallback: null };

  for (const variant of streetTypeVariants(base, type)) {
    const attempt = await safeGeocodeQuery(
      { stepId: -1, kind: "address", text: variant },
      locationContext,
      apiKey,
    );
    if (attempt.status === "ok") {
      return { entry: attempt, fallback: { kind: "street-type", correctedQuery: variant } };
    }
  }
  return { entry: plain, fallback: null };
}

/**
 * `lookupCoordinates` at the bottom is the one real implementation of
 * "turn an address or cross-street intersection into a lat/lon" -
 * everything else in this module is a thin wrapper around it.
 * `resolveGeocodableQuery`/`resolveSchoolAnchor` add the batch-pipeline
 * bookkeeping (`anchor`/`near` carried across many calls, an
 * already-known API key threaded through rather than re-read per
 * call) scripts/geocodeRoute.ts's own CLI/CI pipeline needs;
 * `fetchOneLocation` is the plainer single-query version
 * src/app/api/geocode/route.ts uses for EditRouteScreen.tsx's admin
 * actions - one query per request always, even for "Fetch Missing"/
 * "Re-fetch All" (see runFetchAll's own doc in EditRouteScreen.tsx for
 * why that loops client-side instead of sending a whole batch in one
 * request). Reach for `lookupCoordinates` itself directly for a
 * standalone lookup that doesn't need any of that.
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
    return {
      status: "error",
      message: "No shared node found in the search box",
      notFound: true,
      source,
      provider: "overpass",
    };
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

/**
 * The intersection path's own three-stage fallback (points 2 and 3 of
 * the geocoding-accuracy request this exists for), tried in order only
 * once the plain exact lookup above has already failed:
 *
 * 1. Correct one or both road names against every real road actually
 *    in the search box (overpassGeocode.ts's own fetchAreaStreetNames)
 *    - a street-type-word swap or a close spelling match
 *    (geocodeFallback.ts's own bestStreetMatch) - then retry the exact
 *    same intersection query with whichever name(s) got corrected.
 * 2. If that still finds no shared node (a loop/circle Overpass's own
 *    node(w.a)(w.b) query can't resolve to one point, or the two roads
 *    genuinely don't meet in this box's own graph), fall back to
 *    placing the point directly on whichever road is actually
 *    confirmed real (corrected or not), snapped to whichever of that
 *    road's own points is closest to `near` (pickNearest, the same
 *    tie-break an ordinary double-crossing already uses) - an
 *    approximation along the route, not a genuine crossing, which is
 *    exactly why this always comes back with a FallbackDetail an
 *    admin has to confirm rather than silently saving.
 * 3. Genuinely nothing found anywhere - hands back the original plain
 *    failure unchanged.
 */
async function resolveIntersectionToEntryWithFallback(
  query: { roadA: string; roadB: string },
  box: BoundingBox,
  near: { lat: number; lon: number },
  locationContext: string,
): Promise<{ entry: WaypointCacheEntry; fallback: FallbackDetail | null }> {
  const plain = await resolveIntersectionToEntry(query, box, near, locationContext);
  if (plain.status === "ok") return { entry: plain, fallback: null };

  const candidates = await fetchAreaStreetNames(box);
  if (candidates.length === 0) return { entry: plain, fallback: null };

  const matchA = bestStreetMatch(query.roadA, candidates);
  const matchB = bestStreetMatch(query.roadB, candidates);
  const correctedA = matchA?.correctedName ?? query.roadA;
  const correctedB = matchB?.correctedName ?? query.roadB;

  if (matchA || matchB) {
    const retried = await resolveIntersectionToEntry(
      { roadA: correctedA, roadB: correctedB },
      box,
      near,
      locationContext,
    );
    if (retried.status === "ok") {
      const kind: FallbackKind =
        matchA?.kind === "street-type" || matchB?.kind === "street-type" ? "street-type" : "fuzzy-name";
      return { entry: retried, fallback: { kind, correctedQuery: `${correctedA} & ${correctedB}` } };
    }
  }

  // Neither an exact nor a corrected intersection query found a shared
  // node - place the point on whichever side is actually confirmed to
  // exist in this box (corrected name preferred over the original,
  // since that's the one just proven real), preferring roadB (the
  // waypoint's own destination/cross street in every caller today,
  // not the road already being traveled) when both sides check out.
  const candidateLower = new Set(candidates.map((c) => c.toLowerCase()));
  const confirmedB = matchB?.correctedName ?? (candidateLower.has(query.roadB.trim().toLowerCase()) ? query.roadB : null);
  const confirmedA = matchA?.correctedName ?? (candidateLower.has(query.roadA.trim().toLowerCase()) ? query.roadA : null);
  const targetName = confirmedB ?? confirmedA;
  if (targetName) {
    const nodes = await fetchStreetNodes(targetName, box);
    if (nodes.length > 0) {
      const snapped = pickNearest(nodes, near);
      return {
        entry: {
          status: "ok",
          lat: snapped.lat,
          lon: snapped.lon,
          displayName: `${targetName} & ${query.roadA === targetName ? query.roadB : query.roadA} (approximate)`,
          source: plain.source,
          provider: "overpass",
        },
        fallback: { kind: "loop-snap", correctedQuery: targetName },
      };
    }
  }

  return { entry: plain, fallback: null };
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

/**
 * Same query, same context - but when the plain lookup above fails,
 * this keeps going: common street-type-word substitution and
 * approximate-spelling matching for both addresses and intersections,
 * then (intersections only) a same-road "loop-snap" placement when no
 * real intersection can be found at all. Never called for a batch
 * fetch (scripts/geocodeRoute.ts's own pipeline, EditRouteScreen.tsx's
 * "Fetch Missing"/"Re-fetch All") - only EditRouteScreen.tsx's own
 * single-row Fetch button opts into this, and only ever through
 * fetchOneLocation's own `allowFallback` flag, because every fallback
 * result here needs a human to actually look at it (GeocodeConfirmModal)
 * before it's trusted, which a batch has no way to pause and ask for.
 * A caller gets `fallback: null` back for a plain exact match - the
 * overwhelming majority of calls - so it can keep treating those
 * exactly as it always has.
 */
export async function lookupCoordinatesWithFallback(
  query: CoordinateQuery,
  locationContext: string,
  ctx: LookupContext = {},
): Promise<{ entry: WaypointCacheEntry; fallback: FallbackDetail | null }> {
  const apiKey = ctx.apiKey ?? process.env.ORS_API_KEY;
  const source =
    query.kind === "address" ? query.text : `${query.roadA} and ${query.roadB}, ${locationContext}`;
  if (!apiKey) {
    return {
      entry: {
        status: "error",
        message: "ORS_API_KEY isn't configured on the server - see .env.local.example.",
        source,
        provider: "none",
      },
      fallback: null,
    };
  }

  if (query.kind === "address") {
    return geocodeAddressWithFallback(query.text, locationContext, apiKey);
  }

  let anchor = ctx.anchor ?? null;
  if (!anchor) {
    const roughAnchor = await safeGeocodeQuery(
      { stepId: -1, kind: "address", text: locationContext },
      locationContext,
      apiKey,
    );
    if (roughAnchor.status !== "ok") {
      return {
        entry: {
          status: "error",
          message: roughAnchor.raw
            ? `Couldn't resolve a search anchor for "${locationContext}"`
            : `Couldn't resolve a search anchor for "${locationContext}": ${roughAnchor.message}`,
          raw: roughAnchor.raw,
          source,
          provider: "overpass",
        },
        fallback: null,
      };
    }
    anchor = { lat: roughAnchor.lat, lon: roughAnchor.lon };
  }

  const box = boundingBoxAround(anchor.lat, anchor.lon, ctx.searchRadiusDeg ?? DEFAULT_SEARCH_RADIUS_DEG);
  return resolveIntersectionToEntryWithFallback(query, box, ctx.near ?? anchor, locationContext);
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
  /** Opts fetchOneLocation below into lookupCoordinatesWithFallback
   * instead of the plain lookupCoordinates - only ever true for
   * EditRouteScreen.tsx's own single-row Fetch button (its own
   * fetchLocation), never for a batch call (runFetchAll, whose loop
   * omits this) - see lookupCoordinatesWithFallback's own doc for why
   * that split exists. */
  allowFallback?: boolean;
}

/** Lazily resolves the school's own address as an intersection query's
 * search anchor - fetchOneLocation below's own "do we already have
 * one, and if not, go get it" logic. A plain address query never
 * needs this at all (returns `ctx.anchor` untouched, even if null). */
async function ensureAnchor(
  query: GeocodableQuery,
  ctx: AdminFetchContext,
): Promise<
  | { point: { lat: number; lon: number } | null; entry: WaypointCacheEntry | null }
  | { error: string; raw?: string }
> {
  if (query.kind === "address" || ctx.anchor) return { point: ctx.anchor, entry: null };
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
  // `entry` here is a real, freshly-resolved WaypointCacheEntry for the
  // school's own address (not just the bare point) - handed back up to
  // fetchOneLocation below so its own caller (EditRouteScreen.tsx) can
  // persist it under its own cache key, same as any other resolved
  // waypoint. Without this, the interactive Fetch Location/Fetch All
  // flow could resolve the school's own anchor point (needed to search
  // for an intersection) yet never actually save it anywhere real -
  // only scripts/geocodeRoute.ts's own batch pipeline did that.
  return { point, entry };
}

/** Resolves exactly one geocodable query - EditRouteScreen.tsx's own
 * "Fetch Location"/"Fetch Missing"/"Re-fetch All" buttons all funnel
 * through this same single-query call now (the batch buttons loop it
 * client-side, one request at a time, so their own progress bar can
 * update between each real response - see runFetchAll's own doc) -
 * calling `lookupCoordinates` directly rather than going through the
 * batch-oriented `resolveGeocodableQuery` below (which this no longer
 * needs - a single query has no `near` point to carry across other
 * calls, since there are none). */
export async function fetchOneLocation(
  query: GeocodableQuery,
  ctx: AdminFetchContext,
): Promise<
  | {
      entry: WaypointCacheEntry;
      anchor: { lat: number; lon: number } | null;
      /** The school's own address, as a real cache entry - only
       * present when this exact call is what freshly resolved it (a
       * plain address query, or a repeat intersection query reusing
       * `ctx.anchor`, never returns one). The caller should persist
       * this under the school address's own cache key, same as
       * `entry` under the query's. */
      anchorEntry: WaypointCacheEntry | null;
      /** Set only when `ctx.allowFallback` was true and a fallback
       * strategy is what actually produced `entry` - null for a plain
       * exact match, or whenever `allowFallback` wasn't set at all.
       * The caller (EditRouteScreen.tsx's fetchLocation) holds off on
       * persisting `entry` until an admin confirms it via
       * GeocodeConfirmModal whenever this isn't null. */
      fallback: FallbackDetail | null;
    }
  | { error: string; raw?: string }
> {
  const anchorResult = await ensureAnchor(query, ctx);
  if ("error" in anchorResult) return anchorResult;
  const { point: anchor, entry: anchorEntry } = anchorResult;

  const { entry, fallback } = ctx.allowFallback
    ? await lookupCoordinatesWithFallback(query, ctx.locationContext, {
        apiKey: ctx.apiKey,
        anchor: anchor ?? undefined,
        near: anchor ?? undefined,
      })
    : {
        entry: await lookupCoordinates(query, ctx.locationContext, {
          apiKey: ctx.apiKey,
          anchor: anchor ?? undefined,
          near: anchor ?? undefined,
        }),
        fallback: null,
      };
  return { entry, anchor, anchorEntry, fallback };
}

/** Resolves any one geocodable (address or intersection) query,
 * dispatching to ORS or the Overpass helper above (via
 * `lookupCoordinates`) as appropriate - the single entry point
 * scripts/geocodeRoute.ts's own batch pipeline loops over (see
 * fetchOneLocation above for the same idea, tailored to
 * EditRouteScreen.tsx's admin actions instead). `anchor`/`near` are
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
