"use client";

import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  GeoJSONSource,
  IControl,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import { ActionIcon, PersonSolidIcon } from "./icons";
import { collapseAttribution, PMTILES_ATTRIBUTION, PMTILES_URL } from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import type { RouteCoordinate, RoutingResult } from "@/lib/routing/types";
import type { TripType, TurnDirection } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";

/** One "stop" step's marker: waypointKey looks it up in the route's own
 * geocoded sidecar cache (waypointsUrl prop, below), number is its
 * position among stops (1-indexed) for the pin's on-map label -
 * matching the same numbering RouteProgressBar/StopContent already show
 * for the same stop. */
export type StopMarker = { waypointKey: string; number: number };

/** One "turn" step's marker - waypointKey looks it up the same way a
 * StopMarker does. `direction`/`heading` are the same step's own
 * NavigationStep fields (StepScreen.tsx's TurnContent renders this
 * exact pair the exact same way): a left/right turn draws the same
 * mirrored turn-arrow sign the driver's own screen shows for it,
 * anything else (Proceed, Depart, Arrive, ...) draws its own ActionIcon
 * glyph - the real per-step icon, not a generic "here's a turn" marker.
 * Route 125's own steps sheet is the only one with real turn-by-turn
 * data today (every 120 route sheet is stops only) - this only ever
 * renders something there, but nothing here is specific to that route. */
export type TurnMarker = {
  waypointKey: string;
  direction?: TurnDirection;
  heading?: string;
};

// La Vergne, TN's approximate town center - a placeholder anchor until
// the route's own geocoded waypoints (deriveWaypoints.ts, and each
// route's own sidecar cache file - see waypointsUrl below) give this a
// real, route-derived center (or bounds) instead. Not tied to any
// specific address in the route data - just a general "somewhere in
// town" starting view. [lat, lon], same order every other prop/ref on
// this component already uses - mountMapLibre's own toLngLat flips it
// where MapLibre needs [lon, lat] instead.
export const LA_VERGNE_CENTER: [number, number] = [36.0134, -86.5581];
const DEFAULT_ZOOM = 13;
// Roughly "which side of the street" zoom - what driving mode flies to
// for the current step, once its own coordinates are known.
const STREET_ZOOM = 17;
// One full second for driving mode's own step-to-step camera move AND
// its bearing rotation (see bearingAt's own doc comment) - both
// renderers animate them together as one motion, not a fast position
// flight with an instant, separately-timed spin.
const DRIVING_FLY_DURATION_MS = 1000;
// Overview mode only shows numbered turn-by-turn detail (every stop's
// own full pin, every turn's own marker) once the admin has zoomed in
// this far past the route's own auto-fit framing - below it, the start
// and end each still get their own full pin, but every stop between
// them is just a plain red dot (drawOverviewPins) - same "full detail
// once you're this close" threshold driving mode's own full pin set
// (drawDrivingPins) reuses as-is once crossed.
const OVERVIEW_DETAIL_ZOOM = 15;

// The road-following route line's own color - deliberately lighter
// than the school/stop pins' own blue (#2563eb, schoolMarkerHtml/
// stopMarkerHtml below) so the line never reads as though it were just
// another pin, especially where one sits right on top of it.
const ROUTE_LINE_COLOR = "#60a5fa";

/** A plain GeoJSON LineString Feature wrapping `coordinates` - the
 * shape mountMapLibre's own route-line sources need, built fresh on
 * every redraw (the traveled/remaining split below changes which
 * points belong to which line every time the active step or a live GPS
 * fix moves). `as const` on the two type
 * tags keeps them as their own literal types ("Feature"/"LineString")
 * rather than widening to plain `string`, the same reasoning
 * protomapsStyle.ts's own doc comment gives for its layer literals. */
function lineFeature(coordinates: RouteCoordinate[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates },
  };
}

// A standard "you are here" dot - Tailwind classes work here same as
// anywhere else in the app (this HTML string still gets scanned for
// class names at build time even though it's not a JSX className), so
// no separate CSS needed. The ping ring is a purely visual "this is
// live" cue, not an accuracy radius - a real accuracy circle would need
// its own always-current-radius layer, not this fixed-size icon.
const LOCATION_DOT_HTML =
  '<span class="relative flex h-4 w-4">' +
  '<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-60"></span>' +
  '<span class="relative inline-flex h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow-md"></span>' +
  "</span>";

function stopMarkerHtml(stopNumber: number): string {
  return (
    '<div class="relative h-11 w-7">' +
    '<img src="/assets/pin.png" class="h-full w-full" alt="" />' +
    '<span class="font-heading absolute top-[31%] left-1/2 -translate-x-1/2 -translate-y-1/2 ' +
    'text-xs font-black text-red-700">' +
    stopNumber +
    "</span>" +
    "</div>"
  );
}

// A stop's own zoomed-out marker (drawOverviewPins below, everything
// between the route's start/end, which still get a real stopMarkerHtml
// pin each) - a plain, unlabeled dot rather than the full teardrop pin,
// so a route with a lot of stops doesn't turn into a wall of numbers at
// a zoom level with no real room to lay them out legibly. Same red as
// the pin's own number, so it still reads as "a stop" at a glance
// without needing the shape itself to match too.
function stopDotHtml(): string {
  return '<div class="h-2.5 w-2.5 rounded-full border border-white bg-red-600 shadow-sm"></div>';
}

