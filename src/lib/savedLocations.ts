import { extractCityState } from "./geocode";
import { lookupCoordinates } from "./resolveWaypoint";

/** One reusable, pre-geocoded place - the bus depot, a driver's own
 * home address, anywhere else worth picking by name instead of
 * retyping (and re-geocoding) the same address on every route that
 * touches it (see prisma/schema.prisma's own SavedLocation model doc
 * comment). lat/lon are null until src/app/api/saved-locations's own
 * POST handler successfully geocodes a freshly-created one's address -
 * same "nullable until resolved" shape School.lat/lon already uses. */
export interface SavedLocationInfo {
  id: number;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Geocodes a saved location's address via the same ORS pipeline every
 * other address in this app resolves through - shared by
 * /api/saved-locations's own POST (auto-geocode on create) and
 * /api/saved-locations/geocode (EditSavedLocationModal's own Fetch
 * button, a preview that doesn't persist anything on its own). A plain
 * address needs no anchor/intersection context the way a route
 * waypoint sometimes does - extractCityState pulls it straight off the
 * address's own "City, ST" tail.
 */
export async function geocodeSavedLocationAddress(
  address: string,
): Promise<{ lat: number; lon: number } | { error: string }> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return {
      error: "ORS_API_KEY isn't configured on the server - see .env.local.example.",
    };
  }
  const locationContext = extractCityState(address) ?? "";
  const result = await lookupCoordinates(
    { kind: "address", text: address },
    locationContext,
    { apiKey },
  );
  if (result.status !== "ok") {
    return { error: result.status === "error" ? result.message : "Couldn't geocode this address." };
  }
  return { lat: result.lat, lon: result.lon };
}
