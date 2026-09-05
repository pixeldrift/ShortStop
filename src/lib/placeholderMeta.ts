// The RouteMeta fields neither the master route list nor schools.csv
// cover (driverName, distance, durationMinutes, isFavorite) - real
// mileage/timing data doesn't exist for any route yet (it needs actual
// routing/distance calculation, not something an admin should be
// typing in when creating a route - see EditRouteScreen.tsx), so
// distance/durationMinutes stay flat placeholders regardless of which
// route they're merged into, the same "we don't have this yet"
// stand-in everywhere, same spirit as "Otto Mann" always having been a
// placeholder name even for route 125's real, "published" data.
// driverName is the one exception among these four - a real per-route
// driver name is exactly the kind of thing an admin creating a route
// *should* type in, so it stays an editable field there even though it
// also starts out on this same placeholder.
export const PLACEHOLDER_DRIVER_NAME = "Otto Mann";
export const PLACEHOLDER_DISTANCE = "8.4 mi";
export const PLACEHOLDER_DURATION_MINUTES = 25;

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
