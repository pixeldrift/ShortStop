import type { WaypointQuery } from "./deriveWaypoints";
import { nearestLabeledCandidate } from "./cardinalLabel";
import type { CardinalLabel } from "./cardinalLabel";

/** What one geocode attempt returns - a hit, or a miss with a reason.
 * `source` is the exact text sent to the geocoder, `provider` is which
 * one resolved it (e.g. "openrouteservice") - kept on both so a human
 * can see why, and via what service, a lookup did or didn't resolve.
 * That matters now that the active provider is swappable (see
 * geocode.ts) - a cache built under one provider stays clearly labeled
 * as such even after the active one changes. Only "ok" entries actually
 * get persisted to the cache file (see geocodeRoute.ts) - a failure
 * almost always means the query wording needs fixing, so leaving it out
 * of the cache means it's retried on the very next run rather than
 * staying silently failed forever.
 *
 * `message` is always this app's own explanation of what went wrong,
 * readable on its own ("OpenRouteService geocoding returned 403
 * Forbidden for...", "No shared node found in the search box"). `raw`
 * is only ever the literal response body a real HTTP request actually
 * got back from ORS/Overpass, present only when there was a real
 * request to quote from - never fabricated, never present for a purely
 * internal miss (an empty result set, no shared node) that never
 * involved a failing HTTP response at all.
 *
 * `notFound` is true only for that specific "queried fine, found
 * nothing" case (a real response, zero results/no shared node) - never
 * for a config problem, a network failure, or a real HTTP error, all
 * of which mean something entirely different went wrong. Callers that
 * want to guess *which* part of a query is bad (see
 * routeResolutionStatus.ts) need this distinction: only a genuine
 * not-found is worth that guess at all - guessing over a 403 or a
 * missing API key would just be wrong.
 *
 * `rateLimited` is true only for a real 429 from the geocoder - a
 * batch caller (EditRouteScreen.tsx's runFetchAll) uses this to stop
 * and say so plainly instead of continuing to spend, and fail, every
 * remaining query in the batch. */
export type WaypointCacheEntry =
  | {
      status: "ok";
      lat: number;
      lon: number;
      displayName: string;
      source: string;
      provider: string;
    }
  | {
      status: "error";
      message: string;
      notFound?: boolean;
      rateLimited?: boolean;
      raw?: string;
      source: string;
      provider: string;
    };

/** public/data/route-125-waypoints.json's shape: every entry keyed by
 * waypointCacheKey(query) below. In practice only ever holds "ok"
 * entries - see WaypointCacheEntry above. */
export type WaypointCache = Record<string, WaypointCacheEntry>;

/** Trims and collapses any run of internal whitespace down to one
 * plain space, so "Holland Ridge Dr", "Holland Ridge Dr " (a trailing
 * space, easy to leave behind typing on a touchscreen), and
 * "Holland  Ridge  Dr" (a doubled-up space) all resolve to the exact
 * same text - and so, once run through waypointCacheKey below, the
 * same cache entry - rather than each becoming its own independent,
 * separately-geocoded "different place" that happens to display
 * identically. Deliberately leaves case untouched: unlike whitespace,
 * a road's own real capitalization ("McKinney", "O'Brien Rd") isn't
 * something to guess a single canonical form for blindly, and every
 * caller that actually needs case-insensitive matching (the location
 * suggestions list, locationSuggestions.ts's own mergeLocationNames)
 * already does that itself, on top of this. */
export function normalizeLocationWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Whether two location names are "the same" for matching a typed/row
 * location against a known School or SavedLocation name (EditRouteScreen's
 * own matchedSchool/matchedSavedLocation and every other by-name lookup
 * alongside them) - case-insensitive, and collapsing internal whitespace
 * runs the same way normalizeLocationWhitespace above (and, on the
 * suggestion-list side, mergeLocationNames) already does. A School or
 * SavedLocation name typed by hand into a CSV or this app's own address-
 * book form can easily pick up a doubled-up space Object.keys(schools)/
 * savedLocations.find still holds onto verbatim; the Location field's own
 * suggestion dropdown (locationSuggestionOptions, built through
 * mergeLocationNames) already normalizes that away, so a name picked
 * straight from that dropdown could look identical on screen yet fail a
 * comparison that only trims - never becoming the linked-entity chip a
 * pick from the Address Book popup (which copies the raw name verbatim)
 * already does for the exact same name. */
export function locationNamesMatch(a: string, b: string): boolean {
  return (
    normalizeLocationWhitespace(a).toLowerCase() ===
    normalizeLocationWhitespace(b).toLowerCase()
  );
}