// A turn's own on-map marker - the same mirrored turn-arrow sign
// (`direction`) or ActionIcon glyph (`heading`) StepScreen's own
// TurnContent shows for this exact step, not a generic "here's a turn"
// placeholder - reusing the real icon (ActionIcon's own SVG rendered to
// a plain HTML string via renderToStaticMarkup, same as any other
// divIcon here) so a driver glancing at the map sees the same shape
// they're about to see full-size. The arrow sign is already a
// self-contained graphic (its own border/shadow baked into the PNG,
// same as RouteProgressBar's own bare use of it) so it needs no extra
// wrapper; the ActionIcon glyphs are bare stroke lines with no
// background of their own, so those get a small white plate for
// contrast against the tiles underneath. Null if a turn step somehow
// has neither (shouldn't happen for real data, but nothing enforces
// it) - the caller skips drawing a marker for it rather than showing
// an empty one.
function turnMarkerHtml(
  direction: TurnDirection | undefined,
  heading: string | undefined,
): string | null {
  if (direction) {
    const mirror = direction === "left" ? ' style="transform: scaleX(-1)"' : "";
    return `<img src="/assets/turn-arrow.png" class="h-8 w-8" alt=""${mirror} />`;
  }
  const icon = heading
    ? renderToStaticMarkup(
        <ActionIcon action={heading} className="h-4 w-4 text-zinc-800" />,
      )
    : "";
  if (!icon) return null;
  return (
    '<div class="flex h-8 w-8 items-center justify-center rounded-full ' +
    'border-2 border-zinc-700 bg-white shadow-md">' +
    icon +
    "</div>"
  );
}

// The school itself - its own blue pin, distinct from a stop's red one
// (a school is where the route starts or ends, never a stop a driver
// checks riders in/out at) and a turn's plain yellow dot. Same teardrop
// glyph MapPinIcon (icons.tsx) already draws elsewhere for an address -
// as a raw SVG string here since MapLibre's Marker takes a real DOM
// element (elementFromHtml below), not a React component directly.
function schoolMarkerHtml(): string {
  return (
    '<svg viewBox="0 0 24 24" width="32" height="32" fill="#2563eb" ' +
    'style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45))" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />' +
    "</svg>"
  );
}

/** What RouteMap reports back once it has successfully fetched this
 * route's own road geometry - the same road-following line this
 * component draws for itself, handed to whichever caller wants to
 * build its own live-GPS-progress tracking (useLiveRouteProgress.ts)
 * from the exact same data instead of requesting /api/route-geometry a
 * second time for the same route. Fired once per mount, the moment the
 * internal fetch resolves - this component's own road-geometry line
 * only ever loads once per route (see this component's own doc
 * comment on why the mount effect below has empty deps), so this never
 * fires again afterward. */
export interface RouteGeometryResult {
  /** GeoJSON order ([lon, lat] per point), straight off the routing
   * provider's own response - matches RoutingResult's own
   * geometry.coordinates exactly, no conversion done here. */
  coordinates: RouteCoordinate[];
  /** Every step's own {lat, lon} that actually resolved in the cache,
   * in route order - the same list this component's own road-geometry
   * request was built from (OrderedWaypoint below), minus the school:
   * the school never gets its own step id/waypointKey (no
   * NavigationStep row exists for it even when it's a real waypoint -
   * see this component's own `schoolIsWaypoint` prop doc comment), and
   * every caller of this result (useLiveRouteProgress's own waypoints
   * param) only ever tracks distance to a real step, keyed by its own
   * waypointKey. */
  orderedWaypoints: { key: string; lat: number; lon: number }[];
}

// The route's own ordered {lat, lon} sequence - every `path` step that
// resolved in the cache, school spliced in at whichever end `tripType`
// puts it (see `tripType`'s own prop doc) - built once when the cache
// resolves and reused for the road-geometry request, overview mode's
// "fit the whole route" bounds, and driving mode's bearing (below).
// `key` is the step's own waypointKey for anything that came from
// `path` - null for the school, which is a real leg of the trip but
// never itself an active step a driver can be "at".
type OrderedWaypoint = { key: string | null; lat: number; lon: number };

