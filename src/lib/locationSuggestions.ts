import { normalizeLocationWhitespace } from "./waypointCache";

/**
 * Every distinct location a Waypoint cache key (waypointCache.ts's own
 * `address:<text>`/`intersection:<a> & <b>` shape) already knows how to
 * resolve - the plain-language answer to "what has this app already
 * successfully looked up," built entirely from what's already been
 * geocoded somewhere in the system rather than a live lookup against a
 * real map/geocoder. Feeds StepRowEditor's own Location field
 * suggestions (see the /api/location-suggestions route this backs,
 * and EditRouteScreen's own combination of this with every School and
 * SavedLocation name too) - not a promise that a suggestion is spelled
 * the one true way a real geocoder would recognize, just that it's
 * exactly how this app has resolved it before, whatever kind of place
 * it turned out to be - a street, a school, a business, anything.
 *
 * An `address:` key's own leading house number (if it has one) is
 * stripped before offering it back, e.g. "216 Lake Forest Dr" suggests
 * as "Lake Forest Dr" - a specific house number only ever means
 * something for the one stop it was originally typed for, so keeping
 * it here would read as "reuse this exact address" rather than what
 * this actually is, a road name worth typing a fresh house number onto
 * (a school or business name, with no house number to strip in the
 * first place, comes through exactly as typed). An `intersection:`
 * key's own two road names are split back apart, since neither half
 * alone is what was actually typed into either field - each is
 * directly reusable on its own for a turn's own Location/From.
 * `unresolvable:` keys are skipped outright - never a real resolved
 * location to begin with (see WaypointQuery's own doc comment).
 */
export function extractLocationSuggestions(cacheKeys: string[]): string[] {
  const raw: string[] = [];
  for (const key of cacheKeys) {
    if (key.startsWith("address:")) {
      const address = key.slice("address:".length).trim().replace(/^\d+\s+/, "");
      if (address) raw.push(address);
    } else if (key.startsWith("intersection:")) {
      for (const road of key.slice("intersection:".length).split(" & ")) {
        if (road.trim()) raw.push(road.trim());
      }
    }
  }
  return mergeLocationNames(raw);
}

/**
 * Combines any number of location-name lists into one deduplicated,
 * alphabetized list - the display-side half of duplicate prevention,
 * complementing waypointCacheKey's own normalizeLocationWhitespace
 * (which stops *new* near-duplicate cache rows from being created in
 * the first place, but can't retroactively merge rows that already
 * differ, nor names pulled from an entirely different source, like a
 * School or SavedLocation name that happens to match a suggestion
 * except for case or incidental whitespace).
 *
 * Two names collapse together whenever they're equal ignoring case and
 * whitespace (via waypointCache.ts's own normalizeLocationWhitespace) -
 * "Holland Ridge Dr", "holland ridge dr", and "Holland  Ridge Dr " all
 * become one entry. Whichever spelling is encountered first wins as the
 * displayed text (lists earlier in the argument list, and earlier
 * entries within a list, take priority), so callers that want their own
 * source's casing to win should pass it first.
 */
export function mergeLocationNames(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const name of list) {
      const normalized = normalizeLocationWhitespace(name);
      if (!normalized) continue;
      const dedupeKey = normalized.toLowerCase();
      if (!seen.has(dedupeKey)) seen.set(dedupeKey, normalized);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
