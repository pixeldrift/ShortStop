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
import { PersonSolidIcon } from "./icons";
import { rotationKeyFor, setTurnDiamondRotation, turnDiamondHtml } from "./mapMarkerIcons";
import {
  collapseAttribution,
  installSchoolBuildingHighlight,
  PMTILES_ATTRIBUTION,
  PMTILES_URL,
  ROUTE_LINE_OFFSET,
  ROUTE_LINE_WIDTH,
} from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import {
  cumulativeDistances,
  nearestSegmentBearings,
  pointAtDistance,
  roadBearingAt,
} from "@/lib/routeProgress";
import type { LatLon } from "@/lib/routeProgress";
import type { RouteCoordinate, RoutingResult } from "@/lib/routing/types";
import { spreadCoincidentPoints } from "@/lib/spreadCoincidentPoints";
import type { TripType, TurnDirection } from "@/lib/types";
import { resolveRouteCoordinates } from "@/lib/waypointCache";
import type { WaypointCache } from "@/lib/waypointCache";

/** One "stop" step's marker: waypointKey looks it up in the resolved-
 * coordinates map mountMapLibre builds from the `path` prop below
 * (resolveRouteCoordinates, waypointCache.ts - an override if the step
 * has one, otherwise the geocoded cache), number is its position among
 * stops (1-indexed) for the pin's on-map label - matching the same
 * numbering RouteProgressBar/StopContent already show for the same
 * stop. */
export type StopMarker = { waypointKey: string; number: number };

/** One "turn" step's marker - waypointKey looks it up the same way a
 * StopMarker does. `direction`/`heading` are the same step's own
 * NavigationStep fields, fed to turnDiamondHtml (mapMarkerIcons.tsx): a
 * left/right turn draws its own real left.svg/right.svg sign, rotated
 * whole (frame and arrow together) to its own true compass bearing
 * (see applyTurnRotations below), anything else (Proceed,
 * Depart, Arrive, ...) draws its own already-distinct ActionIcon glyph.
 * Route 125's own steps sheet is the only one with real turn-by-turn
 * data today (every 120 route sheet is stops only) - this only ever
 * renders something there, but nothing here is specific to that route. */
export type TurnMarker = {
  waypointKey: string;
  direction?: TurnDirection;
  heading?: string;
};

/** One entry of the `path` prop below - a step's own key plus its own
 * override, exactly what resolveStepCoordinate/resolveRouteCoordinates
 * (waypointCache.ts) need to resolve it correctly and in the right
 * sequential order. */
export type PathPoint = { waypointKey: string; overrideLat: number | null; overrideLon: number | null };

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

