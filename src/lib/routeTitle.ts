/** The big "Route N" callout's own font-size class, scaled down by how
 * long routeNumber actually is - shared by StartScreen's own title and
 * EditRouteScreen's hub screen, which intentionally mirrors it (see
 * that screen's own doc comment). Fine at the largest size for a plain
 * numbered route ("171"), but a Special/transition route's own
 * free-typed name ("Depot to Elementary") can run much longer, and
 * needs to actually fit its own card rather than assuming every route
 * title is short.
 */
export function routeTitleSizeClass(routeNumber: string): string {
  if (routeNumber.length <= 4) return "text-4xl";
  if (routeNumber.length <= 10) return "text-3xl";
  if (routeNumber.length <= 18) return "text-2xl";
  return "text-xl";
}
