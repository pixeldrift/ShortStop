"use client";

import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as LeafletMap, LayerGroup, Marker } from "leaflet";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { ActionIcon } from "./icons";
import { PMTILES_URL, resolveMapEngine } from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import type { RoutingResult } from "@/lib/routing/types";
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
// town" starting view. [lat, lon] (Leaflet order) - mountMapLibre's own
// toLngLat flips it where MapLibre needs [lon, lat] instead.
export const LA_VERGNE_CENTER: [number, number] = [36.0134, -86.5581];
const DEFAULT_ZOOM = 13;
// Roughly "which side of the street" zoom - what driving mode flies to
// for the current step, once its own coordinates are known.
const STREET_ZOOM = 17;

// CARTO's free Voyager basemap rather than tile.openstreetmap.org
// directly: same OSM data underneath (styled to look close to the
// standard OSM look), but it actually serves a `{r}` (@2x) retina
// tile variant - openstreetmap.org's own tile server doesn't, so
// `detectRetina` below would be a no-op against it and every tile
// would render soft/blurry on any retina display. This used to need no
// API key at all for this volume of use - CARTO has since started
// gating anonymous access (tiles come back watermarked "API KEY
// REQUIRED" instead of failing outright, easy to miss until someone
// actually looks at the map), so a real `NEXT_PUBLIC_CARTO_API_KEY` is
// appended as CARTO's own documented `api_key` query param whenever
// one is configured. `NEXT_PUBLIC_` (not server-only, unlike
// ORS_API_KEY) because Leaflet fetches these tiles directly from the
// browser, never through a server route of this app's own - same
// public-but-domain/rate-limited model any map tile provider's own
// client-side key uses, not a secret that needs hiding.
//
// This is the fallback path's own tile source - resolveMapEngine()
// (mapEngine.ts) prefers the self-hosted MapLibre/PMTiles path
// (mountMapLibre below) whenever it's actually available, so this only
// ever runs for a browser without WebGL or a deployment that hasn't
// generated/placed a PMTiles file yet (see mapEngine.ts's own doc
// comment for exactly how to do that).
export const TILE_URL = process.env.NEXT_PUBLIC_CARTO_API_KEY
  ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${process.env.NEXT_PUBLIC_CARTO_API_KEY}`
  : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
export const TILE_SUBDOMAINS = "abcd";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

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
// as a raw SVG string here since Leaflet's divIcon takes an HTML string,
// not a React component.
function schoolMarkerHtml(): string {
  return (
    '<svg viewBox="0 0 24 24" width="32" height="32" fill="#2563eb" ' +
    'style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45))" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />' +
    "</svg>"
  );
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

// Driving mode's own "which way is the bus facing" - the bearing
// toward the NEXT waypoint after the active one, so the map faces where
// the bus is about to go, falling back to the bearing FROM the previous
// waypoint at the route's own last stop, where there's no "next" to
// face. Null if there's nothing to compute a direction from (the active
// key isn't in `ordered`, or it's the route's only waypoint).
function bearingAt(
  ordered: OrderedWaypoint[],
  activeWaypointKey: string | null | undefined,
): number | null {
  if (!activeWaypointKey) return null;
  const index = ordered.findIndex((w) => w.key === activeWaypointKey);
  if (index === -1) return null;
  if (index + 1 < ordered.length)
    return initialBearing(ordered[index], ordered[index + 1]);
  if (index - 1 >= 0) return initialBearing(ordered[index - 1], ordered[index]);
  return null;
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
 * Two interchangeable renderers share every one of those behaviors -
 * resolveMapEngine() (mapEngine.ts) decides once, on mount, which one
 * this component actually uses:
 *   - mountMapLibre: self-hosted vector tiles (MapLibre GL + PMTiles),
 *     the preferred path wherever it can actually work.
 *   - mountLeaflet: the original CARTO raster-tile Leaflet map - kept
 *     exactly as it always was, as the automatic fallback for a browser
 *     without WebGL, or a deployment that hasn't generated/placed a
 *     PMTiles file yet.
 * Both are dynamically imported inside their own mount function, not at
 * module top level - each package touches `window` as soon as it's
 * evaluated, which would run during Next's server-side render pass for
 * this "use client" component's initial HTML (client components still
 * get one SSR pass for their first paint) and throw "window is not
 * defined" there. The CSS imports above are fine at the top level even
 * so - just style rules, nothing that touches `window`.
 */
export function RouteMap({
  className,
  stops = [],
  turns = [],
  path = [],
  school,
  tripType,
  waypointsUrl,
  mode = "driving",
  activeWaypointKey,
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
   * road-geometry request below at whichever end of `path` `tripType`
   * says it actually belongs. */
  school?: { lat: number; lon: number } | null;
  /** Which end of `path` the school (above) actually belongs at when
   * building the road-geometry request - a dropoff route starts at the
   * school (school first), a pickup route ends there (school last),
   * matching AllStopsModal's own identical dropoff-first/pickup-last
   * convention for the same reason (StartScreen.tsx). Only meaningful
   * alongside `school`; ignored if that's omitted. */
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Populated once the mount effect below actually creates the map/
  // resolves the waypoint cache - only ever the Leaflet instance (the
  // MapLibre path keeps its own map reference local to its own mount
  // function's closure instead) - nothing outside this component reads
  // it today; kept for parity with how it's always worked here.
  const mapRef = useRef<LeafletMap | null>(null);
  const cacheRef = useRef<WaypointCache | null>(null);
  const orderedWaypointsRef = useRef<OrderedWaypoint[]>([]);
  // The one layer every stop/turn/school pin (or overview's single
  // starting pin) lives in - letting a mode switch swap what's shown by
  // clearing and redrawing this one group, rather than tracking every
  // individual marker it ever added. Leaflet-only - mountMapLibre's own
  // pin bookkeeping (a plain array of maplibregl.Marker instances) stays
  // local to its own closure instead, since MapLibre has no built-in
  // layer-group equivalent to hold a ref to.
  const pinsGroupRef = useRef<LayerGroup | null>(null);
  // Driving mode's full pin set is drawn exactly once, the first time
  // the map actually arrives somewhere (see syncToModeRef below) - this
  // is what "exactly once" is checked against, so later step advances
  // don't redraw (and briefly re-flash) pins that are already showing.
  // Shared by both renderers.
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

  // Assigned once the mount effect below has a map/cache to work with -
  // brings the current mode/active step's camera (and, in driving mode,
  // pins + bearing) up to date. Called once right after that assignment
  // (the very first sync), and again by the small effect just below on
  // every later mode/step change - see its own comment. Whichever
  // renderer actually mounted (mountMapLibre or mountLeaflet) is the one
  // that assigns this, using its own native camera/marker APIs - this
  // ref is how the outer component stays entirely renderer-agnostic.
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
    let cleanup: (() => void) | undefined;

    void resolveMapEngine().then((engine) => {
      if (cancelled) return;
      cleanup =
        engine === "maplibre"
          ? mountMapLibre({
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
              tripTypeRef,
              waypointsUrlRef,
              modeRef,
              activeWaypointKeyRef,
            })
          : mountLeaflet({
              container,
              cancelledRef: () => cancelled,
              mapRef,
              cacheRef,
              orderedWaypointsRef,
              pinsGroupRef,
              drivingPinsRevealedRef,
              syncToModeRef,
              stopsRef,
              turnsRef,
              pathRef,
              schoolRef,
              tripTypeRef,
              waypointsUrlRef,
              modeRef,
              activeWaypointKeyRef,
            });
    });

    return () => {
      cancelled = true;
      cleanup?.();
      cacheRef.current = null;
      orderedWaypointsRef.current = [];
      drivingPinsRevealedRef.current = false;
      syncToModeRef.current = () => {};
    };
  }, []);

  return <div ref={containerRef} className={className} />;
}

// Every ref both mount functions below share - the whole point of
// pulling this out as its own type is so the two functions' own
// signatures visibly take "the same bag of shared state," rather than
// nine positional params each that happen to need to stay in the same
// order between them.
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
  tripTypeRef: React.RefObject<TripType | undefined>;
  waypointsUrlRef: React.RefObject<string>;
  modeRef: React.RefObject<"overview" | "driving">;
  activeWaypointKeyRef: React.RefObject<string | null | undefined>;
}

// Shared by both renderers - the cache fetch, road-geometry fetch, and
// ordered-waypoint derivation are pure data steps with nothing
// engine-specific in them at all; only what happens with the result
// (drawing pins/lines, framing the camera) differs per renderer.
async function fetchCacheAndBuildOrderedWaypoints(
  args: Pick<
    MountArgs,
    | "waypointsUrlRef"
    | "schoolRef"
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

  const orderedWaypoints: OrderedWaypoint[] = [];
  if (args.schoolRef.current && args.tripTypeRef.current === "dropoff") {
    orderedWaypoints.push({
      key: null,
      lat: args.schoolRef.current.lat,
      lon: args.schoolRef.current.lon,
    });
  }
  for (const key of args.pathRef.current) {
    const entry = cache[key];
    if (!entry || entry.status !== "ok") continue;
    orderedWaypoints.push({ key, lat: entry.lat, lon: entry.lon });
  }
  if (args.schoolRef.current && args.tripTypeRef.current !== "dropoff") {
    orderedWaypoints.push({
      key: null,
      lat: args.schoolRef.current.lat,
      lon: args.schoolRef.current.lon,
    });
  }
  args.orderedWaypointsRef.current = orderedWaypoints;
  return cache;
}

// ---------------------------------------------------------------------
// Leaflet + CARTO raster tiles - the original renderer, unchanged from
// before mountMapLibre existed. The automatic fallback whenever
// resolveMapEngine() (mapEngine.ts) can't use MapLibre.
// ---------------------------------------------------------------------
function mountLeaflet(
  args: MountArgs & {
    mapRef: React.RefObject<LeafletMap | null>;
    pinsGroupRef: React.RefObject<LayerGroup | null>;
  },
): () => void {
  const {
    container,
    cancelledRef,
    mapRef,
    cacheRef,
    orderedWaypointsRef,
    pinsGroupRef,
    drivingPinsRevealedRef,
    syncToModeRef,
    stopsRef,
    turnsRef,
    pathRef,
    schoolRef,
    tripTypeRef,
    waypointsUrlRef,
    modeRef,
    activeWaypointKeyRef,
  } = args;

  let map: LeafletMap | undefined;
  let watchId: number | undefined;

  void import("leaflet").then((L) =>
    // Side-effect only (patches L.Map to add rotation) - must resolve
    // before L.map() below so `rotate`/`bearing` are real options and
    // `setBearing` exists on the instance it creates.
    import("leaflet-rotate").then(() => {
      // The effect's cleanup can fire before this promise resolves
      // (e.g. React StrictMode's dev-only mount/unmount/remount) -
      // bail rather than initializing a map nothing will ever clean up.
      if (cancelledRef()) return;
      map = L.map(container, {
        center: LA_VERGNE_CENTER,
        zoom: DEFAULT_ZOOM,
        rotate: true,
        bearing: 0,
        // The plugin's own compass-dial widget - off since bearing is
        // driven programmatically (direction of travel) here, not by
        // a control the driver would touch.
        rotateControl: false,
      });
      mapRef.current = map;
      L.tileLayer(TILE_URL, {
        maxZoom: 20,
        subdomains: TILE_SUBDOMAINS,
        attribution: TILE_ATTRIBUTION,
        detectRetina: true,
      }).addTo(map);
      const pinsGroup = L.layerGroup().addTo(map);
      pinsGroupRef.current = pinsGroup;

      // A 404 (the common case right now - see the `stops` prop doc
      // above) resolves to {} rather than rejecting, same as any other
      // fetch/parse failure via the .catch below - either way, that
      // just means every stop below is a no-op cache miss, not an
      // error worth surfacing over a map that's otherwise working fine.
      void fetchCacheAndBuildOrderedWaypoints({
        waypointsUrlRef,
        schoolRef,
        tripTypeRef,
        pathRef,
        cacheRef,
        orderedWaypointsRef,
        cancelledRef,
      }).then((resolvedCache) => {
        if (cancelledRef() || !map || !resolvedCache) return;
        // A plain re-binding, not just a rename - `cache` genuinely has
        // type WaypointCache (not WaypointCache | null) from here on,
        // rather than merely being narrowed to it, so every nested
        // function below (drawOverviewPin/drawDrivingPins, called later
        // from syncToModeRef, well after this closure itself returns)
        // sees that same non-null type too. A narrowing of the
        // original parameter wouldn't carry into those - TS only
        // narrows a closed-over binding into a nested function when the
        // binding's own declared type already rules out the null case.
        const cache = resolvedCache;

        // The road-following line itself - a real routed path, not a
        // connect-the-dots line through the cache's own points (see
        // this component's own doc comment on `path` for why that
        // changed). A request/response failure (no ORS key
        // configured, a real ORS error, a network blip) just means
        // no line draws at all - same "quietly do without it"
        // fallback every other cache/fetch failure on this map
        // already gets, never a fabricated straight line standing
        // in for it.
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
            .then((res): Promise<RoutingResult> | null =>
              res.ok ? res.json() : null,
            )
            .then((result) => {
              if (cancelledRef() || !map || !result) return;
              const roadLatLngs: [number, number][] =
                result.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
              L.polyline(roadLatLngs, {
                color: "#2563eb",
                weight: 4,
                opacity: 0.7,
                lineJoin: "round",
                interactive: false,
              }).addTo(map);
              // The road can bow out well past a straight line
              // between waypoints (a river crossing, a one-way
              // detour) - once the actual road geometry is in, it's
              // a tighter, truer "fit the whole route" frame than
              // the raw waypoint dots the map was fit to below
              // while this was loading.
              if (modeRef.current === "overview" && roadLatLngs.length > 0) {
                map.fitBounds(L.latLngBounds(roadLatLngs), {
                  padding: [40, 40],
                  maxZoom: 16,
                });
              }
            })
            .catch((err) =>
              console.warn("Couldn't fetch route geometry:", err),
            );
        }

        // Just one pin marking where the route begins - every
        // individual stop/turn pin is deliberately left off this
        // zoomed-out view (see this component's own `mode` doc
        // comment). clearLayers() first makes this safe to call
        // more than once (syncToModeRef can fire again before mode
        // ever actually changes).
        function drawOverviewPin() {
          pinsGroup.clearLayers();
          if (schoolRef.current && tripTypeRef.current === "dropoff") {
            const latLng: [number, number] = [
              schoolRef.current.lat,
              schoolRef.current.lon,
            ];
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html: schoolMarkerHtml(),
                iconSize: [32, 32],
                iconAnchor: [16, 30],
              }),
              interactive: false,
            }).addTo(pinsGroup);
            return;
          }
          const firstStop = stopsRef.current.find(
            (s) => cache[s.waypointKey]?.status === "ok",
          );
          const entry = firstStop && cache[firstStop.waypointKey];
          if (firstStop && entry && entry.status === "ok") {
            const latLng: [number, number] = [entry.lat, entry.lon];
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html: stopMarkerHtml(firstStop.number),
                iconSize: [28, 44],
                iconAnchor: [14, 44],
              }),
              interactive: false,
            }).addTo(pinsGroup);
          }
        }

        // Every stop/turn/school pin - driving mode's full picture,
        // drawn once the map has actually arrived somewhere (see
        // syncToModeRef below), not the instant driving mode starts.
        function drawDrivingPins() {
          pinsGroup.clearLayers();
          for (const stop of stopsRef.current) {
            const entry = cache[stop.waypointKey];
            if (!entry || entry.status !== "ok") continue;
            const latLng: [number, number] = [entry.lat, entry.lon];
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html: stopMarkerHtml(stop.number),
                iconSize: [28, 44],
                iconAnchor: [14, 44],
              }),
              interactive: false,
            }).addTo(pinsGroup);
          }
          for (const turn of turnsRef.current) {
            const entry = cache[turn.waypointKey];
            if (!entry || entry.status !== "ok") continue;
            const html = turnMarkerHtml(turn.direction, turn.heading);
            if (!html) continue;
            const latLng: [number, number] = [entry.lat, entry.lon];
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
              }),
              interactive: false,
            }).addTo(pinsGroup);
          }
          if (schoolRef.current) {
            const latLng: [number, number] = [
              schoolRef.current.lat,
              schoolRef.current.lon,
            ];
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html: schoolMarkerHtml(),
                iconSize: [32, 32],
                iconAnchor: [16, 30],
              }),
              interactive: false,
            }).addTo(pinsGroup);
          }
        }

        syncToModeRef.current = () => {
          if (!map) return;
          if (modeRef.current === "overview") {
            drawOverviewPin();
            // Frame the whole route right away - the road-geometry
            // fetch above will tighten this once it resolves, but
            // that's a network round trip away and shouldn't leave
            // the map sitting on the La Vergne placeholder center
            // until then.
            if (orderedWaypointsRef.current.length > 0) {
              const bounds = orderedWaypointsRef.current.map(
                (w): [number, number] => [w.lat, w.lon],
              );
              map.fitBounds(L.latLngBounds(bounds), {
                padding: [40, 40],
                maxZoom: 16,
              });
            }
            return;
          }

          // Driving mode: face the direction of travel and fly to
          // the active step, revealing every stop/turn/school pin
          // the first time that flight actually lands somewhere -
          // if the active step itself has no resolved coordinate to
          // fly to, reveal immediately instead of waiting on a
          // flight that will never happen (a later step advance
          // that does resolve still gets its own gated reveal).
          const bearing = bearingAt(
            orderedWaypointsRef.current,
            activeWaypointKeyRef.current,
          );
          if (bearing != null) map.setBearing(bearing);
          const key = activeWaypointKeyRef.current;
          const entry = key ? cache[key] : undefined;
          if (!entry || entry.status !== "ok") {
            if (!drivingPinsRevealedRef.current) {
              drawDrivingPins();
              drivingPinsRevealedRef.current = true;
            }
            return;
          }
          if (!drivingPinsRevealedRef.current) {
            map.once("moveend", () => {
              drawDrivingPins();
              drivingPinsRevealedRef.current = true;
            });
          }
          map.flyTo([entry.lat, entry.lon], STREET_ZOOM, {
            duration: 0.75,
          });
        };
        syncToModeRef.current();
      });

      // The bus is moving for the whole trip, so this tracks the
      // driver's live position (watchPosition) rather than fetching it
      // once - a single getCurrentPosition call would go stale the
      // moment the bus pulls away. No permission-denied UI here beyond
      // the console warning: the app is still fully usable via the
      // turn-by-turn steps without it, same as if the browser/device
      // simply doesn't have a GPS fix yet.
      if (typeof navigator === "undefined" || !("geolocation" in navigator))
        return;

      const locationIcon = L.divIcon({
        className: "",
        html: LOCATION_DOT_HTML,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      let locationMarker: Marker | undefined;

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (cancelledRef() || !map) return;
          const latLng: [number, number] = [
            position.coords.latitude,
            position.coords.longitude,
          ];
          if (!locationMarker) {
            locationMarker = L.marker(latLng, {
              icon: locationIcon,
              zIndexOffset: 1000,
              interactive: false,
            }).addTo(map);
          } else {
            locationMarker.setLatLng(latLng);
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
    map?.remove();
    mapRef.current = null;
    pinsGroupRef.current = null;
  };
}

// ---------------------------------------------------------------------
// MapLibre GL + self-hosted PMTiles vector tiles - the preferred
// renderer (see mapEngine.ts's own doc comment for exactly what
// resolveMapEngine() checks before this ever runs, and how to generate
// the PMTiles file it needs). Same behavior as mountLeaflet above, just
// built on MapLibre's own native bearing/flyTo/fitBounds and DOM-element
// markers instead of Leaflet's plugin-dependent equivalents.
// ---------------------------------------------------------------------

// MapLibre's own coordinate order is [lon, lat] - the opposite of
// Leaflet's [lat, lon], which every prop/ref on this component is
// already expressed in (StepScreen.tsx, StartScreen.tsx, the waypoint
// cache itself). Converted at the boundary here rather than changing
// any of those callers' own [lat, lon] convention.
function toLngLat({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}): [number, number] {
  return [lon, lat];
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
    tripTypeRef,
    waypointsUrlRef,
    modeRef,
    activeWaypointKeyRef,
  } = args;

  let map: MapLibreMap | undefined;
  let watchId: number | undefined;
  let pins: MapLibreMarker[] = [];

  function clearPins() {
    for (const marker of pins) marker.remove();
    pins = [];
  }

  // Builds a real DOM element from one of this file's own HTML-string
  // icon builders (stopMarkerHtml/turnMarkerHtml/schoolMarkerHtml) -
  // MapLibre's own Marker takes an element, not an HTML string the way
  // Leaflet's divIcon does.
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
        attributionControl: { customAttribution: TILE_ATTRIBUTION },
      });
      const mapInstance = map;

      // addSource/addLayer (the road-geometry line, below) need the
      // style to have actually finished loading first - markers don't
      // technically require this, but everything is gated behind the
      // same "load" event anyway for one predictable draw order,
      // mirroring mountLeaflet's own "wait for the cache fetch, then
      // draw everything at once" structure.
      mapInstance.once("load", () => {
        if (cancelledRef()) return;

        void fetchCacheAndBuildOrderedWaypoints({
          waypointsUrlRef,
          schoolRef,
          tripTypeRef,
          pathRef,
          cacheRef,
          orderedWaypointsRef,
          cancelledRef,
        }).then((resolvedCache) => {
          if (cancelledRef() || !resolvedCache) return;
          // See mountLeaflet's own identical rebind for why this isn't
          // just a rename - the nested drawOverviewPin/drawDrivingPins
          // below need `cache` typed non-null in its own right, not
          // merely narrowed from this callback's own parameter.
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
              .then((res): Promise<RoutingResult> | null =>
                res.ok ? res.json() : null,
              )
              .then((result) => {
                if (cancelledRef() || !result) return;
                const roadLngLats = result.geometry.coordinates;
                mapInstance.addSource("route-line", {
                  type: "geojson",
                  data: {
                    type: "Feature",
                    properties: {},
                    geometry: { type: "LineString", coordinates: roadLngLats },
                  },
                });
                mapInstance.addLayer({
                  id: "route-line",
                  type: "line",
                  source: "route-line",
                  layout: { "line-cap": "round", "line-join": "round" },
                  paint: {
                    "line-color": "#2563eb",
                    "line-width": 4,
                    "line-opacity": 0.7,
                  },
                });
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

          function drawOverviewPin() {
            clearPins();
            if (schoolRef.current && tripTypeRef.current === "dropoff") {
              pins.push(
                new maplibregl.Marker({
                  element: elementFromHtml(schoolMarkerHtml()),
                  anchor: "bottom",
                })
                  .setLngLat(toLngLat(schoolRef.current))
                  .addTo(mapInstance),
              );
              return;
            }
            const firstStop = stopsRef.current.find(
              (s) => cache[s.waypointKey]?.status === "ok",
            );
            const entry = firstStop && cache[firstStop.waypointKey];
            if (firstStop && entry && entry.status === "ok") {
              pins.push(
                new maplibregl.Marker({
                  element: elementFromHtml(stopMarkerHtml(firstStop.number)),
                  anchor: "bottom",
                })
                  .setLngLat(toLngLat(entry))
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
              drawOverviewPin();
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

            const bearing = bearingAt(
              orderedWaypointsRef.current,
              activeWaypointKeyRef.current,
            );
            // Instant, not animated - same as mountLeaflet's own
            // setBearing call, which flyTo below deliberately excludes
            // from its own (animated) options so the two don't fight
            // over the rotation.
            if (bearing != null) mapInstance.setBearing(bearing);
            const key = activeWaypointKeyRef.current;
            const entry = key ? cache[key] : undefined;
            if (!entry || entry.status !== "ok") {
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
            mapInstance.flyTo({
              center: toLngLat(entry),
              zoom: STREET_ZOOM,
              duration: 750,
            });
          };
          syncToModeRef.current();
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
