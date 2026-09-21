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
  const names = new Set<string>();
  for (const key of cacheKeys) {
    if (key.startsWith("address:")) {
      const address = key.slice("address:".length).trim().replace(/^\d+\s+/, "");
      if (address) names.add(address);
    } else if (key.startsWith("intersection:")) {
      for (const road of key.slice("intersection:".length).split(" & ")) {
        if (road.trim()) names.add(road.trim());
      }
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
