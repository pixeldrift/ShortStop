import { looksLikeRoadName, roadNameFromAddress } from "./deriveWaypoints";

/**
 * Every distinct road name buried in a list of Waypoint cache keys
 * (waypointCache.ts's own `address:<text>`/`intersection:<a> & <b>`
 * shape) - the plain-language answer to "what streets does this app
 * already know about," built entirely from what's already been
 * geocoded somewhere in the system rather than a live lookup against a
 * real map/geocoder. Feeds StepRowEditor's own Location field
 * suggestions (see the /api/street-names route this backs) - not a
 * promise that a suggested name is spelled the one true way a real
 * geocoder would recognize, just that it's exactly how this app has
 * successfully resolved it before.
 *
 * An `intersection:` key's own two road names are always genuine roads
 * by construction - waypointCacheKey never puts a place name on either
 * side of one (a turn's own `location` is always trusted as a road
 * outright, suffix or not - see deriveWaypoints.ts's own doc comment on
 * PLACE_ACTIONS) - so both sides come through untouched. An `address:`
 * key needs more care: it's the *whole* typed value, which is just as
 * often a school or business name ("LaVergne Lake Elementary School")
 * as a real street address - only kept when stripping a leading house
 * number actually changed something (a real numbered address) or what's
 * left already reads as a bare road name on its own (no house number
 * typed, but it still ends in a real street suffix) - anything else is
 * a place, not a road, and never worth suggesting back as one.
 * `unresolvable:` keys are skipped outright - never a road to begin
 * with (see WaypointQuery's own doc comment).
 */
export function extractStreetNames(cacheKeys: string[]): string[] {
  const names = new Set<string>();
  for (const key of cacheKeys) {
    if (key.startsWith("address:")) {
      const address = key.slice("address:".length);
      const road = roadNameFromAddress(address);
      if (road !== address || looksLikeRoadName(road)) {
        names.add(road.trim());
      }
    } else if (key.startsWith("intersection:")) {
      for (const road of key.slice("intersection:".length).split(" & ")) {
        if (road.trim()) names.add(road.trim());
      }
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