// The road-following route line's own two colors - both deliberately
// distinct from the school/stop pins' own blue (#2563eb, schoolMarkerHtml/
// stopMarkerHtml below) so the line never reads as though it were just
// another pin, especially where one sits right on top of it. Two solid
// colors, not one color split dashed-vs-solid the way this used to work -
// a dashed line's own dash phase visibly crawls/resets on every redraw
// (every step advance, every live GPS fix, and MapLibre's own internal
// re-tessellation as the driving camera's bearing animates), which read
// as the line itself jittering rather than smoothly extending. Solid
// throughout, light ahead and dark behind, shows the exact same traveled/
// remaining split with no redraw-driven flicker.
const ROUTE_LINE_COLOR_REMAINING = "#93c5fd";
const ROUTE_LINE_COLOR_TRAVELED = "#1d4ed8";

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
  // pin.svg's own circular head sits centered at 34.0% of its own
  // height (y=186.18 of a 548-tall viewBox), not 31%.
  return (
    '<div class="relative h-11 w-7">' +
    '<img src="/assets/pin.svg" class="h-full w-full" alt="" />' +
    '<span class="font-heading absolute top-[34%] left-1/2 -translate-x-1/2 -translate-y-1/2 ' +
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

// A turn's own on-map marker - the same yellow diamond every other map
// in this app now draws for a direction waypoint (turnDiamondHtml,
// mapMarkerIcons.tsx - see its own doc comment), sized to roughly match
// this map's own existing h-8 pin scale. Left/Right's own whole sign
// (frame and arrow together, unlike a rider pin) is rotated to its
// real compass bearing (setTurnDiamondRotation, called from
// drawDrivingPins/applyTurnRotations below) rather than the old
// raster sign's fixed mirror, which only ever showed roughly which way
// relative to whatever the screen/camera happened to be facing.
const TURN_DIAMOND_SIZE = 32;

// The school itself - its own blue pin, distinct from a stop's red one
// (a school is where the route starts or ends, never a stop a driver
// checks riders in/out at) and a turn's yellow diamond. Draws from
// pin-blue.svg the same way stopMarkerHtml (above) draws from pin.svg -
// not the plain MapPinIcon glyph (icons.tsx), which is reserved for
// UI-only uses (a label next to an address) and never belongs on an
// actual map surface. Same h-11 w-7 box as stopMarkerHtml so a school
// pin reads as the same "weight" as a stop pin, just recolored.
function schoolMarkerHtml(): string {
  return (
    '<div class="relative h-11 w-7">' +
    '<img src="/assets/pin-blue.svg" class="h-full w-full" alt="" />' +
    "</div>"
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
  /** Every real waypoint's own exact distance-along-route (meters from
   * the route's start), keyed by waypointKey - the same map this
   * component's own distanceAlongRouteByKey is built from
   * (RoutingResult.waypointDistances, routing/types.ts - straight from
   * the routing provider's own per-leg distances, not a nearest-point
   * search). A snapshot at the moment this callback fires, not a live
   * reference - this component's own copy never changes after its
   * first route-geometry fetch resolves anyway (same "loads once per
   * route" reasoning this whole result already carries), so there's
   * nothing for a caller to miss by holding onto its own copy. */
  waypointDistances: Map<string, number>;
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

// Driving mode's own "which way is the bus facing" - the real road
// bearing (roadBearingAt, routeProgress.ts) at the active waypoint's
// own spot along the actual road-following line, looking back the way
// the bus just came, not the road it's about to turn onto. This is
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
// Takes `distanceAlongRoute` directly rather than a raw coordinate to
// project itself - the caller looks that up from
// distanceAlongRouteByKey (trip-order-safe, same map
// updateRouteProgress's own traveled/remaining split reads from), not
// a fresh ad hoc projectOntoRoute call on just this one point. That
// distinction matters here for the exact same reason it did for that
// split: a lone projection can't tell a route's second close pass near
// some corner from its first, so on a route with turns onto nearby or
// crossing streets it could resolve to an *earlier*, wrong stretch of
// road - and since every turn sign's own on-screen rotation is
// computed relative to this camera bearing (mapBearingDeg,
// applyTurnRotations below), a wrong camera bearing here doesn't just
// misrotate the camera itself, it throws off every sign's own apparent
// rotation right along with it, however correct each one's own real
// bearing already is. Using the actual road geometry here (not a
// straight line between waypoints, which this used to be) is also what
// keeps this in agreement with a turn sign's own bearing
// (drawDrivingPins, same file) - both now read off the identical road
// line, at the same distanceAlongRouteByKey value, the same way. Falls
// back to the bearing looking
// *ahead* only at the route's very first step (Depart) or anywhere
// else roadBearingAt has no real "incoming" distance to measure (the
// active point sits at, or before, the very start of the fetched road
// line). Null if there's no road geometry yet, or no real distance to
// measure from.
function bearingAt(
  coords: LatLon[],
  cumulative: number[],
  distanceAlongRoute: number | null,
): number | null {
  if (distanceAlongRoute == null || coords.length < 2) return null;
  return (
    roadBearingAt(coords, cumulative, distanceAlongRoute, "incoming") ??
    roadBearingAt(coords, cumulative, distanceAlongRoute, "outgoing")
  );
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
  /** Every step's own waypointKey (plus its own override, if it has
   * one), in the route's own order (stops and turns both -
   * StepScreen.tsx derives this straight from route.steps). Used to
   * build the ordered list of {lat, lon} points (school spliced in at
   * whichever end `tripType` puts it) sent to /api/route-geometry for
   * the actual road-following line - not drawn directly itself.
   * Resolved through resolveStepCoordinate (waypointCache.ts), so an
   * override wins, and an ambiguous intersection lands on whichever of
   * its own known candidates this point in the route is actually
   * closest to; whichever of these still resolve to nothing at all (an
   * ungeocoded or unresolvable step) are simply left out of the list,
   * same as a missing `stops`/`turns` marker. */
  path?: PathPoint[];
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

  // Same "starts as a no-op, only ever assigned once there's a real map
  // to act on" shape as syncToModeRef above.
  const refreshResolutionRef = useRef<() => void>(() => {});
  // `path` (StepScreen's own routePath, memoized on [route]) changing
  // identity means a step's own resolved coordinate can be different
  // now than when this map last drew it - a waypoint's own coordinate
  // override saved from elsewhere (another admin's own device, mid-
  // trip, say - or any future flow that touches this route's own steps
  // while this same map instance stays mounted) rather than a step
  // advance, which the [mode, activeWaypointKey] effect above already
  // covers on its own. The mount effect just below only ever resolves
  // coordinates and draws pins once, at the map's own "load" event -
  // pathRef.current itself does stay current (see its own sync effect
  // above), but nothing previously re-read it afterward, so a route
  // whose coordinates changed while this exact map instance stayed
  // mounted kept right on showing wherever they used to be. First
  // fires before the mount effect's own async chain has gotten anywhere
  // near assigning refreshResolutionRef a real function, so it's a
  // harmless no-op on initial mount - only a later, genuine `path`
  // change actually asks for anything.
  useEffect(() => {
    refreshResolutionRef.current();
  }, [path]);

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
      refreshResolutionRef,
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
      refreshResolutionRef.current = () => {};
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
  pathRef: React.RefObject<PathPoint[]>;
  schoolRef: React.RefObject<{ lat: number; lon: number } | null | undefined>;
  schoolIsWaypointRef: React.RefObject<boolean>;
  tripTypeRef: React.RefObject<TripType | undefined>;
  waypointsUrlRef: React.RefObject<string>;
  modeRef: React.RefObject<"overview" | "driving">;
  activeWaypointKeyRef: React.RefObject<string | null | undefined>;
  onToggleRosterRef: React.RefObject<(() => void) | undefined>;
  onRouteGeometryRef: React.RefObject<((result: RouteGeometryResult) => void) | undefined>;
  /** Assigned once mountMapLibre has resolved coordinates and drawn
   * pins for the first time (mirrors syncToModeRef's own "starts as a
   * no-op, becomes real once there's a map to act on" pattern) - lets
   * RouteMap's own [path]-watching effect below ask for everything
   * (the shared cache, every step's own resolved point, the road-
   * following line, every pin) to be re-fetched and redrawn from
   * scratch, without tearing down and recreating the whole MapLibre
   * instance to do it. See that effect's own doc comment for why this
   * needs to exist at all - the mount effect just below only ever
   * resolves/draws once, at the map's own "load" event, and otherwise
   * has no way to notice `path` itself later reporting a different
   * coordinate for a step it already drew. */
  refreshResolutionRef: React.RefObject<() => void>;
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
): Promise<{ cache: WaypointCache; resolvedByKey: Map<string, { lat: number; lon: number }> } | null> {
  const cache: WaypointCache = await fetch(args.waypointsUrlRef.current)
    .then((res): Promise<WaypointCache> | WaypointCache =>
      res.ok ? res.json() : {},
    )
    .catch(() => ({}) as WaypointCache);
  if (args.cancelledRef()) return null;
  args.cacheRef.current = cache;

  // Every step's own real point - an override if it has one, otherwise
  // whichever cache candidate this point in the route's own sequence is
  // actually closest to (resolveRouteCoordinates, waypointCache.ts) -
  // resolved once, here, and shared by both the road-geometry request
  // below and every pin this route ever draws (drawDrivingPins/
  // drawOverviewPins), so they never disagree about where a step with a
  // known second road crossing actually is.
  const schoolAnchor = args.schoolRef.current ?? null;
  const resolvedList = resolveRouteCoordinates(args.pathRef.current, cache, schoolAnchor);
  const resolvedByKey = new Map<string, { lat: number; lon: number }>();
  args.pathRef.current.forEach((point, i) => {
    const resolved = resolvedList[i];
    if (resolved) resolvedByKey.set(point.waypointKey, resolved);
  });

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
  for (const point of args.pathRef.current) {
    const resolved = resolvedByKey.get(point.waypointKey);
    if (!resolved) continue;
    orderedWaypoints.push({ key: point.waypointKey, lat: resolved.lat, lon: resolved.lon });
  }
  if (includeSchool && args.tripTypeRef.current !== "dropoff") {
    orderedWaypoints.push({
      key: null,
      lat: args.schoolRef.current!.lat,
      lon: args.schoolRef.current!.lon,
    });
  }
  args.orderedWaypointsRef.current = orderedWaypoints;
  return { cache, resolvedByKey };
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
    refreshResolutionRef,
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
  let applyRouteProgress: (() => void) | undefined;
  // The last distance-along-route (meters) the route line's own
  // traveled/remaining split actually landed on - held onto so a
  // driving-mode step with no resolved coordinate of its own
  // (updateRouteProgress's point lookup coming up empty) leaves the
  // split exactly where it was rather than snapping back to 0.
  let lastRouteSplitDistance = 0;
  // Every waypoint's own real distance-along-route (meters) - populated
  // once, eagerly, the moment the route-geometry fetch itself resolves
  // (search "distanceAlongRouteByKey.set" below), straight from that
  // response's own RoutingResult.waypointDistances (routing/types.ts) -
  // the routing provider's own exact per-leg distances, aligned index-
  // for-index with orderedWaypointsRef.current (the same array the
  // request itself was built from), not a nearest-point search over the
  // returned geometry. Read by updateRouteProgress (a sibling closure,
  // not nested inside drawDrivingPins, and one whose own first call can
  // happen before driving mode's pins are ever drawn) to look up the
  // *active* step's own distance, instead of running a fresh
  // projectOntoRoute search on just that one point (which, being a
  // nearest-point search, could still resolve to the wrong pass on a
  // route that doubles back - the routing provider's own per-leg
  // distances carry no such ambiguity, since no pass is ever "found,"
  // each one is just handed straight over). drawDrivingPins reads this
  // same map for turn/stop bearings too, for the identical reason.
  const distanceAlongRouteByKey = new Map<string, number>();
  // This route's own already-fetched road-following geometry (set once
  // the /api/route-geometry request below resolves) - read by
  // drawDrivingPins, which needs it to offset a coincident group of
  // stops onto the real side of the road (spreadCoincidentPoints), not
  // just to draw the line itself. Declared out here rather than read
  // straight off the fetch's own closure since drawDrivingPins is
  // defined one scope further out than that fetch's `.then`, same
  // "outer variable a later callback can still reach" reasoning
  // applyRouteProgress above already relies on.
  let latestRoadGeometry: RouteCoordinate[] = [];
  // Every step's own real point, straight off resolveAndRedraw's own
  // fetchCacheAndBuildOrderedWaypoints call (below) - an outer mutable
  // for the identical reason latestRoadGeometry just above is: read by
  // drawDrivingPins/drawOverviewPins/syncToModeRef, all defined once,
  // right after the map itself is created, well before resolveAndRedraw
  // has resolved anything the first time. A plain `const` destructured
  // straight out of resolveAndRedraw's own result (the original shape
  // this took) would leave those three reading whichever snapshot
  // existed the moment *they* were defined - fine the first time, but
  // exactly the kind of staleness refreshResolutionRef exists to fix
  // when resolveAndRedraw runs again later.
  let resolvedByKey = new Map<string, { lat: number; lon: number }>();
  // Every currently-drawn Left/Right/Continue/Proceed marker element,
  // paired with its real compass bearing (setTurnDiamondRotation,
  // mapMarkerIcons.tsx) - kept here, not just recomputed inside
  // drawDrivingPins, so the map's own "rotate" listener below
  // (registered once, right after the map itself is created) can keep
  // every sign correctly oriented throughout an entire live bearing
  // animation (driving mode's own easeTo toward the bus's current
  // heading), not just the one instant drawDrivingPins happened to run.
  // `rotationKey` is rotationKeyFor's own return value (mapMarkerIcons.tsx)
  // - only ever a real key into that module's ARROW_DEFAULT_BEARING, so
  // entries only exist here for markers that actually have a real-world
  // pointing direction to rotate toward.
  let turnArrowRotations: {
    element: HTMLElement;
    rotationKey: string;
    bearing: number | null;
  }[] = [];

  function clearPins() {
    for (const marker of pins) marker.remove();
    pins = [];
    turnArrowRotations = [];
  }

  // Re-applies every currently-drawn turn sign's own real compass
  // bearing against whatever the map's own on-screen bearing is right
  // now - called once immediately after drawDrivingPins draws a fresh
  // set (so a turn's sign starts correctly oriented even mid-rotation,
  // not just after the next "rotate" event ticks), and on every
  // "rotate" event afterward so it stays correct as driving mode's own
  // camera spin (bearingAt/easeTo below) continues to animate.
  function applyTurnRotations() {
    if (!map) return;
    const mapBearing = map.getBearing();
    for (const { element, rotationKey, bearing } of turnArrowRotations) {
      setTurnDiamondRotation(element, rotationKey, bearing, mapBearing);
    }
  }

  // Builds a real DOM element from one of this file's own HTML-string
  // icon builders (stopMarkerHtml/schoolMarkerHtml here, turnDiamondHtml
  // in mapMarkerIcons.tsx) - MapLibre's own Marker takes an element, not
  // an HTML string directly.
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
      mapInstance.on("rotate", applyTurnRotations);
      // schoolRef already stays current on its own (this component's
      // own sync effect, above) - the highlight just needs to be told
      // where to look once, self-maintains from there (see its own doc
      // comment, mapEngine.ts).
      installSchoolBuildingHighlight(mapInstance, schoolRef);
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

      // drawOverviewPins/drawDrivingPins/syncToModeRef, defined once
      // here rather than inside resolveAndRedraw below (which can run
      // again later, on a genuine `path` change - refreshResolutionRef's
      // own doc comment, RouteMap's own component body, has why) - all
      // three close over resolvedByKey/latestRoadGeometry/
      // distanceAlongRouteByKey as the outer mutables they now are (see
      // each one's own doc comment above), so a long-lived caller (the
      // "zoomend" listener below, or the [mode, activeWaypointKey]
      // effect's own syncToModeRef.current() call, registered once and
      // never touched again after this) always reads whatever
      // resolveAndRedraw most recently resolved, not a stale snapshot
      // frozen at whichever call happened to define them.
      //
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
        // Dots added first, the two endpoint pins second - MapLibre
        // markers are plain DOM elements with no z-index of their
        // own, so whichever gets added last simply paints on top.
        // A dot sitting close enough to overlap an endpoint pin
        // should always lose that overlap to the pin, never cover
        // it - the pin is the one carrying the actual number/
        // school glyph a driver needs to read.
        for (const point of ordered.slice(1, -1)) {
          const stop = stopsRef.current.find((s) => s.waypointKey === point.key);
          if (!stop) continue;
          pins.push(
            new maplibregl.Marker({ element: elementFromHtml(stopDotHtml()), anchor: "center" })
              .setLngLat(toLngLat(point))
              .addTo(mapInstance),
          );
        }
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
      }

      function drawDrivingPins() {
        clearPins();
        // A route that genuinely stops twice at one real
        // intersection (different directions of approach, at
        // different times) resolves both stops to the same point -
        // spread apart (same helper/threshold WaypointPreviewMap.tsx's
        // own StopPin drawing uses) onto whichever real side of the
        // road latestRoadGeometry (this route's own already-fetched
        // road geometry) draws that stop's own pass on, so both
        // stay visible and tappable instead of one drawing directly
        // on top of the other.
        const resolvedStops = stopsRef.current
          .map((stop) => ({ stop, point: resolvedByKey.get(stop.waypointKey) }))
          .filter(
            (entry): entry is { stop: StopMarker; point: { lat: number; lon: number } } =>
              entry.point != null,
          );
        const roadLine = latestRoadGeometry.map(([lon, lat]) => ({ lat, lon }));
        const roadCumulative = cumulativeDistances(roadLine);
        // Every real bearing read straight off distanceAlongRouteByKey
        // (populated from the routing provider's own exact per-leg
        // distances - see that map's own doc comment) via
        // roadBearingAt, not a fresh nearestSegmentBearings search -
        // a double-back's two visits to the same real corner already
        // resolve to two different, correct distances there, so
        // there's no "which pass" ambiguity left for a bearing search
        // to have to untangle either. Any rotatable turn/action's own
        // entry (Left/Right/Continue/Proceed - rotationKeyFor,
        // mapMarkerIcons.tsx) looks "outgoing" - its sign needs the
        // road it's actually about to be on, not the one just
        // traveled in on, unlike a stop (which wants the incoming
        // road it's still sitting on, the default direction
        // roadBearingAt itself takes when passed "incoming").
        const rotatableKeys = new Set(
          turnsRef.current
            .filter((turn) => rotationKeyFor(turn.direction, turn.heading) != null)
            .map((turn) => turn.waypointKey),
        );
        const bearingByKey = new Map<string, number | null>();
        orderedWaypointsRef.current.forEach((waypoint) => {
          if (waypoint.key == null) return;
          const distance = distanceAlongRouteByKey.get(waypoint.key);
          if (distance == null) return;
          const direction = rotatableKeys.has(waypoint.key) ? "outgoing" : "incoming";
          bearingByKey.set(waypoint.key, roadBearingAt(roadLine, roadCumulative, distance, direction));
        });
        const spreadPoints = spreadCoincidentPoints(
          resolvedStops.map((entry) => entry.point),
          resolvedStops.map((entry) => bearingByKey.get(entry.stop.waypointKey) ?? null),
        );
        resolvedStops.forEach((entry, i) => {
          pins.push(
            new maplibregl.Marker({
              element: elementFromHtml(stopMarkerHtml(entry.stop.number)),
              anchor: "bottom",
            })
              .setLngLat(toLngLat(spreadPoints[i]))
              .addTo(mapInstance),
          );
        });
        for (const turn of turnsRef.current) {
          const point = resolvedByKey.get(turn.waypointKey);
          if (!point) continue;
          const html = turnDiamondHtml(TURN_DIAMOND_SIZE, turn.direction, turn.heading);
          if (!html) continue;
          const element = elementFromHtml(html);
          const rotationKey = rotationKeyFor(turn.direction, turn.heading);
          if (rotationKey != null) {
            turnArrowRotations.push({
              element,
              rotationKey,
              bearing: bearingByKey.get(turn.waypointKey) ?? null,
            });
          }
          pins.push(
            new maplibregl.Marker({
              element,
              anchor: "center",
            })
              .setLngLat(toLngLat(point))
              .addTo(mapInstance),
          );
        }
        applyTurnRotations();
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
        const key = activeWaypointKeyRef.current;
        const point = key ? resolvedByKey.get(key) : undefined;
        const roadLine = latestRoadGeometry.map(([lon, lat]) => ({ lat, lon }));
        const activeDistance = key ? (distanceAlongRouteByKey.get(key) ?? null) : null;
        const bearing = bearingAt(roadLine, cumulativeDistances(roadLine), activeDistance);
        if (!point) {
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
          center: toLngLat(point),
          zoom: STREET_ZOOM,
          ...(bearing != null ? { bearing } : {}),
          duration: DRIVING_FLY_DURATION_MS,
        });
      };

      // Whether the road-following line's own sources/layers have
      // been added yet - guards resolveAndRedraw below from ever
      // calling addSource/addLayer a second time (MapLibre throws
      // on a duplicate id) once it runs again later, on a genuine
      // `path` change; updateRouteProgress's own .setData calls
      // update the existing sources in place either way, every time.
      let routeLayersAdded = false;

      // Fetches the shared waypoint cache, resolves every step's
      // own real coordinate (an override if it has one, otherwise
      // whichever cache candidate this point in the route's own
      // sequence is actually closest to - resolveRouteCoordinates,
      // waypointCache.ts), and redraws everything from that.
      // Originally this only ever ran once, straight from
      // mapInstance.once("load", ...) below; now also reachable
      // through refreshResolutionRef (assigned once this first run
      // finishes, same "no-op until there's a real map" shape as
      // syncToModeRef above already has) so a `path` change later -
      // a coordinate override saved from elsewhere while this exact
      // map instance stays mounted, say - gets the same fresh
      // treatment instead of this map quietly going on showing
      // wherever that step used to resolve to.
      async function resolveAndRedraw() {
        const result = await fetchCacheAndBuildOrderedWaypoints({
          waypointsUrlRef,
          schoolRef,
          schoolIsWaypointRef,
          tripTypeRef,
          pathRef,
          cacheRef,
          orderedWaypointsRef,
          cancelledRef,
        });
        if (cancelledRef() || !result) return;
        resolvedByKey = result.resolvedByKey;

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
              latestRoadGeometry = roadLngLats;

              // Cleared first, not just re-set - a second
              // resolveAndRedraw shares this same outer Map (see its
              // own doc comment), and a waypoint the route no longer
              // has (deleted between resolves) would otherwise leave
              // a stale distance behind forever instead of simply
              // being absent.
              distanceAlongRouteByKey.clear();
              // Populates distanceAlongRouteByKey straight from the
              // routing provider's own exact per-leg distances
              // (result.waypointDistances, routing/types.ts) -
              // aligned index-for-index with orderedWaypointsRef.current,
              // the exact array this fetch's own request body was
              // built from just above. No search or projection
              // involved, unlike the nearestSegmentBearings-based
              // approach this replaced: the routing provider computed
              // this route through exactly these points, in this
              // order, so there's simply nothing to guess - not even
              // in principle can a route that doubles back and
              // re-crosses the same real corner resolve a waypoint to
              // the wrong pass this way, since no pass is ever
              // "found," each one is just handed straight over.
              // Falls back to the old trip-ordered search only for a
              // (today hypothetical - ORS always reports this)
              // provider that doesn't report per-leg distances at all.
              if (result.waypointDistances) {
                result.waypointDistances.forEach((distance, i) => {
                  const key = orderedWaypointsRef.current[i]?.key;
                  if (key != null) distanceAlongRouteByKey.set(key, distance);
                });
              } else {
                const roadLine: LatLon[] = roadLngLats.map(([lon, lat]) => ({ lat, lon }));
                nearestSegmentBearings(roadLine, orderedWaypointsRef.current).forEach(
                  ({ distanceAlongRoute }, i) => {
                    const key = orderedWaypointsRef.current[i]?.key;
                    if (key != null) distanceAlongRouteByKey.set(key, distanceAlongRoute);
                  },
                );
              }

              onRouteGeometryRef.current?.({
                coordinates: roadLngLats,
                waypointDistances: new Map(distanceAlongRouteByKey),
              });

              // Two layers, two solid colors (light ahead, dark
              // behind - ROUTE_LINE_COLOR_REMAINING/_TRAVELED above),
              // so the line itself shows how far the route has
              // actually been driven, not just that it exists. Both
              // start empty; updateRouteProgress below (called once
              // immediately, and again on every step advance) is what
              // actually splits roadLngLats between them. beforeId
              // (both layers) places them directly under the road-name
              // labels (added earlier, in protomapsStyle.ts's own
              // layer list) so street names stay legible over the
              // route instead of the line painting over them -
              // addLayer with no beforeId would otherwise stack this
              // on top of literally everything already in the style,
              // labels included. Guarded by routeLayersAdded (above)
              // since a second resolveAndRedraw finds both sources
              // already there - only the traveled/remaining split
              // itself (updateRouteProgress, below) needs to run
              // again, not this one-time setup.
              if (!routeLayersAdded) {
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
                      "line-color": ROUTE_LINE_COLOR_REMAINING,
                      "line-width": ROUTE_LINE_WIDTH,
                      "line-offset": ROUTE_LINE_OFFSET,
                      "line-opacity": 0.85,
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
                      "line-color": ROUTE_LINE_COLOR_TRAVELED,
                      "line-width": ROUTE_LINE_WIDTH,
                      "line-offset": ROUTE_LINE_OFFSET,
                      "line-opacity": 0.85,
                    },
                  },
                  "roads-major-label",
                );
                routeLayersAdded = true;
              }

              // roadLngLats converted to {lat,lon} + its own
              // cumulative distances, computed once per route-geometry
              // fetch (roadLngLats itself never changes after this) -
              // updateRouteProgress below needs both every time it
              // runs (every step advance, every live GPS fix), so
              // building them once here instead of per call avoids
              // re-walking the whole line on every single GPS fix.
              const roadLine: LatLon[] = roadLngLats.map(([lon, lat]) => ({ lat, lon }));
              const roadCumulative = cumulativeDistances(roadLine);
              const roadTotalDistance = roadCumulative[roadCumulative.length - 1] ?? 0;

              // Splits roadLngLats at how far the bus has actually
              // gotten - always the *active step's* own real distance-
              // along-route (distanceAlongRouteByKey, populated above,
              // trip-order-safe), for every waypoint kind (turn or
              // stop alike - the active step's own resolved coordinate,
              // not just a stop's), never a live GPS fix. A GPS
              // projection used to be blended in (taking whichever of
              // the two candidates was further along), but a single
              // coarse/inaccurate fix - the common case testing from a
              // desk, or just weak signal - could project onto a
              // wildly wrong point on the route (nearest a *later* stop
              // the bus hasn't actually reached yet, say) and that
              // reading could never be un-taken once it landed, since
              // the whole point of taking the max was to never regress
              // the split backward - the traveled portion would jump
              // far ahead of the real position and stay stuck there for
              // the rest of the drive, no matter how many turns still
              // lay between. The step the driver has actually advanced
              // to (via Next, same as every other piece of driving
              // mode's own state) is the one source of truth this app
              // already trusts for "where are we now" - GPS still drives
              // the separate blue location dot (watchPosition below),
              // just not this split. Splits at the real interpolated
              // point that distance falls on (pointAtDistance), not
              // just whichever geometry vertex happens to be nearest it
              // (that used to be nearestCoordIndex's own job) - a
              // route-geometry provider can space its own vertices
              // anywhere from a few meters to tens of meters apart, and
              // snapping to one instead of the real point is exactly
              // what made the traveled/remaining boundary look like it
              // landed somewhere arbitrary instead of lining up with
              // the current step. Assigned to applyRouteProgress
              // (declared outside this whole closure) so a later step
              // advance - whose own effect lives outside this fetch's
              // `.then`, in RouteMap's own [mode, activeWaypointKey]
              // effect - can still trigger a redraw.
              function updateRouteProgress() {
                if (modeRef.current !== "driving") {
                  // No live progress to show outside actual turn-by-
                  // turn navigation - the whole line renders as
                  // "traveled" rather than "remaining", which distance
                  // 0 would otherwise do (nearly the entire road ending
                  // up on the remaining layer).
                  lastRouteSplitDistance = roadTotalDistance;
                } else {
                  // A step with no resolved key/distance yet (an
                  // unverified stop an admin still activated - see
                  // RouteListScreen's own warning for that) leaves
                  // lastRouteSplitDistance wherever it last genuinely
                  // reached instead of snapping back toward the start.
                  const key = activeWaypointKeyRef.current;
                  const distance = key ? distanceAlongRouteByKey.get(key) : undefined;
                  if (distance != null) lastRouteSplitDistance = distance;
                }
                // The interpolated split point itself becomes the
                // shared last coordinate of the traveled slice and
                // first coordinate of the remaining slice, so the two
                // lines still join up exactly (rather than leaving a
                // gap or an overlap the width of whatever geometry
                // segment the split happened to fall inside).
                const splitPoint = pointAtDistance(roadLine, roadCumulative, lastRouteSplitDistance);
                const splitLngLat: RouteCoordinate = [splitPoint.lon, splitPoint.lat];
                let splitVertexIndex = 0;
                while (
                  splitVertexIndex < roadCumulative.length &&
                  roadCumulative[splitVertexIndex] < lastRouteSplitDistance
                ) {
                  splitVertexIndex++;
                }
                (mapInstance.getSource("route-traveled") as GeoJSONSource)?.setData(
                  lineFeature([...roadLngLats.slice(0, splitVertexIndex), splitLngLat]),
                );
                (mapInstance.getSource("route-remaining") as GeoJSONSource)?.setData(
                  lineFeature([splitLngLat, ...roadLngLats.slice(splitVertexIndex)]),
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

        syncToModeRef.current();
      }

      // addSource/addLayer (inside resolveAndRedraw above) need the
      // style to have actually finished loading first - markers
      // don't technically require this, but everything is gated
      // behind the same "load" event anyway for one predictable
      // draw order: fetch the cache, then draw everything at once.
      mapInstance.once("load", () => {
        if (cancelledRef()) return;
        void resolveAndRedraw();
        // Only assigned here, once there's a real map this can
        // safely act on (mirrors syncToModeRef's own "no-op until
        // load" shape) - see refreshResolutionRef's own doc comment,
        // RouteMap's own component body, for why anything later
        // needs this at all.
        refreshResolutionRef.current = () => {
          void resolveAndRedraw();
        };

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
