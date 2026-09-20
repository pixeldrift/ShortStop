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
 * An `address:` key's own text comes through verbatim, house number
 * and all - it's exactly what admin typed and successfully resolved
 * before, worth offering back exactly as-is rather than only some
 * road-shaped subset of it. An `intersection:` key's own two road
 * names are split back apart instead, since neither half alone is what
 * was actually typed into either field - each is directly reusable on
 * its own for a turn's own Location/From. `unresolvable:` keys are
 * skipped outright - never a real resolved location to begin with (see
 * WaypointQuery's own doc comment).
 */
export function extractLocationSuggestions(cacheKeys: string[]): string[] {
  const names = new Set<string>();
  for (const key of cacheKeys) {
    if (key.startsWith("address:")) {
      const address = key.slice("address:".length).trim();
      if (address) names.add(address);
    } else if (key.startsWith("intersection:")) {
      for (const road of key.slice("intersection:".length).split(" & ")) {
        if (road.trim()) names.add(road.trim());
      }
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
