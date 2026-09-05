// The RouteMeta fields the master route list still doesn't cover
// (driverName, schoolAddress, distance, isFavorite) - real
// mileage/driver-roster data doesn't exist for any route yet, so
// driverName/distance stay flat placeholders regardless of which route
// they're merged into (not per-route fabrications - the same "we don't
// have this yet" stand-in everywhere, same spirit as "Otto Mann" always
// having been a placeholder name even for route 125's real, "active"
// data). schoolAddress does vary by school, so it's keyed by
// schoolName - only Lavergne Lake Elementary's is a real address (the
// one that was already in route-125-meta.csv); Middle/High don't have a
// real one yet either. Its own module, rather than living inline in
// page.tsx, so scripts/geocodeRoute.ts can import the same addresses
// instead of a second hardcoded copy that could drift out of sync with
// them.
export const PLACEHOLDER_DRIVER_NAME = "Otto Mann";
export const PLACEHOLDER_DISTANCE = "8.4 mi";

// Honestly-labeled non-addresses for the two schools whose real street
// address isn't in yet - not a guessed street number, but still ending
// in a real "City, ST ZIP" (La Vergne is served by the Smyrna, TN post
// office, same as the elementary school) so extractCityState still has
// real geographic context to geocode each route's stops against.
const ADDRESS_NOT_YET_PROVIDED = "Address not yet provided, Smyrna, TN 37167";

export const SCHOOL_ADDRESSES: Record<string, string> = {
  "Lavergne Lake Elementary": "1425 Lake Forest Dr, Smyrna, TN 37167",
  "Lavergne Middle School": ADDRESS_NOT_YET_PROVIDED,
  "Lavergne High School": ADDRESS_NOT_YET_PROVIDED,
};

// Only route 125 defaults to a favorite - it was the app's original
// (and for a while only) real route. The other real routes now coming
// in from the master list default to not-favorited, same as demo
// routes do, rather than every "active" route being pre-favorited with
// no real signal for it.
export const FAVORITE_ROUTE_IDS = new Set(["125-dropoff-elementary"]);
