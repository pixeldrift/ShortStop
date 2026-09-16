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