/**
 * The cache key for a WaypointQuery - content-addressed, not tied to a
 * row index, which is what makes "edit the CSV, then refresh" work
 * without any separate staleness bookkeeping: a changed row derives a
 * different query, which hashes to a different key, so it's simply a
 * cache miss (geocoded fresh) rather than something that has to be
 * explicitly invalidated. An unchanged row still derives the exact
 * same query it always did, so it keeps hitting the same cache entry
 * indefinitely, however many times the route is re-derived. An
 * intersection's two roads are sorted before joining, so "A & B" and
 * "B & A" - the same real intersection, however the CSV happens to
 * state it on a given row - always resolve to one shared entry rather
 * than two redundant lookups. Every piece of a query's own text runs
 * through normalizeLocationWhitespace first, for the same "don't let
 * an incidental difference fork one real place into two cache rows"
 * reason the A/B sort exists. "unresolvable" queries never actually
 * reach the cache - the geocoding pipeline skips them before ever
 * calling this function (see geocodeRoute.ts) - but a key is still
 * defined here so the switch stays exhaustive at the type level.
 */
export function waypointCacheKey(query: WaypointQuery): string {
  if (query.kind === "address")
    return `address:${normalizeLocationWhitespace(query.text)}`;
  if (query.kind === "unresolvable")
    return `unresolvable:${normalizeLocationWhitespace(query.description)}`;
  const [a, b] = [
    normalizeLocationWhitespace(query.roadA),
    normalizeLocationWhitespace(query.roadB),
  ].sort((x, y) => x.localeCompare(y));
  return `intersection:${a} & ${b}`;
}

/** cardinalLabel.ts's own fixed vocabulary, as a plain array - every
 * possible cache key an intersection-kind base key could have a
 * sibling under (see intersectionVariantKey below). Kept to exactly
 * these four, not open-ended, so "does this key already have any
 * siblings" is always a bounded, enumerable check (at most 4 extra
 * lookups) rather than a scan. */
export const CARDINAL_LABELS: readonly CardinalLabel[] = ["northern", "southern", "eastern", "western"];

/**
 * The cache key for a *second* real candidate point sharing the same
 * road-pair base key - resolveWaypoint.ts's own resolveIntersectionKeyed
 * mints one of these the first time Overpass reports two genuinely
 * different shared nodes for the same pair (a loop road crossing the
 * same other road twice), or the directional-name fallback
 * (geocodeFallback.ts's directionalCoreMatches) turns up two distinct
 * real roads for what was typed. `baseKey` must already be an
 * `intersection:` key (waypointCacheKey's own output) - this only ever
 * makes sense for that kind, an address or unresolvable query never
 * has a "second real place" to disambiguate from the first.
 *
 * Deliberately still a plain string, in the exact same flat
 * Record<key, entry> shape every existing cache consumer (the /api/
 * waypoints route, EditRouteScreen.tsx, routeReadiness.ts...) already
 * reads/writes - no new WaypointCacheEntry shape, no schema change.
 * Two real crossings just become two ordinary rows that happen to
 * share most of their key text, the same way any other cache entry
 * does.
 */
export function intersectionVariantKey(baseKey: string, label: CardinalLabel): string {
  return `${baseKey} (${label} crossing)`;
}

/**
 * Which of an intersection base key's own known candidates (itself,
 * plus whichever cardinal-labeled siblings already exist in `cache`)
 * a given caller actually means - resolveWaypoint.ts's own
 * resolveIntersectionKeyed runs the equivalent check server-side
 * before ever spending a fresh Overpass call; this is the same idea
 * for a caller that already has both the cache and a position to
 * compare against on hand client-side (a manual pin-drag's own
 * placementGuess, say) and just needs to know which existing row it's
 * actually looking at - no network call, ever.
 *
 * Null when nothing at all is known yet for this base key (a genuine
 * miss - nothing to pick from). With exactly one known candidate,
 * that one - regardless of `near` - there's nothing to disambiguate.
 * With two or more, whichever is closest to `near` when a position is
 * given; without one, the base key's own entry if it has one, else
 * simply the first known candidate (best-effort - there's no way to
 * choose more precisely with no position to compare against at all).
 */
