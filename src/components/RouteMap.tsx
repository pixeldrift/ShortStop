"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { WaypointCache } from "@/lib/waypointCache";

/** One "stop" step's marker: waypointKey looks it up in the geocoded
 * cache (route-125-waypoints.json), number is its position among stops
 * (1-indexed) for the pin's on-map label - matching the same numbering
 * RouteProgressBar/StopContent already show for the same stop. */
export type StopMarker = { waypointKey: string; number: number };

// La Vergne, TN's approximate town center - a placeholder anchor until
// the route's own geocoded waypoints (deriveWaypoints.ts,
// route-125-waypoints.json) give this a real, route-derived center
// (or bounds) instead. Not tied to any specific address in the route
// data - just a general "somewhere in town" starting view.
const LA_VERGNE_CENTER: [number, number] = [36.0134, -86.5581];
const DEFAULT_ZOOM = 13;

// CARTO's free Voyager basemap rather than tile.openstreetmap.org
// directly: same OSM data underneath (styled to look close to the
// standard OSM look), but it actually serves a `{r}` (@2x) retina
// tile variant - openstreetmap.org's own tile server doesn't, so
// `detectRetina` below would be a no-op against it and every tile
// would render soft/blurry on any retina display. No API key needed
// for this volume of use.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
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

// Same red numbered pin as StopContent/RouteProgressBar (pin.png +
// a number near its top), so a stop reads as the same thing wherever
// it appears - map included. iconSize/iconAnchor below match this
// 28x44 box, anchored at its bottom-center point (the pin's tip),
// same convention Leaflet's own default marker icon uses.
const WAYPOINTS_URL = "/data/route-125-waypoints.json";

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

/**
 * A real, pannable/zoomable OpenStreetMap tile map - replaces the
 * static "Demo only placeholder, not actual map" JPEG that used to sit
 * in this spot. Centers on La Vergne, TN with a live position dot and a
 * numbered pin per stop wherever the geocoded waypoint cache actually
 * has one (empty right now - see the `stops` prop doc below) - no route
 * line drawn between them yet (see README, "Maps" sections).
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
}: {
  className?: string;
  /** A pin per stop, at whatever position route-125-waypoints.json's
   * cache has for it - stops with no cache entry (the whole cache is
   * empty until a real ORS_API_KEY-backed `npm run geocode` run
   * populates it - see README, "Maps" sections) are silently skipped
   * rather than placed anywhere approximate. */
  stops?: StopMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Read inside the mount effect's async callback below rather than
  // added as that effect's own dependency - `stops` is a fresh array
  // every render, and re-running the whole effect on every change
  // would tear down and rebuild the entire map (tile layer,
  // geolocation watch included) just to redraw pins that don't
  // actually change mid-trip.
  const stopsRef = useRef(stops);
  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

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
      void fetch(WAYPOINTS_URL)
        .then((res): Promise<WaypointCache> | WaypointCache => (res.ok ? res.json() : {}))
        .catch(() => ({}) as WaypointCache)
        .then((cache) => {
          if (cancelled || !map) return;
          for (const stop of stopsRef.current) {
            const entry = cache[stop.waypointKey];
            if (!entry || entry.status !== "ok") continue;
            L.marker([entry.lat, entry.lon], {
              icon: L.divIcon({
                className: "",
                html: stopMarkerHtml(stop.number),
                iconSize: [28, 44],
                iconAnchor: [14, 44],
              }),
              interactive: false,
            }).addTo(map);
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
      // Recenters the map once, on the first fix, so the driver doesn't
      // have to hunt for the dot on load - but never again after that,
      // so later updates don't fight a driver who's since panned/zoomed
      // to look elsewhere on the route.
      let recenteredOnFirstFix = false;

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
          if (!recenteredOnFirstFix) {
            recenteredOnFirstFix = true;
            map.setView(latLng, map.getZoom());
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
