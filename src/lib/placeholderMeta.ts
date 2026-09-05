// The RouteMeta fields neither the master route list nor schools.csv
// cover (driverName, distance, isFavorite) - real mileage/driver-roster
// data doesn't exist for any route yet, so driverName/distance stay
// flat placeholders regardless of which route they're merged into (not
// per-route fabrications - the same "we don't have this yet" stand-in
// everywhere, same spirit as "Otto Mann" always having been a
// placeholder name even for route 125's real, "published" data).
export const PLACEHOLDER_DRIVER_NAME = "Otto Mann";
export const PLACEHOLDER_DISTANCE = "8.4 mi";

// Fallback for a school schools.csv doesn't have a row for yet (a
// future real route naming a school not yet in the sheet) - not a
// guessed street number, but still ending in a real "City, ST ZIP" (La
// Vergne is served by the Smyrna, TN post office) so extractCityState
// still has real geographic context to geocode that route's stops
// against.
export const SCHOOL_ADDRESS_NOT_YET_PROVIDED = "Address not yet provided, Smyrna, TN 37167";

// Only route 125 defaults to a favorite - it was the app's original
// (and for a while only) real route. The other real routes now coming
// in from the master list default to not-favorited, same as demo
// routes do, rather than every "published" route being pre-favorited with
// no real signal for it.
export const FAVORITE_ROUTE_IDS = new Set(["125-dropoff-elementary"]);
