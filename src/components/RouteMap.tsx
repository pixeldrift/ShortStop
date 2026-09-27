"use client";

import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type {
  GeoJSONSource,
  IControl,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import { CompassIcon, PersonSolidIcon } from "./icons";
import { rotationKeyFor, setTurnDiamondRotation, turnDiamondHtml } from "./mapMarkerIcons";
import {
  collapseAttribution,
  installBuildingShadows,
  installSchoolBuildingHighlight,
  PMTILES_ATTRIBUTION,
  PMTILES_URL,
  ROUTE_LINE_OFFSET,
  ROUTE_LINE_WIDTH,
} from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import {
  cumulativeDistances,
  haversineMeters,
  nearestSegmentBearings,
  pointAtDistance,
  roadBearingAt,
} from "@/lib/routeProgress";
import type { LatLon } from "@/lib/routeProgress";
import { MOVING_THRESHOLD_MPS } from "@/lib/useLiveRouteProgress";
import type { RouteCoordinate, RoutingResult } from "@/lib/routing/types";
import { destinationPoint, isSameLocation } from "@/lib/spreadCoincidentPoints";
import type { TripType, TurnDirection } from "@/lib/types";
import { resolveRouteCoordinates } from "@/lib/waypointCache";
import type { WaypointCache } from "@/lib/waypointCache";

/** One "stop" step's marker. `waypointKey` is the *geocoding* cache key
 * (resolveStepCoordinate/resolveRouteCoordinates, waypointCache.ts) - a
 * plain "roadA & roadB" text pair, deliberately shared by every step at
 * the same real corner so they reuse one cached lookup. A loop road
 * (Cedar Park Cir, say) that crosses the same other road (Holland Ridge
 * Dr) at two genuinely different physical corners produces that exact
 * same text twice, for two real, different points - so `waypointKey`
 * must never be used as a map key for a *resolved point*, only handed
 * to the cache lookup itself. `stepId` (this step's own NavigationStep.id
 * - unique and stable for the step's whole lifetime, buildRouteFromRows
 * never reassigning one id to two steps) is what actually looks this
 * marker's point up in the resolved-coordinates map mountMapLibre
 * builds from the `path` prop below - see resolvedByKey's own doc
 * comment for the bug this fixes. `number` is this stop's position
 * among stops (1-indexed) for the pin's on-map label - matching the
 * same numbering RouteProgressBar/StopContent already show for the
 * same stop. */
export type StopMarker = { waypointKey: string; stepId: number; number: number };

/** One "turn" step's marker - `waypointKey`/`stepId` split the same way
 * StopMarker's own do (see its doc comment). `direction`/`heading` are
 * the same step's own NavigationStep fields, fed to turnDiamondHtml
 * (mapMarkerIcons.tsx): a left/right turn draws its own real
 * left.svg/right.svg sign, rotated whole (frame and arrow together) to
 * its own true compass bearing (see applyTurnRotations below), anything
 * else (Proceed, Depart, Arrive, ...) draws its own already-distinct
 * ActionIcon glyph. Route 125's own steps sheet is the only one with
 * real turn-by-turn data today (every 120 route sheet is stops only) -
 * this only ever renders something there, but nothing here is specific
 * to that route. */
export type TurnMarker = {
  waypointKey: string;
  stepId: number;
  direction?: TurnDirection;
  heading?: string;
};

/** One entry of the `path` prop below - a step's own cache key plus its
 * own override, exactly what resolveStepCoordinate/resolveRouteCoordinates
 * (waypointCache.ts) need to resolve it correctly and in the right
 * sequential order, plus `stepId` (StopMarker's own doc comment has why
 * this can't just be `waypointKey` again) for mountMapLibre to key the
 * *result* of that resolution by. */
export type PathPoint = {
  waypointKey: string;
  stepId: number;
  overrideLat: number | null;
  overrideLon: number | null;
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
// A slight, deliberate 3D tilt for driving mode's own camera - enough
// to actually read the newly-extruded buildings (protomapsStyle.ts's
// own "buildings" layer) as real 3D shapes going by rather than flat
// footprints, without tipping so far that the road ahead reads as a
// thin sliver at the top of the screen the way a "real" turn-by-turn
// app's much steeper pitch would. Never applied to overview mode (see
// syncToModeRef's own fitBounds call below, which explicitly resets to
// flat) - a bird's-eye stop-scanning view wants to stay top-down.
const DRIVING_PITCH = 45;
// Mirrors useLiveRouteProgress's own SPEED_SMOOTHING_FIXES window -
// driving mode's own camera-follow (watchPosition below) needs the
// same "is this real movement" answer other GPS-driven features
// (stop-and-go detection, nav prompts) already agree on, not a second,
// slightly different one from a differently-sized window.
const SPEED_SMOOTHING_FIXES = 4;
// Overview mode only shows numbered turn-by-turn detail (every stop's
// own full pin, every turn's own marker) once the admin has zoomed in
// this far past the route's own auto-fit framing - below it, the start
// and end each still get their own full pin, but every stop between
// them is just a plain red dot (drawOverviewPins) - same "full detail
// once you're this close" threshold driving mode's own full pin set
// (drawDrivingPins) reuses as-is once crossed.
const OVERVIEW_DETAIL_ZOOM = 15;

// The road-following route line's own color - deliberately distinct
// from the school/stop pins' own blue (#2563eb, schoolMarkerHtml/
// stopMarkerHtml below) so the line never reads as though it were just
// another pin, especially where one sits right on top of it.
const ROUTE_LINE_COLOR_TRAVELED = "#1d4ed8";
// The remaining dots' own color - a lighter blue than the solid
// traveled line above, not the same shade reused - so the dotted
// ahead-of-us path and the solid behind-us one read as two visibly
// different things at a glance, not just "dashed vs solid" of the
// same color.
const ROUTE_REMAINING_DOT_COLOR = "#60a5fa";
// The remaining path used to be a real "line" layer with a [0, N]
// dasharray - a zero-length dash with a round line-cap draws perfect
// circles instead of dashes, spaced N line-widths apart. That worked
// at rest, but MapLibre renders a dasharray as a texture mapped along
// the line's own direction, which visibly warps under camera transforms
// (a pitch/bearing/zoom animation mid-flight - exactly what driving
// mode's own per-step flyTo does on every advance) into ovals for the
// duration of the animation, only snapping back to round once the
// camera settles. A "circle" layer has no such texture to warp - it's
// drawn as an actual round primitive in screen space (MapLibre's own
// default circle-pitch-alignment: "viewport"), immune to the same
// distortion - so the remaining path is now a plain point source (one
// feature per dot, spaced along the road below) under a circle layer
// instead. ROUTE_REMAINING_DOT_SPACING_METERS is that spacing, in real-
// world meters rather than screen pixels - driving mode's own camera
// sits at STREET_ZOOM for effectively this feature's entire visible
// lifetime (every per-step flyTo above returns it there), so a fixed
// real-world spacing calibrated for that one zoom reads the same as the
// old dasharray's screen-pixel spacing did in practice, without needing
// to regenerate this source on every zoom change the way matching it
// exactly at every zoom would.
const ROUTE_REMAINING_DOT_SPACING_METERS = 6;
// Bumped up from a plain ROUTE_LINE_WIDTH/2 halving (this component's
// own earlier version) so the dots themselves read as a clearly
// bigger, more deliberate dotted line, not just a thinner echo of the
// solid traveled line's own width.
const ROUTE_REMAINING_DOT_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  1.5,
  18,
  4,
];
// A visibly thinner halo than the dot's own radius (unlike the old
// version, which reused ROUTE_REMAINING_DOT_RADIUS itself as the
// stroke width too, making the white outline as thick as the dot's
// own colored center) - the outline should still read as "there's a
// dot here" against a light road surface, not compete with the dot's
// own now-larger, lighter-blue fill for how much of it is actually
// blue.
const ROUTE_REMAINING_DOT_STROKE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  0.5,
  18,
  1.25,
];
// A small perpendicular nudge baked straight into each dot's own
// coordinate, echoing what ROUTE_LINE_OFFSET (mapEngine.ts) does for
// the solid traveled line - a real "line" layer gets that for free from
// MapLibre's own line-offset paint property (still applied to route-
// traveled, unaffected by the dasharray distortion above since it's
// never dashed), but a circle layer has no "circle-offset" of its own
// to lean on, so remainingDotsFeatureCollection (below) computes the
// same rightward nudge manually (destinationPoint,
// spreadCoincidentPoints.ts) instead - without it, a route that doubles
// back over a street it already drove would draw its remaining dots
// directly on top of the solid traveled line from the earlier pass
// rather than beside it. A fixed real-world distance, not an exact
// screen-pixel match to ROUTE_LINE_OFFSET at every zoom - same "close
// enough at driving mode's own fixed STREET_ZOOM" reasoning
// ROUTE_REMAINING_DOT_SPACING_METERS above already leans on.
const ROUTE_REMAINING_DOT_OFFSET_METERS = 2;

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