export function resolveIntersectionCacheEntry(
  cache: WaypointCache,
  baseKey: string,
  near: { lat: number; lon: number } | null,
): { key: string; entry: Extract<WaypointCacheEntry, { status: "ok" }> } | null {
  const known: { key: string; label: CardinalLabel | null; lat: number; lon: number }[] = [];
  const baseEntry = cache[baseKey];
  if (baseEntry?.status === "ok") known.push({ key: baseKey, label: null, lat: baseEntry.lat, lon: baseEntry.lon });
  for (const label of CARDINAL_LABELS) {
    const variantKey = intersectionVariantKey(baseKey, label);
    const variantEntry = cache[variantKey];
    if (variantEntry?.status === "ok") {
      known.push({ key: variantKey, label, lat: variantEntry.lat, lon: variantEntry.lon });
    }
  }

  if (known.length === 0) return null;
  if (known.length === 1 || !near) {
    const chosen = known.find((k) => k.key === baseKey) ?? known[0];
    return { key: chosen.key, entry: cache[chosen.key] as Extract<WaypointCacheEntry, { status: "ok" }> };
  }
  const nearest = nearestLabeledCandidate(known, near);
  return { key: nearest.key, entry: cache[nearest.key] as Extract<WaypointCacheEntry, { status: "ok" }> };
}

export interface ResolvedStepCoordinate {
  lat: number;
  lon: number;
  displayName: string;
  /** "override" when RouteStep.overrideLat/overrideLon won (see
   * prisma/schema.prisma's own doc comment); "cache" for the ordinary
   * shared-geocode-cache case, whichever of a base key's own known
   * cardinal siblings ended up closest to `near`. */
  source: "override" | "cache";
}

/**
 * One step's real coordinate - the single place every consumer that
 * draws or navigates a route (RouteMap, StepScreen, routeReadiness,
 * exportCsv, StartScreen) should resolve through, instead of reading
 * `cache[waypointKey]` directly. An admin's own override always wins
 * when set - it's the "I looked at this stop and this is where it
 * really is" answer, never second-guessed by a fresh geocode result.
 * Otherwise falls through to the shared cache, intersection-aware
 * (resolveIntersectionCacheEntry above) so a step whose road pair has
 * two known crossings lands on whichever one this step's own `near`
 * context is actually closest to, not always the pair's own base
 * entry. Null only when neither an override nor any cache entry
 * exists yet for this step at all - still genuinely unresolved.
 */
export function resolveStepCoordinate(
  waypointKey: string,
  override: { overrideLat: number | null; overrideLon: number | null },
  cache: WaypointCache,
  near: { lat: number; lon: number } | null,
): ResolvedStepCoordinate | null {
  if (override.overrideLat != null && override.overrideLon != null) {
    return { lat: override.overrideLat, lon: override.overrideLon, displayName: "Manually placed", source: "override" };
  }
  if (waypointKey.startsWith("intersection:")) {
    const resolved = resolveIntersectionCacheEntry(cache, waypointKey, near);
    return resolved
      ? { lat: resolved.entry.lat, lon: resolved.entry.lon, displayName: resolved.entry.displayName, source: "cache" }
      : null;
  }
  const entry = cache[waypointKey];
  return entry?.status === "ok"
    ? { lat: entry.lat, lon: entry.lon, displayName: entry.displayName, source: "cache" }
    : null;
}

/**
 * resolveStepCoordinate above, run across a whole route's own steps in
 * order - the sequential-context version geocodeRoute.ts's own batch
 * pipeline already uses (`lastResolved`, carried from whichever stop
 * last actually resolved) applied here to *reading* a route back
 * instead of geocoding one, so a step near a known second crossing
 * reads as whichever candidate the route's own walk-through is
 * actually near at that point, not a fixed, context-free guess.
 * `schoolAnchor` seeds `near` before anything on the route itself has
 * resolved yet (the same role it plays for the first real geocode
 * call, resolveWaypoint.ts's own `ctx.anchor`) - null when it isn't
 * known, in which case the first ambiguous step with no earlier
 * resolved neighbor falls back to whichever known candidate
 * resolveIntersectionCacheEntry picks with no position to compare
 * against at all (its own doc comment).
 */
export function resolveRouteCoordinates(
  steps: { waypointKey: string; overrideLat: number | null; overrideLon: number | null }[],
  cache: WaypointCache,
  schoolAnchor: { lat: number; lon: number } | null,
): (ResolvedStepCoordinate | null)[] {
  let near = schoolAnchor;
  return steps.map((step) => {
    const resolved = resolveStepCoordinate(step.waypointKey, step, cache, near);
    if (resolved) near = { lat: resolved.lat, lon: resolved.lon };
    return resolved;
  });
}
