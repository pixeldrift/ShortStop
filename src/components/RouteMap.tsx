"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { RouteWaypoint, RoutingResult } from "@/lib/routing/types";
import type { TripType } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";

/** One "stop" step's marker: waypointKey looks it up in the route's own
 * geocoded sidecar cache (waypointsUrl prop, below), number is its
 * position among stops (1-indexed) for the pin's on-map label -
 * matching the same numbering RouteProgressBar/StopContent already show
 * for the same stop. */
export type StopMarker = { waypointKey: string; number: number };

/** One "turn" step's marker - waypointKey looks it up the same way a
 * StopMarker does, `label` is "<preceding stop's number>.<turn's own
 * position since that stop>" (StepScreen.tsx derives this): the turns
 * before the route's first stop count as stop 0, so its first turn
 * reads "0.1", and the third turn after stop 5 reads "5.3". Route 125's
 * own steps sheet is the only one with real turn-by-turn data today
 * (every 120 route sheet is stops only) - this only ever renders
 * something there, but nothing here is specific to that route. */
export type TurnMarker = { waypointKey: string; label: string };

// La Vergne, TN's approximate town center - a placeholder anchor until
// the route's own geocoded waypoints (deriveWaypoints.ts, and each
// route's own sidecar cache file - see waypointsUrl below) give this a
// real, route-derived center (or bounds) instead. Not tied to any
// specific address in the route data - just a general "somewhere in
// town" starting view.
const LA_VERGNE_CENTER: [number, number] = [36.0134, -86.5581];
const DEFAULT_ZOOM = 13;

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
const TILE_URL = process.env.NEXT_PUBLIC_CARTO_API_KEY
  ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${process.env.NEXT_PUBLIC_CARTO_API_KEY}`
  : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_SUBDOMAINS = "abcd";
const TILE_ATTRIBUTION =
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

// A plain dot rather than a pin (unlike stopMarkerHtml above) - a turn
// isn't "at" a building or curb the way a stop is, just a point along
// the road, so it doesn't need a pin's downward-pointing anchor.
function turnMarkerHtml(label: string): string {
  return (
    '<div class="font-heading flex h-6 w-6 items-center justify-center rounded-full ' +
    'border-2 border-black bg-yellow-400 text-[10px] font-black text-black shadow-sm">' +
    label +
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

/**
 * A real, pannable/zoomable OpenStreetMap tile map - replaces the
 * static "Demo only placeholder, not actual map" JPEG that used to sit
 * in this spot. Centers on La Vergne, TN with a live position dot, a
 * numbered pin per stop, a small numbered dot per turn (routes with
 * real turn-by-turn data - see `turns`' own doc comment), and a line
 * connecting every one of those in the route's own order (`path`'s own
 * doc comment), wherever the geocode cache actually has an entry for it
 * (see the `stops`/`turns`/`path` prop docs below).
 *
 * `leaflet` is imported dynamically inside the effect, not at module
 * top level - the package touches `window` as soon as it's evaluated,
 * which would run during Next's server-side render pass for this
 * "use client" component's initial HTML (client components still get
 * one SSR pass for their first paint) and throw "window is not
 * defined" there. The CSS import above is fine at the top level even
 * so - it's just style rules, nothing that touches `window` - only the
 * JS module needs deferring to a browser-only effect.
 */
export function RouteMap({
  className,
  stops = [],
  turns = [],
  path = [],
  school,
  tripType,
  waypointsUrl,
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: LeafletMap | undefined;
    let cancelled = false;
    let watchId: number | undefined;

    void import("leaflet").then((L) => {
      // The effect's cleanup can fire before this promise resolves
      // (e.g. React StrictMode's dev-only mount/unmount/remount) -
      // bail rather than initializing a map nothing will ever clean up.
      if (cancelled) return;
      map = L.map(container, { center: LA_VERGNE_CENTER, zoom: DEFAULT_ZOOM });
      L.tileLayer(TILE_URL, {
        maxZoom: 20,
        subdomains: TILE_SUBDOMAINS,
        attribution: TILE_ATTRIBUTION,
        detectRetina: true,
      }).addTo(map);

      // A 404 (the common case right now - see the `stops` prop doc
      // above) resolves to {} rather than rejecting, same as any other
      // fetch/parse failure via the .catch below - either way, that
      // just means every stop below is a no-op cache miss, not an
      // error worth surfacing over a map that's otherwise working fine.
      void fetch(waypointsUrlRef.current)
        .then((res): Promise<WaypointCache> | WaypointCache => (res.ok ? res.json() : {}))
        .catch(() => ({}) as WaypointCache)
        .then((cache) => {
          if (cancelled || !map) return;
          const pinLatLngs: [number, number][] = [];

          // The road-following line itself - a real routed path, not a
          // connect-the-dots line through the cache's own points (see
          // this component's own doc comment on `path` for why that
          // changed). `routeWaypoints` is the same ordered list of
          // {lat, lon} points the old straight-line version built,
          // just handed to /api/route-geometry instead of drawn
          // directly - the school spliced in at whichever end its own
          // trip type puts it (see `tripType`'s own prop doc), since
          // it's a real leg of the trip but isn't one of `path`'s own
          // steps. A request/response failure (no ORS key configured,
          // a real ORS error, a network blip) just means no line draws
          // at all - same "quietly do without it" fallback every other
          // cache/fetch failure on this map already gets, never a
          // fabricated straight line standing in for it.
          const routeWaypoints: RouteWaypoint[] = [];
          if (schoolRef.current && tripTypeRef.current === "dropoff") {
            routeWaypoints.push(schoolRef.current);
          }
          for (const key of pathRef.current) {
            const entry = cache[key];
            if (!entry || entry.status !== "ok") continue;
            routeWaypoints.push({ lat: entry.lat, lon: entry.lon });
          }
          if (schoolRef.current && tripTypeRef.current === "pickup") {
            routeWaypoints.push(schoolRef.current);
          }
          if (routeWaypoints.length > 1) {
            fetch("/api/route-geometry", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ waypoints: routeWaypoints }),
            })
              .then((res): Promise<RoutingResult> | null => (res.ok ? res.json() : null))
              .then((result) => {
                if (cancelled || !map || !result) return;
                const roadLatLngs: [number, number][] = result.geometry.coordinates.map(
                  ([lon, lat]) => [lat, lon],
                );
                L.polyline(roadLatLngs, {
                  color: "#2563eb",
                  weight: 4,
                  opacity: 0.7,
                  lineJoin: "round",
                  interactive: false,
                }).addTo(map);
              })
              .catch((err) => console.warn("Couldn't fetch route geometry:", err));
          }

          for (const stop of stopsRef.current) {
            const entry = cache[stop.waypointKey];
            if (!entry || entry.status !== "ok") continue;
            const latLng: [number, number] = [entry.lat, entry.lon];
            pinLatLngs.push(latLng);
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html: stopMarkerHtml(stop.number),
                iconSize: [28, 44],
                iconAnchor: [14, 44],
              }),
              interactive: false,
            }).addTo(map);
          }
          for (const turn of turnsRef.current) {
            const entry = cache[turn.waypointKey];
            if (!entry || entry.status !== "ok") continue;
            const latLng: [number, number] = [entry.lat, entry.lon];
            pinLatLngs.push(latLng);
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html: turnMarkerHtml(turn.label),
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              }),
              interactive: false,
            }).addTo(map);
          }
          if (schoolRef.current) {
            const latLng: [number, number] = [schoolRef.current.lat, schoolRef.current.lon];
            pinLatLngs.push(latLng);
            L.marker(latLng, {
              icon: L.divIcon({
                className: "",
                html: schoolMarkerHtml(),
                iconSize: [32, 32],
                iconAnchor: [16, 30],
              }),
              interactive: false,
            }).addTo(map);
          }
          // Once the route's own stops are geocoded, they're a far more
          // useful default view than the fixed La Vergne town-center
          // placeholder above (or the driver's own live position,
          // deliberately left out of this - see recenteredOnFirstFix's
          // removal below) - frame the whole route, not wherever the bus
          // happens to be sitting when the map first mounts.
          if (pinLatLngs.length > 0) {
            map.fitBounds(L.latLngBounds(pinLatLngs), { padding: [40, 40], maxZoom: 16 });
          }
        });

      // The bus is moving for the whole trip, so this tracks the
      // driver's live position (watchPosition) rather than fetching it
      // once - a single getCurrentPosition call would go stale the
      // moment the bus pulls away. No permission-denied UI here beyond
      // the console warning: the app is still fully usable via the
      // turn-by-turn steps without it, same as if the browser/device
      // simply doesn't have a GPS fix yet.
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;

      const locationIcon = L.divIcon({
        className: "",
        html: LOCATION_DOT_HTML,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      let locationMarker: Marker | undefined;

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (cancelled || !map) return;
          const latLng: [number, number] = [position.coords.latitude, position.coords.longitude];
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
    });

    return () => {
      cancelled = true;
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      map?.remove();
    };
  }, []);

  return <div ref={containerRef} className={className} />;
}