/** The remaining path's own dots (see ROUTE_REMAINING_DOT_SPACING_METERS'
 * own doc comment above for why this is a point source under a circle
 * layer, not a dashed line) - one Point feature every
 * ROUTE_REMAINING_DOT_SPACING_METERS from `startDistance` (the live
 * traveled/remaining split point) to `totalDistance` (the road's own
 * end), each nudged ROUTE_REMAINING_DOT_OFFSET_METERS to the right of
 * the road's own local bearing there - manually reproducing what
 * line-offset (mapEngine.ts) gives the solid traveled line for free, a
 * circle layer having no such paint property of its own to lean on
 * (both constants' own doc comments above have the full reasoning).
 * `coords`/`cumulative` are the *un-offset* road geometry/its own
 * cumulative distances (roadLine/roadCumulative, this file's own
 * resolveAndRedraw) - the same two updateRouteProgress already threads
 * through pointAtDistance for the split point itself, so this reuses
 * them rather than re-deriving anything. A road with no real bearing at
 * some point along it (roadBearingAt's own null case - the very end of
 * the line, most often) leaves that one dot unoffset rather than
 * skipping it outright; a single dot sitting exactly on the line
 * instead of just beside it is not worth losing over. */
function remainingDotsFeatureCollection(
  coords: LatLon[],
  cumulative: number[],
  startDistance: number,
  totalDistance: number,
) {
  const features: {
    type: "Feature";
    properties: Record<string, never>;
    geometry: { type: "Point"; coordinates: RouteCoordinate };
  }[] = [];
  // Nothing left to show remaining (overview mode's own "the whole line
  // already reads as traveled" case, updateRouteProgress below) rather
  // than one stray dot landing exactly on the route's own end point.
  if (startDistance >= totalDistance) return { type: "FeatureCollection" as const, features };
  for (
    let distance = startDistance;
    distance <= totalDistance;
    distance += ROUTE_REMAINING_DOT_SPACING_METERS
  ) {
    const point = pointAtDistance(coords, cumulative, distance);
    const bearing = roadBearingAt(coords, cumulative, distance, "outgoing");
    const { lat, lon } =
      bearing == null
        ? point
        : destinationPoint(point, bearing + 90, ROUTE_REMAINING_DOT_OFFSET_METERS);
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }
  return { type: "FeatureCollection" as const, features };
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

function stopMarkerHtml(stopNumber: number, checkedOff = false): string {
  // pin.svg's own circular head sits centered at 34.0% of its own
  // height (y=186.18 of a 548-tall viewBox), not 31%. checkedOff
  // (drawDrivingPins, once every real visit to this stop's own corner
  // is behind us - see its own doc comment) swaps in pin-blue.svg -
  // the same shape schoolMarkerHtml already draws from, just still
  // carrying this stop's own number - so a driver can tell "already
  // been there" apart from "still coming up" at a glance, the same
  // red-vs-blue split the rest of the map already uses for stop vs.
  // school.
  return (
    '<div class="relative h-11 w-7">' +
    `<img src="/assets/${checkedOff ? "pin-blue" : "pin"}.svg" class="h-full w-full" alt="" />` +
    '<span class="font-heading absolute top-[34%] left-1/2 -translate-x-1/2 -translate-y-1/2 ' +
    `text-xs font-black ${checkedOff ? "text-blue-700" : "text-red-700"}">` +
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
   * the route's start), keyed by stepId (NavigationStep.id) - the same
   * map this component's own distanceAlongRouteByKey is built from
   * (RoutingResult.waypointDistances, routing/types.ts - straight from
   * the routing provider's own per-leg distances, not a nearest-point
   * search). Keyed by stepId rather than the shared waypointKey cache
   * text for the same reason StopMarker's own doc comment gives - two
   * different steps at two different real corners of a loop road can
   * share that same text, and a Map can only hold one value per key.
   * A snapshot at the moment this callback fires, not a live
   * reference - this component's own copy never changes after its
   * first route-geometry fetch resolves anyway (same "loads once per
   * route" reasoning this whole result already carries), so there's
   * nothing for a caller to miss by holding onto its own copy. */
  waypointDistances: Map<number, number>;
}

// The route's own ordered {lat, lon} sequence - every `path` step that
// resolved in the cache, school spliced in at whichever end `tripType`
// puts it (see `tripType`'s own prop doc) - built once when the cache
// resolves and reused for the road-geometry request, overview mode's
// "fit the whole route" bounds, and driving mode's bearing (below).
// `key` is the step's own stepId for anything that came from `path` -
// null for the school, which is a real leg of the trip but never
// itself an active step a driver can be "at". Deliberately stepId, not
// waypointKey - see StopMarker's own doc comment for why the shared
// cache-key text can't double as a per-step identity here.
type OrderedWaypoint = { key: number | null; lat: number; lon: number };

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
  activeStepId,
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
  /** Every step's own stepId/waypointKey pair (plus its own override, if
   * it has one), in the route's own order (stops and turns both -
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
   * behavior before this prop existed) follows `activeStepId` at
   * street level instead of framing the whole route at once, rotated so
   * the direction of travel always faces up - every stop/turn pin only
   * appears once the map actually arrives there, not the moment driving
   * mode starts (see `activeStepId`'s own doc comment). */
  mode?: "overview" | "driving";
  /** The current step's own stepId (NavigationStep.id) - driving mode
   * only. The map flies to this step's own resolved point (street zoom,
   * rotated to face the next waypoint) whenever it changes, rather than
   * refitting bounds, so advancing through steps feels like following
   * along instead of repeatedly reframing the whole route. Every stop/
   * turn/school pin is held back until the very first of these flights
   * actually arrives, so they appear at street level alongside the
   * driver rather than popping in back at the overview's zoomed-out
   * framing. Ignored in overview mode. Deliberately stepId, not
   * waypointKey - see StopMarker's own doc comment for why the shared
   * cache-key text can't double as a per-step identity here. */
  activeStepId?: number | null;
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
  const activeStepIdRef = useRef(activeStepId);
  useEffect(() => {
    activeStepIdRef.current = activeStepId;
  }, [activeStepId]);
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
  }, [mode, activeStepId]);

  // Same "starts as a no-op, only ever assigned once there's a real map
  // to act on" shape as syncToModeRef above.
  const refreshResolutionRef = useRef<() => void>(() => {});
  // `path` (StepScreen's own routePath, memoized on [route]) changing
  // identity means a step's own resolved coordinate can be different
  // now than when this map last drew it - a waypoint's own coordinate
  // override saved from elsewhere (another admin's own device, mid-
  // trip, say - or any future flow that touches this route's own steps
  // while this same map instance stays mounted) rather than a step
  // advance, which the [mode, activeStepId] effect above already
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
      activeStepIdRef,
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
  activeStepIdRef: React.RefObject<number | null | undefined>;
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
): Promise<{ cache: WaypointCache; resolvedByKey: Map<number, { lat: number; lon: number }> } | null> {
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
  // known second road crossing actually is. Keyed by stepId, not
  // waypointKey (still what resolveRouteCoordinates itself takes, above
  // - that's the shared *cache* key, deliberately reused across two
  // steps at the same real corner): a loop road crossing the same other
  // road at two different real corners (Cedar Park Cir & Holland Ridge
  // Dr, say) produces that exact same "roadA & roadB" text for two
  // genuinely different steps, and a Map can only hold one value per
  // key - keying the *result* by waypointKey the way this used to let
  // the second step's own resolved point silently overwrite the
  // first's, so both ended up sharing one step's coordinate (wrong for
  // whichever one lost the race) in every pin drawn from this map and
  // in the /api/route-geometry request built from it below, even
  // though resolvedList itself (one real, independently-resolved entry
  // per path index, override included) never had this problem at all.
  const schoolAnchor = args.schoolRef.current ?? null;
  const resolvedList = resolveRouteCoordinates(args.pathRef.current, cache, schoolAnchor);
  const resolvedByKey = new Map<number, { lat: number; lon: number }>();
  args.pathRef.current.forEach((point, i) => {
    const resolved = resolvedList[i];
    if (resolved) resolvedByKey.set(point.stepId, resolved);
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
    const resolved = resolvedByKey.get(point.stepId);
    if (!resolved) continue;
    orderedWaypoints.push({ key: point.stepId, lat: resolved.lat, lon: resolved.lon });
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
// replaced already established. Deliberately its own corner
// ("bottom-left", below) rather than stacked under the NavigationControl's
// zoom buttons (top-left) - it's an app-level action (open the rider
// check-in box), not a map-navigation control, so it gets the app's own
// round, blue, glossy button styling (.btn-glossy-blue - same recipe
// every other primary action button in this app uses, globals.css)
// instead of MapLibre's own flat gray control chrome, keeping the two
// kinds of button visually distinct at a glance. No "maplibregl-ctrl-
// group" wrapper (that's what draws MapLibre's own boxy white grouped-
// control background) - just "maplibregl-ctrl" for corner positioning,
// with the button itself supplying its whole look. This doesn't track
// its own visible/hidden state, it just calls back out to StepScreen's
// own toggleRosterManually on every tap, which already knows whether the
// box is currently open.
class ShowRidersControl implements IControl {
  private button?: HTMLButtonElement;

  constructor(private readonly onClick: () => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl m-2";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Show riders");
    button.className =
      "btn-glossy-blue flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg";
    button.innerHTML = renderToStaticMarkup(
      <PersonSolidIcon className="h-5 w-5" />,
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

// Recenters the camera on the driver's own live GPS position (the same
// "you are here" dot the geolocation watchPosition below maintains),
// for whenever a driver has panned/zoomed the map away from their own
// position (e.g. scouting ahead) and wants back. Top-right, styled to
// match ExpandableMap's own expand button (btn-glossy-light, the same
// h-8 w-8 rounded-lg bg-white/90 square, not a round blue glossy one) -
// a plain map-navigation control, same footing as MapLibre's own
// NavigationControl, not an app-level action button the way
// ShowRidersControl's own round blue glossy style deliberately reads
// (that control's own doc comment above has why) - keeping the two
// visually distinct is the point. mt-12 (rather than the usual m-2
// every other corner's own first control uses) leaves room below
// ExpandableMap's own expand button, which sits in this exact same
// physical corner as a plain absolutely-positioned sibling of this
// map, entirely outside MapLibre's own control-corner layout - the two
// have no way to coordinate with each other automatically, so this
// control's own margin is what actually keeps them from overlapping.
// Present on every mount (StartScreen's overview map included, not
// just driving) since "where am I right now" is just as useful while
// reviewing a route beforehand as it is mid-drive - unlike
// ShowRidersControl, there's no caller-supplied prop this could be
// gated on, and mode itself changes live within one mount so it isn't
// a usable gate either. A tap before the first GPS fix ever arrives is
// simply a no-op (getOwnLocation, below, has nothing to fly to yet).
class RecenterControl implements IControl {
  private button?: HTMLButtonElement;

  constructor(private readonly onClick: () => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl mt-12 mr-2";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Jump to current location");
    button.className =
      "btn-glossy-light flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-zinc-900";
    button.innerHTML = renderToStaticMarkup(
      <CompassIcon className="h-4 w-4" />,
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
    activeStepIdRef,
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
  const distanceAlongRouteByKey = new Map<number, number>();
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
  let resolvedByKey = new Map<number, { lat: number; lon: number }>();
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
        // Driving mode starts pitched from the very first paint, not
        // just once the first per-step flyTo/easeTo (below) eventually
        // applies DRIVING_PITCH - otherwise a driving-mode mount would
        // render dead flat for one visible beat before its first camera
        // move ever fires.
        pitch: modeRef.current === "driving" ? DRIVING_PITCH : 0,
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
      // Declared up here (rather than right beside the watchPosition
      // call that actually populates it, further down) so RecenterControl's
      // own click handler, wired below, can close over the same binding -
      // both are just two different readers/writers of "where's the blue
      // dot right now."
      let locationMarker: MapLibreMarker | undefined;
      // Whether the live GPS fix (watchPosition below) currently reads
      // as real movement, not just noise while parked - read by
      // syncToModeRef's own driving-mode branch (below) to decide
      // whether *it* or the continuous GPS-follow camera (also below)
      // owns the camera for this update. Declared here, alongside
      // locationMarker, since both are written by the same
      // watchPosition callback and read by syncToModeRef - one
      // long-lived closure's worth of "what's the live fix doing right
      // now."
      let isMoving = false;
      let smoothedSpeedMps: number | null = null;
      const recentFixes: { point: LatLon; atMs: number }[] = [];
      mapInstance.on("rotate", applyTurnRotations);
      // schoolRef already stays current on its own (this component's
      // own sync effect, above) - the highlight just needs to be told
      // where to look once, self-maintains from there (see its own doc
      // comment, mapEngine.ts). Safe to install before "load" - it never
      // reads the style itself, only queries already-rendered features
      // lazily inside its own "idle" listener.
      installSchoolBuildingHighlight(mapInstance, schoolRef);
      // showCompass: false - bearing here is driven programmatically
      // (direction of travel in driving mode), not something a driver
      // touches, so the compass puck would just be dead weight.
      mapInstance.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-left",
      );
      // Its own corner (bottom-left) - see ShowRidersControl's own doc
      // comment above for why this deliberately doesn't stack under the
      // NavigationControl's zoom buttons the way a same-corner control
      // would. Only for callers that actually passed onToggleRoster
      // (StepScreen, when this route has any rider-tracked stop) -
      // StartScreen's overview map gets no button at all rather than a
      // dead one.
      if (onToggleRosterRef.current) {
        mapInstance.addControl(
          new ShowRidersControl(() => onToggleRosterRef.current?.()),
          "bottom-left",
        );
      }
      // See RecenterControl's own doc comment (above) for why this is
      // unconditional (every mount, not just callers with a roster
      // toggle) and its own corner. No bearing/pitch here - just pan/
      // zoom back to the live fix, so this doesn't fight whatever
      // camera orientation driving mode's own per-step flyTo/easeTo
      // already has going.
      mapInstance.addControl(
        new RecenterControl(() => {
          const lngLat = locationMarker?.getLngLat();
          if (!lngLat) return;
          mapInstance.flyTo({
            center: lngLat,
            zoom: STREET_ZOOM,
            duration: DRIVING_FLY_DURATION_MS,
          });
        }),
        "top-right",
      );

      // drawOverviewPins/drawDrivingPins/syncToModeRef, defined once
      // here rather than inside resolveAndRedraw below (which can run
      // again later, on a genuine `path` change - refreshResolutionRef's
      // own doc comment, RouteMap's own component body, has why) - all
      // three close over resolvedByKey/latestRoadGeometry/
      // distanceAlongRouteByKey as the outer mutables they now are (see
      // each one's own doc comment above), so a long-lived caller (the
      // "zoomend" listener below, or the [mode, activeStepId]
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
          const stop = stopsRef.current.find((s) => s.stepId === point.key);
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
          const stop = stopsRef.current.find((s) => s.stepId === point.key);
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
        // Every real waypoint's own position in the route's actual
        // trip order - orderedWaypointsRef.current is already built in
        // that order (fetchCacheAndBuildOrderedWaypoints's own doc
        // comment above), so its array index doubles as "how far
        // along the trip is this stepId" for the passed/upcoming split
        // below.
        const orderByStepId = new Map<number, number>();
        orderedWaypointsRef.current.forEach((waypoint, i) => {
          if (waypoint.key != null) orderByStepId.set(waypoint.key, i);
        });
        const currentStepId = activeStepIdRef.current;
        const currentOrder = currentStepId != null ? (orderByStepId.get(currentStepId) ?? -1) : -1;

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
            .map((turn) => turn.stepId),
        );
        const bearingByKey = new Map<number, number | null>();
        orderedWaypointsRef.current.forEach((waypoint) => {
          if (waypoint.key == null) return;
          const distance = distanceAlongRouteByKey.get(waypoint.key);
          if (distance == null) return;
          const direction = rotatableKeys.has(waypoint.key) ? "outgoing" : "incoming";
          bearingByKey.set(waypoint.key, roadBearingAt(roadLine, roadCumulative, distance, direction));
        });

        // One shared pool of every real (resolved) stop and turn -
        // deliberately mixed, not each kind grouped separately, since
        // a stop and a turn can themselves share one real corner (a
        // route that stops right where it also turns), and the
        // dedup below needs to see every real visit to a corner
        // together to pick just one of them, whichever kind it is.
        type Entry =
          | { kind: "stop"; stop: StopMarker; point: { lat: number; lon: number }; order: number }
          | { kind: "turn"; turn: TurnMarker; point: { lat: number; lon: number }; order: number };
        const entries: Entry[] = [];
        for (const stop of stopsRef.current) {
          const point = resolvedByKey.get(stop.stepId);
          if (!point) continue;
          entries.push({ kind: "stop", stop, point, order: orderByStepId.get(stop.stepId) ?? -1 });
        }
        for (const turn of turnsRef.current) {
          const point = resolvedByKey.get(turn.stepId);
          if (!point) continue;
          entries.push({ kind: "turn", turn, point, order: orderByStepId.get(turn.stepId) ?? -1 });
        }

        // Greedy same-corner clustering (isSameLocation's own ~30m
        // box check - spreadCoincidentPoints.ts) - a route revisiting
        // one real intersection at two different points in its own
        // trip (a double-back, or a stop and a turn that happen to
        // share a corner) resolves both to (nearly) the same point,
        // and only one of them should ever draw here at once (see the
        // per-group pick below) - stacking every real visit in route
        // order, the old behavior, just buried everything under
        // whichever one happened to draw last.
        const groupOf = new Array<number>(entries.length).fill(-1);
        const groups: number[][] = [];
        for (let i = 0; i < entries.length; i++) {
          if (groupOf[i] !== -1) continue;
          const group = [i];
          groupOf[i] = groups.length;
          for (let j = i + 1; j < entries.length; j++) {
            if (groupOf[j] === -1 && isSameLocation(entries[i].point, entries[j].point)) {
              group.push(j);
              groupOf[j] = groups.length;
            }
          }
          groups.push(group);
        }

        for (const group of groups) {
          const sorted = [...group].sort((a, b) => entries[a].order - entries[b].order);
          // Whichever real visit to this corner is current or still
          // ahead of us, earliest first - "stop one" the first time
          // through, then "stop five" once we're back for a second
          // pass, never both stacked at once (see this function's own
          // doc comment above).
          const upcoming = sorted.find((i) => entries[i].order >= currentOrder);
          let entry: Entry;
          let checkedOff = false;
          if (upcoming != null) {
            entry = entries[upcoming];
          } else {
            // Every real visit to this corner is already behind us -
            // the most recent one, if it was a stop, still gets its
            // own blue "already been here" pin (stopMarkerHtml's own
            // checkedOff styling); a turn has nothing left to say once
            // passed (see the turn branch below), so a corner whose
            // last visit was a turn draws nothing at all here.
            const lastStop = [...sorted].reverse().find((i) => entries[i].kind === "stop");
            if (lastStop == null) continue;
            entry = entries[lastStop];
            checkedOff = true;
          }
          if (entry.kind === "turn") {
            const { turn } = entry;
            const html = turnDiamondHtml(TURN_DIAMOND_SIZE, turn.direction, turn.heading);
            if (!html) continue;
            const element = elementFromHtml(html);
            const rotationKey = rotationKeyFor(turn.direction, turn.heading);
            if (rotationKey != null) {
              turnArrowRotations.push({
                element,
                rotationKey,
                bearing: bearingByKey.get(turn.stepId) ?? null,
              });
            }
            pins.push(
              new maplibregl.Marker({ element, anchor: "center" })
                .setLngLat(toLngLat(entry.point))
                .addTo(mapInstance),
            );
          } else {
            pins.push(
              new maplibregl.Marker({
                element: elementFromHtml(stopMarkerHtml(entry.stop.number, checkedOff)),
                anchor: "bottom",
              })
                .setLngLat(toLngLat(entry.point))
                .addTo(mapInstance),
            );
          }
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
          // Fit to every real route waypoint (stops and turns alike,
          // key !== null) but not the school (key === null -
          // fetchCacheAndBuildOrderedWaypoints's own doc comment above
          // has why it's keyed that way) - a school sitting much
          // farther out than the rest of the route otherwise forces the
          // whole overview out to a zoom level where the stops
          // themselves are too close together to read, for a school
          // that isn't even part of what a driver needs to glance at
          // here. Falls back to every waypoint, school included, on the
          // rare route with nothing else resolved yet.
          const withoutSchool = orderedWaypointsRef.current.filter((w) => w.key !== null);
          const fitTargets = withoutSchool.length > 0 ? withoutSchool : orderedWaypointsRef.current;
          if (fitTargets.length > 0) {
            const lons = fitTargets.map((w) => w.lon);
            const lats = fitTargets.map((w) => w.lat);
            mapInstance.fitBounds(
              [
                [Math.min(...lons), Math.min(...lats)],
                [Math.max(...lons), Math.max(...lats)],
              ],
              // pitch explicitly flat - overview mode always wants a
              // top-down read of the whole route, not whatever tilt
              // driving mode's own DRIVING_PITCH left the camera at if
              // this same map instance was ever in that mode before.
              { padding: 40, maxZoom: 16, pitch: 0 },
            );
          }
          return;
        }

        applyRouteProgress?.();
        const stepId = activeStepIdRef.current;
        const point = stepId != null ? resolvedByKey.get(stepId) : undefined;
        const roadLine = latestRoadGeometry.map(([lon, lat]) => ({ lat, lon }));
        const activeDistance = stepId != null ? (distanceAlongRouteByKey.get(stepId) ?? null) : null;
        const bearing = bearingAt(roadLine, cumulativeDistances(roadLine), activeDistance);
        if (!drivingPinsRevealedRef.current) {
          if (isMoving || !point) {
            // While actually moving, the continuous GPS-follow camera
            // (watchPosition below) already keeps up in real time -
            // there's no flyTo here to wait a moveend on, so reveal
            // right away instead of waiting on a motion this step is
            // skipping (see the isMoving return, just below).
            drawDrivingPins();
            drivingPinsRevealedRef.current = true;
          } else {
            mapInstance.once("moveend", () => {
              drawDrivingPins();
              drivingPinsRevealedRef.current = true;
            });
          }
        } else {
          // Pins are already showing - still redraw on every step
          // advance now (not just this first reveal), since
          // drawDrivingPins's own dedup (its own doc comment) reads
          // activeStepIdRef to decide which real visit to a shared
          // corner is current, which one's already behind us and
          // gets checked off blue, and which passed turn to drop -
          // an advance no-op here would leave all three stuck at
          // whatever they were the moment the pins first appeared.
          drawDrivingPins();
        }
        if (isMoving) {
          // The live GPS fix already owns the camera while moving (see
          // watchPosition below) - flying to this step's own static
          // waypoint here on every GPS-driven advance would just fight
          // it. Only a stationary review (manual step taps at a stop,
          // or no GPS fix at all) wants this flyTo.
          return;
        }
        if (!point) {
          // No coordinate to fly to yet - still rotate on its own,
          // animated the same 1s as every other camera move here,
          // rather than leaving bearing stuck at whatever it last
          // was until a real flyTo eventually comes along.
          if (bearing != null) {
            mapInstance.easeTo({ bearing, pitch: DRIVING_PITCH, duration: DRIVING_FLY_DURATION_MS });
          }
          return;
        }
        // bearing folded straight into this flyTo (MapLibre
        // interpolates position and bearing together over one
        // duration) rather than a separate setBearing call - one
        // motion, not a fast position flight with an instantly
        // snapped, separately-timed spin.
        mapInstance.flyTo({
          center: toLngLat(point),
          zoom: STREET_ZOOM,
          pitch: DRIVING_PITCH,
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

        // syncToModeRef's own driving branch already redraws pins on
        // every step advance now (not just their first reveal - see
        // its own doc comment), but a genuine `path` change lands here
        // independently of any step advance, so this route's own pins
        // - including one whose coordinate just moved - still need
        // their own explicit redraw right away, not a wait for
        // whatever step advance happens to come next.
        if (modeRef.current === "driving" && drivingPinsRevealedRef.current) {
          drawDrivingPins();
        }

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

              // A circle layer over a point source ("route-remaining-
              // dots" - see ROUTE_REMAINING_DOT_SPACING_METERS' own doc
              // comment above for why a circle layer rather than a
              // dashed line), plus a solid traveled line (its own
              // "route-traveled" source) on top of it, both sharing
              // ROUTE_LINE_COLOR_TRAVELED - so the line itself shows how
              // far the route has actually been driven, not just that
              // it exists. Both sources start empty; updateRouteProgress
              // below (called once immediately, and again on every step
              // advance) is what actually splits roadLngLats between
              // them. beforeId (every layer) places them directly under
              // the road-name labels (added earlier, in
              // protomapsStyle.ts's own layer list) so street names stay
              // legible over the route instead of the line painting
              // over them - addLayer with no beforeId would otherwise
              // stack this on top of literally everything already in
              // the style, labels included. Guarded by routeLayersAdded
              // (above) since a second resolveAndRedraw finds both
              // sources already there - only the traveled/remaining
              // split itself (updateRouteProgress, below) needs to run
              // again, not this one-time setup.
              if (!routeLayersAdded) {
                mapInstance.addSource("route-remaining-dots", {
                  type: "geojson",
                  data: remainingDotsFeatureCollection([], [], 0, 0),
                });
                mapInstance.addSource("route-traveled", {
                  type: "geojson",
                  data: lineFeature([]),
                });
                mapInstance.addLayer(
                  {
                    id: "route-remaining-dots",
                    type: "circle",
                    source: "route-remaining-dots",
                    paint: {
                      "circle-color": ROUTE_REMAINING_DOT_COLOR,
                      "circle-radius": ROUTE_REMAINING_DOT_RADIUS,
                      "circle-stroke-color": "#ffffff",
                      "circle-stroke-width": ROUTE_REMAINING_DOT_STROKE_WIDTH,
                      "circle-opacity": 0.85,
                      "circle-stroke-opacity": 0.85,
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
              // `.then`, in RouteMap's own [mode, activeStepId]
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
                  // `!= null`, not a bare truthy check - stepId 0 (the
                  // route's own first step) is falsy but still a real,
                  // valid id to look up.
                  const stepId = activeStepIdRef.current;
                  const distance = stepId != null ? distanceAlongRouteByKey.get(stepId) : undefined;
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
                (mapInstance.getSource("route-remaining-dots") as GeoJSONSource)?.setData(
                  remainingDotsFeatureCollection(
                    roadLine,
                    roadCumulative,
                    lastRouteSplitDistance,
                    roadTotalDistance,
                  ),
                );
              }
              applyRouteProgress = updateRouteProgress;
              updateRouteProgress();
              // Second call, same as the one right after resolvedByKey
              // itself updates above - this route's own fresh road
              // geometry just landed, so any pin whose own turn-sign
              // bearing reads off latestRoadGeometry gets a chance to
              // correct itself too, not just its raw lat/lon.
              if (modeRef.current === "driving" && drivingPinsRevealedRef.current) {
                drawDrivingPins();
              }

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
        // Needs the style's own "buildings"/"roads-minor" layers to
        // already exist (installBuildingShadows's own doc comment,
        // mapEngine.ts) - unlike installSchoolBuildingHighlight above,
        // which only ever touches its own separate layer/source, so it
        // doesn't need to wait for this same event.
        installBuildingShadows(mapInstance);
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

          // Same coords.speed-or-distance/time blend useLiveRouteProgress's
          // own speedMps uses (see its own doc comment) - driving mode's
          // camera-follow below needs the same "is this real movement"
          // answer every other GPS-driven feature in the app already
          // agrees on, not a second, slightly different one computed here.
          const fixPoint: LatLon = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          };
          recentFixes.push({ point: fixPoint, atMs: position.timestamp });
          while (recentFixes.length > SPEED_SMOOTHING_FIXES) recentFixes.shift();
          const instantSpeed =
            typeof position.coords.speed === "number" && position.coords.speed >= 0
              ? position.coords.speed
              : recentFixes.length >= 2
                ? (() => {
                    const first = recentFixes[0];
                    const last = recentFixes[recentFixes.length - 1];
                    const elapsedSec = (last.atMs - first.atMs) / 1000;
                    return elapsedSec > 0
                      ? haversineMeters(first.point, last.point) / elapsedSec
                      : null;
                  })()
                : null;
          if (instantSpeed != null) {
            smoothedSpeedMps =
              smoothedSpeedMps == null ? instantSpeed : smoothedSpeedMps * 0.5 + instantSpeed * 0.5;
            isMoving = smoothedSpeedMps >= MOVING_THRESHOLD_MPS;
          }

          // Continuous GPS-follow: while actually moving in driving
          // mode, the live fix itself owns the camera every update
          // (syncToModeRef's own driving branch, above, stands down and
          // leaves this alone whenever isMoving is true) - manually
          // stepping through stops, or reviewing with no GPS at all,
          // still gets that per-step flyTo instead. offset positions
          // the live fix toward the lower quarter of the screen (a
          // positive y offset shifts the tracked point down from
          // center - MapLibre's own handleEaseTo places `center` at
          // `containerCenter + offset` on screen, not at `center`
          // itself) rather than dead center, so more of the road ahead
          // stays visible than behind. Real device heading (not the
          // route-geometry bearing driving mode's own per-step flyTo
          // uses) while actually moving - that's the whole point of
          // "follow the live GPS."
          if (modeRef.current === "driving" && isMoving) {
            const heading = position.coords.heading;
            mapInstance.easeTo({
              center: lngLat,
              zoom: STREET_ZOOM,
              pitch: DRIVING_PITCH,
              offset: [0, mapInstance.getContainer().clientHeight / 4],
              ...(typeof heading === "number" && !Number.isNaN(heading) ? { bearing: heading } : {}),
              duration: DRIVING_FLY_DURATION_MS,
            });
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
