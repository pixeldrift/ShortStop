// The only RouteMeta fields route-125-meta.csv's schema doesn't cover
// (driverName, schoolAddress, distance, isFavorite, id, status,
// schoolLevel) - real mileage/driver-roster data doesn't exist yet, so
// these stay hardcoded placeholders merged in alongside whatever
// parseRouteMetaCsv parses out of the sheet (see page.tsx). Its own
// module, rather than living inline in page.tsx, so
// scripts/geocodeRoute.ts can import the same schoolAddress instead of
// a second hardcoded copy that could drift out of sync with it.
// isFavorite is hardcoded true rather than random like the demo
// routes' (see demoRoutes.ts) - the one real route should always show
// up under "Favorites", not depend on a coin flip. status is "active"
// because this is real, currently-run data - see demoRoutes.ts for how
// the fabricated filler routes get "demo" instead. schoolLevel is
// "elementary" - Lavergne Lake Elementary. id follows the
// `${routeNumber}-${tripType}-${schoolLevel}` convention documented on
// Route itself (types.ts) - unique for now since this is still the
// only real route.
export const PLACEHOLDER_META = {
  id: "125-dropoff-elementary",
  status: "active" as const,
  driverName: "Otto Mann",
  schoolAddress: "1425 Lake Forest Dr, Smyrna, TN 37167",
  schoolLevel: "elementary" as const,
  distance: "8.4 mi",
  isFavorite: true,
};
