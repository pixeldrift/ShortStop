export type StepKind = "depart" | "turn" | "stop" | "arrive";
export type TurnDirection = "left" | "right";
export type TripType = "pickup" | "dropoff";
/** "Demo" marks the fabricated filler routes (demoRoutes.ts) that pad
 * out the route list - never a real district route, whatever its
 * other fields claim. "Active"/"inactive" are both real data,
 * distinguished by whether the route is currently run - a route
 * doesn't stop being real just because the district retired it.
 * "Pending" is also real data, but not yet geocoded - an admin can
 * save a route's steps at any point (see routeResolutionStatus.ts),
 * but it can't be flipped to "active" until every geocodable waypoint
 * actually resolves, so a route that's saved but still missing
 * coordinates sits here instead, distinct from "inactive" (a route
 * that's fully ready but deliberately not running). */
export type RouteStatus = "active" | "inactive" | "pending" | "demo";
/** Which school a route serves - turn-by-turn instructions differ by
 * level even for the same bus/trip type (a district's elementary,
 * middle, and high school runs are each their own real path, their
 * own CSV), so this is real routing data, not just a display detail -
 * see Route.id below, and RouteListScreen's View dropdown, which
 * filters on it directly. */
export type SchoolLevel = "elementary" | "middle" | "high";

export interface NavigationStep {
  id: number;
  kind: StepKind;
  /** Which way to turn, for "turn" steps - drives the big arrow icon. */
  direction?: TurnDirection;
  /** Big on-screen line for depart/turn/arrive steps, e.g. "TURN RIGHT".
   * Ignored for "stop" steps, whose heading ("STOP 7 OF 23") is computed
   * from the route so it stays correct as steps are added or removed. */
  heading?: string;
  /** Street name (turn steps) or stop address (stop steps). */
  subheading?: string;
  /** Distance/timing line, e.g. "500 ft ahead" or "0.4 mi". */
  distance?: string;
  studentCount?: number;
  pickupOrDropoff?: string;
  sideOfRoad?: string;
  specialInstruction?: string;
  /** waypointCacheKey(deriveWaypoints(...)) for this step's row - the
   * same key `scripts/geocodeRoute.ts` writes route-125-waypoints.json
   * entries under, so RouteMap can look up this step's real-world
   * position (once that cache actually has one - see "Maps, part
   * four"/"part five" in the README for why it's still empty) without
   * re-deriving anything client-side. Computed for every step, not
   * just stops, ahead of drawing the full route line later. */
  waypointKey: string;
  /** What the app speaks aloud when this step becomes current, as
   * separate parts spoken as separate utterances (e.g. stop number,
   * then location, then rider count) so there's an audible pause
   * between each rather than one run-on sentence. */
  announcement: string[];
}

export interface Route {
  /** The true unique identifier - routeNumber turns out to just be the
   * bus's own number (see busNumber), and a district reuses a bus
   * across multiple distinct paths (AM pickup vs. PM dropoff, crossed
   * with a separate run - its own CSV, its own turn-by-turn - per
   * school level it serves), so routeNumber alone can't tell two
   * routes apart. Convention: `${routeNumber}-${tripType}-
   * ${schoolLevel}`, unique as long as a bus doesn't run two routes at
   * the same level and trip type in one day. */
  id: string;
  status: RouteStatus;
  name: string;
  routeNumber: string;
  driverName: string;
  busNumber: string;
  departureTime: string;
  schoolName: string;
  schoolAddress: string;
  schoolLevel: SchoolLevel;
  /** A pickup route arrives somewhere (school); a dropoff route doesn't
   * have one single destination, so the trip-summary label reads
   * "Complete" instead of "Arrive". */
  tripType: TripType;
  /** Placeholder trip estimates - not derived from real map/routing data
   * yet, since none exists for this route. See RouteMeta in
   * parseRouteCsv.ts. */
  distance: string;
  durationMinutes: number;
  /** Drives the heart icon on RouteListScreen's rows and the
   * "Favorites" option in its View dropdown - see demoRoutes.ts (which
   * randomly picks a handful of the fabricated routes) and
   * placeholderMeta.ts (which always favorites the one real route). */
  isFavorite: boolean;
  steps: NavigationStep[];
}