// Standard great-circle initial bearing (forward azimuth) from one
// point to another, in degrees clockwise from north.
function initialBearing(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const phi1 = (from.lat * Math.PI) / 180;
  const phi2 = (to.lat * Math.PI) / 180;
  const deltaLambda = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Driving mode's own "which way is the bus facing" - the bearing FROM
// the previous waypoint TO the active one, i.e. the road the bus is
// actually already on, not the road it's about to turn onto. This is
// deliberate, not an oversight: rotating to face the *next* leg the
// instant a turn becomes the active step would spin the map toward a
// road the bus hasn't reached yet, before the turn is actually
// executed - both wrong (the bus is still traveling the old heading)
// and disorienting (a driver mid-approach to a left turn would see the
// map already facing the new road, with no reliable way to tell left
// from right against what's actually still in front of them). Using
// the leg just driven means the map only ever rotates once the bus is
// really on the new road - and since "up" is however MapLibre renders
// the *current* heading, "where we came from" is always straight down,
// so an on-screen left/right always matches a real left/right turn.
// Falls back to the bearing TOWARD the next
// waypoint only at the route's very first step (Depart), where there's
// no "came from" leg yet to face along. Null if there's nothing to
// compute a direction from (the active key isn't in `ordered`, or it's
// the route's only waypoint).
function bearingAt(
  ordered: OrderedWaypoint[],
  activeWaypointKey: string | null | undefined,
): number | null {
  if (!activeWaypointKey) return null;
  const index = ordered.findIndex((w) => w.key === activeWaypointKey);
  if (index === -1) return null;
  if (index - 1 >= 0) return initialBearing(ordered[index - 1], ordered[index]);
  if (index + 1 < ordered.length)
    return initialBearing(ordered[index], ordered[index + 1]);
  return null;
}

/** Which point along a route's own road-geometry coordinates (lon/lat
 * order, per RouteCoordinate) sits closest to `point` - how far along
 * the drawn line the "traveled" (solid) / "remaining" (dashed) split
 * below falls. Plain Euclidean comparison in degree-space, not a real
 * haversine/projection - close enough to tell which of a route's own
 * points is nearest at the scale one route ever covers (a few miles),
 * and this only ever needs to rank points against each other, never
 * report a real distance. */
function nearestCoordIndex(
  coords: RouteCoordinate[],
  point: { lat: number; lon: number },
): number {
  let bestIndex = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    const dLat = lat - point.lat;
    const dLon = lon - point.lon;
    const distSq = dLat * dLat + dLon * dLon;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * A real, pannable/zoomable map - replaces the static "Demo only
 * placeholder, not actual map" JPEG that used to sit in this spot.
 * Centers on La Vergne, TN with a live position dot, a numbered pin per
 * stop, a small numbered dot per turn (routes with real turn-by-turn
 * data - see `turns`' own doc comment), and a line connecting every one
 * of those in the route's own order (`path`'s own doc comment),
 * wherever the geocode cache actually has an entry for it (see the
 * `stops`/`turns`/`path` prop docs below).
 *
 * Built on MapLibre GL + self-hosted PMTiles vector tiles (mountMapLibre
 * below, mapEngine.ts) - this app requires WebGL, no raster-tile
 * fallback (see mapEngine.ts's own doc comment for why). maplibre-gl is
 * dynamically imported inside mountMapLibre itself, not at module top
 * level - the package touches `window` as soon as it's evaluated, which
 * would run during Next's server-side render pass for this "use client"
 * component's initial HTML (client components still get one SSR pass
 * for their first paint) and throw "window is not defined" there. The
 * CSS import above is fine at the top level even so - just style rules,
 * nothing that touches `window`.
 */
export function RouteMap({
  className,
  stops = [],
  turns = [],
  path = [],
  school,
  schoolIsWaypoint = false,
  tripType,
  waypointsUrl,
  mode = "driving",
  activeWaypointKey,
  onToggleRoster,
  onRouteGeometry,
}: {
  className?: string;
  /** A pin per stop, at whatever position the geocode cache
   * (waypointsUrl below) has for it - stops with no cache entry (a
   * route nothing has geocoded yet - see README, "Maps" sections) are
   * silently skipped rather than placed anywhere approximate. */
  stops?: StopMarker[];
  /** A small dot per turn, same skip-if-ungeocoded rule as `stops` -
   * empty for every 120 route today (their steps sheets are stops
   * only), populated for 125's (see TurnMarker's own doc comment for
   * the label scheme). */
  turns?: TurnMarker[];
  /** Every step's own waypointKey, in the route's own order (stops and
   * turns both - StepScreen.tsx derives this straight from
   * route.steps). Used to build the ordered list of {lat, lon} points
   * (school spliced in at whichever end `tripType` puts it) sent to
   * /api/route-geometry for the actual road-following line - not drawn
   * directly itself. Whichever of these don't have a cache entry (an
   * ungeocoded or unresolvable step) are simply left out of that list,
   * same as a missing `stops`/`turns` marker. */
  path?: string[];
  /** The school's own geocoded location - School.lat/lon (see
   * scripts/geocodeSchools.ts), straight from the route
   * (StepScreen.tsx's own `schoolPoint`), not a Waypoint cache lookup -
   * every real school gets geocoded directly now, independent of any
   * route's stops/turns, so this is reliably present without needing
   * this specific route's own stops fetched first, and updates
   * immediately when a route's school changes (EditRouteScreen), with
   * no separate "fetch location" step for the school pin itself. Drawn
   * as its own blue pin, distinct from a stop's red one or a turn's
   * yellow dot, since the school is where the route starts or ends,
   * never a stop a driver checks riders in/out at. Omitted (no pin) if
   * this school hasn't been geocoded yet. Also spliced into the
   * road-geometry request below (drawing an actual connecting line out
   * to it) whenever `schoolIsWaypoint` (below) says this route really
   * goes there. */
  school?: { lat: number; lon: number } | null;
  /** Whether this route actually visits `school` as one of its own real
   * waypoints - true only when a route.steps row explicitly names it
   * (a Depart/Arrive action), the same rule AllStopsModal's own
   * explicitSchoolStepId already uses to decide whether to show a
   * school row at all (StartScreen.tsx) - a route whose last leg is
   * merely a spoken "Proceed to..." instruction (skip=true, never
   * geocoded as a real step) doesn't actually drive there, so drawing
   * a road-geometry line out to the school for it would show a drive
   * that never happens. False (the default) draws no such line and
   * leaves the school out of the overview map's own start/end pin
   * pair - `school` above still gets its own pin regardless, just not
   * connected to the rest of the route. */
  schoolIsWaypoint?: boolean;
  /** Which end of `path` the school (above) actually belongs at when
   * building the road-geometry request - a dropoff route starts at the
   * school (school first), a pickup route ends there (school last),
   * matching AllStopsModal's own identical dropoff-first/pickup-last
   * convention for the same reason (StartScreen.tsx). Only meaningful
   * alongside `school` and `schoolIsWaypoint`; ignored if either is
   * omitted/false. */
  tripType?: TripType;
  /** The geocode cache endpoint (src/app/api/waypoints) - shared across
   * every route now that it's backed by Postgres rather than split into
   * a sidecar file per route, so this is the same URL regardless of
   * which route is showing. A cache miss for a given `stops`/`turns`/
   * `path`/`school` entry (nothing's geocoded it yet) is simply
   * skipped, same as a fetch failure resolving to an empty cache below. */
  waypointsUrl: string;
  /** "overview" shows just the route path and a single starting-location
   * pin (the school for a dropoff route, otherwise the first stop),
   * framed to fit the whole route - the route-info screen and the
   * depot/Ready-to-Depart phase, before the driver has started stepping
   * through anything. "driving" (the default, matching every caller's
   * behavior before this prop existed) follows `activeWaypointKey` at
   * street level instead of framing the whole route at once, rotated so
   * the direction of travel always faces up - every stop/turn pin only
   * appears once the map actually arrives there, not the moment driving
   * mode starts (see `activeWaypointKey`'s own doc comment). */
  mode?: "overview" | "driving";
  /** The current step's own waypointKey - driving mode only. The map
   * flies to this location's cache entry (street zoom, rotated to face
   * the next waypoint) whenever it changes, rather than refitting
   * bounds, so advancing through steps feels like following along
   * instead of repeatedly reframing the whole route. Every stop/turn/
   * school pin is held back until the very first of these flights
   * actually arrives, so they appear at street level alongside the
   * driver rather than popping in back at the overview's zoomed-out
   * framing. Ignored in overview mode. */
  activeWaypointKey?: string | null;
  /** Adds a small button to the map's own top-left control stack (same
   * corner as the zoom buttons, directly beneath them) that calls this
   * when tapped - StepScreen's own manual show/hide for the rider
   * check-in box, replacing the old street-labels toggle that used to
   * sit in this same spot (removed outright - a driver toggling road-
   * name labels on/off was never actually useful, per whoever asked for
   * this swap). Omitted (no button at all) by every other caller -
   * StartScreen's overview map has no rider box to toggle. */
  onToggleRoster?: () => void;
  /** Fired once this route's own road geometry finishes loading - see
   * RouteGeometryResult's own doc comment above. Omitted by every
   * caller that has no use for it (StartScreen's overview map, say) -
   * this component's own drawing behavior is completely unaffected
   * either way. */
  onRouteGeometry?: (result: RouteGeometryResult) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<WaypointCache | null>(null);
  const orderedWaypointsRef = useRef<OrderedWaypoint[]>([]);
  // Driving mode's full pin set is drawn exactly once, the first time
  // the map actually arrives somewhere (see syncToModeRef below) - this
  // is what "exactly once" is checked against, so later step advances
  // don't redraw (and briefly re-flash) pins that are already showing.
  const drivingPinsRevealedRef = useRef(false);
  // Read inside the mount effect's async callback below rather than
  // added as that effect's own dependency - `stops`/`turns`/`path` are
  // fresh arrays every render, and re-running the whole effect on every
  // change would tear down and rebuild the entire map (tile layer,
  // geolocation watch included) just to redraw pins that don't
  // actually change mid-trip.
  const stopsRef = useRef(stops);
  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  const schoolRef = useRef(school);
  useEffect(() => {
    schoolRef.current = school;
  }, [school]);
  const schoolIsWaypointRef = useRef(schoolIsWaypoint);
  useEffect(() => {
    schoolIsWaypointRef.current = schoolIsWaypoint;
  }, [schoolIsWaypoint]);
  const tripTypeRef = useRef(tripType);
  useEffect(() => {
    tripTypeRef.current = tripType;
  }, [tripType]);
  // Same reasoning as stopsRef above - read once inside the mount
  // effect rather than re-running the whole effect if it ever changed
  // (it doesn't, mid-trip: StepScreen computes it once from `route`,
  // unchanged for the whole trip).
  const waypointsUrlRef = useRef(waypointsUrl);
  useEffect(() => {
    waypointsUrlRef.current = waypointsUrl;
  }, [waypointsUrl]);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const activeWaypointKeyRef = useRef(activeWaypointKey);
  useEffect(() => {
    activeWaypointKeyRef.current = activeWaypointKey;
  }, [activeWaypointKey]);
  // Read by ShowRidersControl's own click handler (below) rather than
  // closed over directly, so a fresh function identity every StepScreen
  // render (its own toggleRosterManually isn't memoized) doesn't need
  // the whole control re-added - only whether one was ever passed at all
  // (checked once, at mount, further down) decides that.
  const onToggleRosterRef = useRef(onToggleRoster);
  useEffect(() => {
    onToggleRosterRef.current = onToggleRoster;
  }, [onToggleRoster]);
  // Same "read inside the async closure via a ref" reasoning as every
  // other callback above - the road-geometry fetch that eventually
  // calls this lives inside the mount effect's own one-time async
  // chain, well after whatever onRouteGeometry identity StepScreen
  // happened to pass on the render that triggered the mount.
  const onRouteGeometryRef = useRef(onRouteGeometry);
  useEffect(() => {
    onRouteGeometryRef.current = onRouteGeometry;
  }, [onRouteGeometry]);

  // Assigned once the mount effect below has a map/cache to work with -
  // brings the current mode/active step's camera (and, in driving mode,
  // pins + bearing) up to date. Called once right after that assignment
  // (the very first sync), and again by the small effect just below on
  // every later mode/step change - see its own comment.
  const syncToModeRef = useRef<() => void>(() => {});
  // Fires on every step advance (and on the depot->driving mode switch)
  // - the imperative flyTo/setBearing/marker calls inside
  // syncToModeRef are the whole point of keeping the mount effect below
  // itself untouched by any of this.
  useEffect(() => {
    syncToModeRef.current();
  }, [mode, activeWaypointKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const cleanup = mountMapLibre({
      container,
      cancelledRef: () => cancelled,
      cacheRef,
      orderedWaypointsRef,
      drivingPinsRevealedRef,
      syncToModeRef,
      stopsRef,
      turnsRef,
      pathRef,
      schoolRef,
      schoolIsWaypointRef,
      tripTypeRef,
      waypointsUrlRef,
      modeRef,
      activeWaypointKeyRef,
      onToggleRosterRef,
      onRouteGeometryRef,
    });

    return () => {
      cancelled = true;
      cleanup();
      cacheRef.current = null;
      orderedWaypointsRef.current = [];
      drivingPinsRevealedRef.current = false;
      syncToModeRef.current = () => {};
    };
  }, []);

  return <div ref={containerRef} className={className} />;
}

// Every ref mountMapLibre below needs - pulled out as its own type so
// that function's own signature visibly takes "one bag of shared
// state," rather than a dozen positional params that would need to
// stay in a fixed order.
interface MountArgs {
  container: HTMLDivElement;
  cancelledRef: () => boolean;
  cacheRef: React.RefObject<WaypointCache | null>;
  orderedWaypointsRef: React.RefObject<OrderedWaypoint[]>;
  drivingPinsRevealedRef: React.RefObject<boolean>;
  syncToModeRef: React.RefObject<() => void>;
  stopsRef: React.RefObject<StopMarker[]>;
  turnsRef: React.RefObject<TurnMarker[]>;
  pathRef: React.RefObject<string[]>;
  schoolRef: React.RefObject<{ lat: number; lon: number } | null | undefined>;
  schoolIsWaypointRef: React.RefObject<boolean>;
  tripTypeRef: React.RefObject<TripType | undefined>;
  waypointsUrlRef: React.RefObject<string>;
  modeRef: React.RefObject<"overview" | "driving">;
  activeWaypointKeyRef: React.RefObject<string | null | undefined>;
  onToggleRosterRef: React.RefObject<(() => void) | undefined>;
  onRouteGeometryRef: React.RefObject<((result: RouteGeometryResult) => void) | undefined>;
}

async function fetchCacheAndBuildOrderedWaypoints(
  args: Pick<
    MountArgs,
    | "waypointsUrlRef"
    | "schoolRef"
    | "schoolIsWaypointRef"
    | "tripTypeRef"
    | "pathRef"
    | "cacheRef"
    | "orderedWaypointsRef"
    | "cancelledRef"
  >,
): Promise<WaypointCache | null> {
  const cache: WaypointCache = await fetch(args.waypointsUrlRef.current)
    .then((res): Promise<WaypointCache> | WaypointCache =>
      res.ok ? res.json() : {},
    )
    .catch(() => ({}) as WaypointCache);
  if (args.cancelledRef()) return null;
  args.cacheRef.current = cache;

  // The school only actually belongs in this list - and so only gets a
  // real road-geometry line drawn out to it - when schoolIsWaypointRef
  // says a route.steps row explicitly visits it (a Depart/Arrive
  // action). A route whose last leg is just a spoken "Proceed to..."
  // instruction never really drives there, so splicing it in
  // unconditionally (the old behavior) drew a route straight from the
  // last real stop to the school even when nothing in the route's own
  // steps ever said to go there.
  const includeSchool = Boolean(args.schoolRef.current) && args.schoolIsWaypointRef.current;
  const orderedWaypoints: OrderedWaypoint[] = [];
  if (includeSchool && args.tripTypeRef.current === "dropoff") {
    orderedWaypoints.push({
      key: null,
      lat: args.schoolRef.current!.lat,
      lon: args.schoolRef.current!.lon,
    });
  }
  for (const key of args.pathRef.current) {
    const entry = cache[key];
    if (!entry || entry.status !== "ok") continue;
    orderedWaypoints.push({ key, lat: entry.lat, lon: entry.lon });
  }
  if (includeSchool && args.tripTypeRef.current !== "dropoff") {
    orderedWaypoints.push({
      key: null,
      lat: args.schoolRef.current!.lat,
      lon: args.schoolRef.current!.lon,
    });
  }
  args.orderedWaypointsRef.current = orderedWaypoints;
  return cache;
}

// MapLibre's own coordinate order is [lon, lat] - the opposite of the
// [lat, lon] every prop/ref on this component is already expressed in
// (StepScreen.tsx, StartScreen.tsx, the waypoint cache itself).
// Converted at the boundary here rather than changing any of those
// callers' own [lat, lon] convention.
function toLngLat({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}): [number, number] {
  return [lon, lat];
}

// StepScreen's own manual rider-box toggle - a real MapLibre IControl
// (map.addControl), same reasoning the street-labels toggle this
// replaced already established: it stacks automatically directly under
// the NavigationControl's own zoom buttons the way every other control
// sharing "top-left" does, instead of needing hand-tuned offset math to
// sit under them. Plain, un-toggled styling (no on/off color the way
// the old control had) - this doesn't track its own visible/hidden
// state, it just calls back out to StepScreen's own toggleRosterManually
// on every tap, which already knows whether the box is currently open.
class ShowRidersControl implements IControl {
  private button?: HTMLButtonElement;

  constructor(private readonly onClick: () => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Show riders");
    button.style.cssText =
      "width:29px;height:29px;display:flex;align-items:center;" +
      "justify-content:center;background:none;border:none;cursor:pointer;color:#333;";
    button.innerHTML = renderToStaticMarkup(
      <PersonSolidIcon className="h-4 w-4" />,
    );
    button.addEventListener("click", () => this.onClick());
    this.button = button;
    container.appendChild(button);
    return container;
  }

  onRemove(): void {
    this.button?.parentElement?.remove();
  }
}

function mountMapLibre(args: MountArgs): () => void {
  const {
    container,
    cancelledRef,
    cacheRef,
    orderedWaypointsRef,
    drivingPinsRevealedRef,
    syncToModeRef,
    stopsRef,
    turnsRef,
    pathRef,
    schoolRef,
    schoolIsWaypointRef,
    tripTypeRef,
    waypointsUrlRef,
    modeRef,
    activeWaypointKeyRef,
    onToggleRosterRef,
    onRouteGeometryRef,
  } = args;

  let map: MapLibreMap | undefined;
  let watchId: number | undefined;
  let pins: MapLibreMarker[] = [];
  // Whether overview mode is currently showing every stop/turn
  // (OVERVIEW_DETAIL_ZOOM) rather than just the route's two endpoints -
  // tracked so the map's own "zoomend" handler only redraws pins on an
  // actual crossing, not on every zoom tick.
  let overviewDetailed = false;
  // The live GPS fix (watchPosition below), in [lon, lat] order - null
  // until the first one arrives, or forever if geolocation is denied/
  // unavailable. Read by updateRouteProgress (defined once the route
  // line itself exists) to split the drawn line at how far the bus has
  // actually gotten, not just which step the driver has manually
  // advanced to - watchPosition's own callback lives outside the
  // closure that function is defined in, so this (and
  // applyRouteProgress just below) are what let the one reach the other.
  let liveLngLat: [number, number] | null = null;
  let applyRouteProgress: (() => void) | undefined;
  // The last index into roadLngLats the route line's own traveled/
  // remaining split actually landed on - held onto so a driving-mode
  // step with no resolved coordinate of its own (updateRouteProgress's
  // point lookup coming up empty) leaves the split exactly where it
  // was rather than snapping back to 0.
  let lastRouteSplitIndex = 0;

  function clearPins() {
    for (const marker of pins) marker.remove();
    pins = [];
  }

  // Builds a real DOM element from one of this file's own HTML-string
  // icon builders (stopMarkerHtml/turnMarkerHtml/schoolMarkerHtml) -
  // MapLibre's own Marker takes an element, not an HTML string directly.
  function elementFromHtml(html: string): HTMLDivElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  }

  void import("maplibre-gl").then((maplibregl) =>
    import("pmtiles").then(({ Protocol }) => {
      if (cancelledRef()) return;

      // Must be added once before any pmtiles:// source is used - see
      // mapEngine.ts's own doc comment for what PMTILES_URL points at
      // and how it gets there. Re-registering on every mount is
      // harmless (it just overwrites the same handler), so this skips
      // the ceremony of a module-level "already registered" guard.
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);

      map = new maplibregl.Map({
        container,
        style: protomapsStyle(PMTILES_URL),
        center: toLngLat({
          lat: LA_VERGNE_CENTER[0],
          lon: LA_VERGNE_CENTER[1],
        }),
        zoom: DEFAULT_ZOOM,
        bearing: 0,
        // compact: true - a small "i" that expands to the full credit
        // on tap rather than the credit sitting spelled out in the
        // corner at all times. OSM's own attribution guidelines
        // (osmfoundation.org) explicitly bless this for space-
        // constrained displays, and this app's own overview map is
        // often barely taller than the attribution bar itself.
        attributionControl: { customAttribution: PMTILES_ATTRIBUTION, compact: true },
      });
      const mapInstance = map;
      collapseAttribution(container);
      // showCompass: false - bearing here is driven programmatically
      // (direction of travel in driving mode), not something a driver
      // touches, so the compass puck would just be dead weight.
      mapInstance.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-left",
      );
      // Added right after NavigationControl, same corner - MapLibre
      // stacks same-corner controls in call order, so this lands
      // directly under the zoom buttons with no manual offset math.
      // Only for callers that actually passed onToggleRoster (StepScreen,
      // when this route has any rider-tracked stop) - StartScreen's
      // overview map gets no button at all rather than a dead one.
      if (onToggleRosterRef.current) {
        mapInstance.addControl(
          new ShowRidersControl(() => onToggleRosterRef.current?.()),
          "top-left",
        );
      }

      // addSource/addLayer (the road-geometry line, below) need the
      // style to have actually finished loading first - markers don't
      // technically require this, but everything is gated behind the
      // same "load" event anyway for one predictable draw order:
      // fetch the cache, then draw everything at once.
      mapInstance.once("load", () => {
        if (cancelledRef()) return;

        void fetchCacheAndBuildOrderedWaypoints({
          waypointsUrlRef,
          schoolRef,
          schoolIsWaypointRef,
          tripTypeRef,
          pathRef,
          cacheRef,
          orderedWaypointsRef,
          cancelledRef,
        }).then((resolvedCache) => {
          if (cancelledRef() || !resolvedCache) return;
          // Not just a rename - the nested drawOverviewPin/
          // drawDrivingPins below need `cache` typed non-null in its
          // own right, not merely narrowed from this callback's own
          // parameter.
          const cache = resolvedCache;

          if (orderedWaypointsRef.current.length > 1) {
            fetch("/api/route-geometry", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                waypoints: orderedWaypointsRef.current.map(({ lat, lon }) => ({
                  lat,
                  lon,
                })),
              }),
            })
              .then((res): Promise<RoutingResult> | null => {
                // A non-OK response (quota exceeded, provider down)
                // resolves rather than rejects, so it never reaches
                // the .catch below on its own. Logged here so a
                // missing route line doesn't vanish with no trace.
                if (res.ok) return res.json();
                console.warn(`Couldn't fetch route geometry: HTTP ${res.status} ${res.statusText}`);
                return null;
              })
              .then((result) => {
                if (cancelledRef() || !result) return;
                const roadLngLats = result.geometry.coordinates;
                onRouteGeometryRef.current?.({
                  coordinates: roadLngLats,
                  orderedWaypoints: orderedWaypointsRef.current.filter(
                    (w): w is { key: string; lat: number; lon: number } => w.key != null,
                  ),
                });
                // Two layers sharing one color (ROUTE_LINE_COLOR)
                // rather than one - dotted ahead of the bus, solid
                // behind it, so the line itself shows how far the
                // route has actually been driven, not just that it
                // exists. Both start empty; updateRouteProgress below
                // (called once immediately, and again on every step
                // advance/live GPS fix) is what actually splits
                // roadLngLats between them. beforeId (both layers)
                // places them directly under the road-name labels
                // (added earlier, in protomapsStyle.ts's own layer
                // list) so street names stay legible over the route
                // instead of the line painting over them - addLayer
                // with no beforeId would otherwise stack this on top
                // of literally everything already in the style,
                // labels included.
                mapInstance.addSource("route-remaining", {
                  type: "geojson",
                  data: lineFeature([]),
                });
                mapInstance.addSource("route-traveled", {
                  type: "geojson",
                  data: lineFeature([]),
                });
                mapInstance.addLayer(
                  {
                    id: "route-remaining",
                    type: "line",
                    source: "route-remaining",
                    layout: { "line-cap": "round", "line-join": "round" },
                    paint: {
                      "line-color": ROUTE_LINE_COLOR,
                      "line-width": 4,
                      "line-opacity": 0.85,
                      // A dash length of 0 here used to render as a
                      // solid line instead of a dotted one (dasharray
                      // values are in line-width units, so [0, 2] meant
                      // "0px dash, 8px gap" at width 4 - GL's dash
                      // shader treats that degenerate case as always-on
                      // rather than always-off) - route-remaining (the
                      // portion still ahead) was showing up solid while
                      // route-traveled below (correctly plain/solid)
                      // read as the dotted one by comparison. [0.25, 2.5]
                      // is a real, small dot with a real gap at this
                      // line-width, not a value that can invert itself.
                      "line-dasharray": [0.25, 2.5],
                    },
                  },
                  "roads-major-label",
                );
                mapInstance.addLayer(
                  {
                    id: "route-traveled",
                    type: "line",
                    source: "route-traveled",
                    layout: { "line-cap": "round", "line-join": "round" },
                    paint: {
                      "line-color": ROUTE_LINE_COLOR,
                      "line-width": 4,
                      "line-opacity": 0.85,
                    },
                  },
                  "roads-major-label",
                );

                // Splits roadLngLats at how far the bus has actually
                // gotten - a live GPS fix (liveLngLat) when one
                // exists, otherwise the active step's own resolved
                // coordinate, same "something to show even without
                // GPS" fallback the rest of driving mode already leans
                // on. Assigned to applyRouteProgress (declared outside
                // this whole closure) so watchPosition's own callback -
                // which lives outside it too, since it's registered
                // after this fetch/cache chain rather than inside it -
                // can still trigger a redraw the moment a new GPS fix
                // arrives.
                function updateRouteProgress() {
                  if (modeRef.current !== "driving") {
                    // No live progress to show outside actual turn-by-
                    // turn navigation - the whole line renders as
                    // "traveled" (solid) rather than "remaining"
                    // (dashed), which splitIndex 0 would otherwise do
                    // (nearly the entire road ending up on the dashed
                    // layer).
                    lastRouteSplitIndex = roadLngLats.length - 1;
                  } else {
                    const point = liveLngLat
                      ? { lat: liveLngLat[1], lon: liveLngLat[0] }
                      : (() => {
                          const key = activeWaypointKeyRef.current;
                          const entry = key ? cache[key] : undefined;
                          return entry && entry.status === "ok" ? entry : null;
                        })();
                    // A step with no resolved coordinate yet (an
                    // unverified stop an admin still activated - see
                    // RouteListScreen's own warning for that) has
                    // nothing to compute a new split from - keep
                    // wherever the line last genuinely reached rather
                    // than snapping the solid portion back to the
                    // start.
                    if (point) lastRouteSplitIndex = nearestCoordIndex(roadLngLats, point);
                  }
                  const splitIndex = lastRouteSplitIndex;
                  (mapInstance.getSource("route-traveled") as GeoJSONSource)?.setData(
                    lineFeature(roadLngLats.slice(0, splitIndex + 1)),
                  );
                  (mapInstance.getSource("route-remaining") as GeoJSONSource)?.setData(
                    lineFeature(roadLngLats.slice(splitIndex)),
                  );
                }
                applyRouteProgress = updateRouteProgress;
                updateRouteProgress();

                if (modeRef.current === "overview" && roadLngLats.length > 0) {
                  const lons = roadLngLats.map((c) => c[0]);
                  const lats = roadLngLats.map((c) => c[1]);
                  mapInstance.fitBounds(
                    [
                      [Math.min(...lons), Math.min(...lats)],
                      [Math.max(...lons), Math.max(...lats)],
                    ],
                    { padding: 40, maxZoom: 16 },
                  );
                }
              })
              .catch((err) =>
                console.warn("Couldn't fetch route geometry:", err),
              );
          }

          // The route's two ends get a real, numbered pin - every turn,
          // and every stop between them, is deliberately left off this
          // zoomed-out view (drawDrivingPins below draws the full,
          // numbered set once the admin zooms in past
          // OVERVIEW_DETAIL_ZOOM); an in-between stop still gets a plain
          // dot (stopDotHtml's own doc comment has why) so the route's
          // overall shape - roughly how many stops, and where - is still
          // visible without the clutter, and a turn gets nothing at all,
          // since "how many turns and where" was never the question this
          // zoomed-out view answers. Reads off orderedWaypointsRef rather
          // than stopsRef/schoolRef directly since that's already in
          // trip order with the school spliced into whichever end
          // tripType puts it - the same list the road-geometry request
          // and bearing math both use.
          function drawOverviewPins() {
            clearPins();
            const ordered = orderedWaypointsRef.current;
            if (ordered.length === 0) return;
            const endpoints =
              ordered.length === 1 ? [ordered[0]] : [ordered[0], ordered[ordered.length - 1]];
            for (const point of endpoints) {
              const stop = stopsRef.current.find((s) => s.waypointKey === point.key);
              const html = point.key === null ? schoolMarkerHtml() : stop && stopMarkerHtml(stop.number);
              if (!html) continue;
              pins.push(
                new maplibregl.Marker({ element: elementFromHtml(html), anchor: "bottom" })
                  .setLngLat(toLngLat(point))
                  .addTo(mapInstance),
              );
            }
            for (const point of ordered.slice(1, -1)) {
              const stop = stopsRef.current.find((s) => s.waypointKey === point.key);
              if (!stop) continue;
              pins.push(
                new maplibregl.Marker({ element: elementFromHtml(stopDotHtml()), anchor: "center" })
                  .setLngLat(toLngLat(point))
                  .addTo(mapInstance),
              );
            }
          }

          function drawDrivingPins() {
            clearPins();
            for (const stop of stopsRef.current) {
              const entry = cache[stop.waypointKey];
              if (!entry || entry.status !== "ok") continue;
              pins.push(
                new maplibregl.Marker({
                  element: elementFromHtml(stopMarkerHtml(stop.number)),
                  anchor: "bottom",
                })
                  .setLngLat(toLngLat(entry))
                  .addTo(mapInstance),
              );
            }
            for (const turn of turnsRef.current) {
              const entry = cache[turn.waypointKey];
              if (!entry || entry.status !== "ok") continue;
              const html = turnMarkerHtml(turn.direction, turn.heading);
              if (!html) continue;
              pins.push(
                new maplibregl.Marker({
                  element: elementFromHtml(html),
                  anchor: "center",
                })
                  .setLngLat(toLngLat(entry))
                  .addTo(mapInstance),
              );
            }
            if (schoolRef.current) {
              pins.push(
                new maplibregl.Marker({
                  element: elementFromHtml(schoolMarkerHtml()),
                  anchor: "bottom",
                })
                  .setLngLat(toLngLat(schoolRef.current))
                  .addTo(mapInstance),
              );
            }
          }

          syncToModeRef.current = () => {
            if (modeRef.current === "overview") {
              overviewDetailed = mapInstance.getZoom() >= OVERVIEW_DETAIL_ZOOM;
              if (overviewDetailed) drawDrivingPins();
              else drawOverviewPins();
              if (orderedWaypointsRef.current.length > 0) {
                const lons = orderedWaypointsRef.current.map((w) => w.lon);
                const lats = orderedWaypointsRef.current.map((w) => w.lat);
                mapInstance.fitBounds(
                  [
                    [Math.min(...lons), Math.min(...lats)],
                    [Math.max(...lons), Math.max(...lats)],
                  ],
                  { padding: 40, maxZoom: 16 },
                );
              }
              return;
            }

            applyRouteProgress?.();
            const bearing = bearingAt(
              orderedWaypointsRef.current,
              activeWaypointKeyRef.current,
            );
            const key = activeWaypointKeyRef.current;
            const entry = key ? cache[key] : undefined;
            if (!entry || entry.status !== "ok") {
              // No coordinate to fly to yet - still rotate on its own,
              // animated the same 1s as every other camera move here,
              // rather than leaving bearing stuck at whatever it last
              // was until a real flyTo eventually comes along.
              if (bearing != null) {
                mapInstance.easeTo({ bearing, duration: DRIVING_FLY_DURATION_MS });
              }
              if (!drivingPinsRevealedRef.current) {
                drawDrivingPins();
                drivingPinsRevealedRef.current = true;
              }
              return;
            }
            if (!drivingPinsRevealedRef.current) {
              mapInstance.once("moveend", () => {
                drawDrivingPins();
                drivingPinsRevealedRef.current = true;
              });
            }
            // bearing folded straight into this flyTo (MapLibre
            // interpolates position and bearing together over one
            // duration) rather than a separate setBearing call - one
            // motion, not a fast position flight with an instantly
            // snapped, separately-timed spin.
            mapInstance.flyTo({
              center: toLngLat(entry),
              zoom: STREET_ZOOM,
              ...(bearing != null ? { bearing } : {}),
              duration: DRIVING_FLY_DURATION_MS,
            });
          };
          syncToModeRef.current();

          // Reveals every stop/turn pin once the admin zooms in past
          // OVERVIEW_DETAIL_ZOOM while overview mode is showing - a
          // no-op in driving mode, which manages its own pin reveal via
          // drivingPinsRevealedRef above. "zoomend" (not "zoom") so this
          // redraws once per gesture/animation rather than on every
          // intermediate frame.
          mapInstance.on("zoomend", () => {
            if (cancelledRef() || modeRef.current !== "overview") return;
            const detailed = mapInstance.getZoom() >= OVERVIEW_DETAIL_ZOOM;
            if (detailed === overviewDetailed) return;
            overviewDetailed = detailed;
            if (detailed) drawDrivingPins();
            else drawOverviewPins();
          });
        });
      });

      if (typeof navigator === "undefined" || !("geolocation" in navigator))
        return;

      let locationMarker: MapLibreMarker | undefined;
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (cancelledRef()) return;
          const lngLat: [number, number] = [
            position.coords.longitude,
            position.coords.latitude,
          ];
          if (!locationMarker) {
            const el = elementFromHtml(LOCATION_DOT_HTML);
            el.style.zIndex = "1000";
            locationMarker = new maplibregl.Marker({ element: el })
              .setLngLat(lngLat)
              .addTo(mapInstance);
          } else {
            locationMarker.setLngLat(lngLat);
          }
          liveLngLat = lngLat;
          applyRouteProgress?.();
        },
        (error) => {
          console.warn("Geolocation unavailable:", error.message);
        },
        { enableHighAccuracy: true },
      );
    }),
  );

  return () => {
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    clearPins();
    map?.remove();
  };
}
