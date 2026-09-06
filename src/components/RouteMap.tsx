"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLatLike, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { WaypointCache } from "@/lib/waypointCache";

/** One "stop" step's marker: waypointKey looks it up in the route's own
 * geocoded sidecar cache (waypointsUrl prop, below), number is its
 * position among stops (1-indexed) for the pin's on-map label -
 * matching the same numbering RouteProgressBar/StopContent already show
 * for the same stop. */
export type StopMarker = { waypointKey: string; number: number };

// La Vergne, TN's approximate town center - a placeholder anchor until
// the route's own geocoded waypoints (deriveWaypoints.ts, and each
// route's own sidecar cache file - see waypointsUrl below) give this a
// real, route-derived center (or bounds) instead. Not tied to any
// specific address in the route data - just a general "somewhere in
// town" starting view.
//
// [longitude, latitude] order, not [latitude, longitude] - MapLibre (like
// GeoJSON) always takes lng first. This is the opposite of Leaflet's
// [lat, lng] convention this file used before the Geoapify/MapLibre GL
// migration (see README, "Maps" sections) - every coordinate pair below
// follows this same lng-first order now.
const LA_VERGNE_CENTER: [number, number] = [-86.5581, 36.0134];
const DEFAULT_ZOOM = 13;

// Geoapify's own hosted vector style JSON - MapLibre GL renders these
// directly (WebGL vector tiles, one style document describing every
// layer/paint rule) rather than Leaflet's raster {z}/{x}/{y} PNG tiles
// from the old CARTO setup. "osm-bright" is Geoapify's general-purpose
// default (clean, roughly comparable to the old CARTO Voyager look) -
// Geoapify offers several other named styles (osm-carto, positron,
// dark-matter, toner, klokantech-basic...) at this same
// /v1/styles/{name}/style.json path, see README "Maps" sections for how
// to swap it. Unlike CARTO's old anonymous tier, Geoapify has *no*
// keyless fallback at all - every request needs a real key - so this is
// `null` (not just an unwatermarked URL) when none is configured, and
// the component below skips initializing a map entirely rather than
// pointing MapLibre at a style URL that's guaranteed to fail auth.
const GEOAPIFY_STYLE_URL = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
  ? `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY}`
  : null;

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

// MapLibre's Marker takes a real DOM element (unlike Leaflet's divIcon,
// which took an HTML string directly) - wraps the same markup strings
// above in a plain container element it can hand over.
function elementFromHtml(html: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return wrapper;
}

/**
 * A real, pannable/zoomable vector tile map (Geoapify's hosted style,
 * rendered via MapLibre GL) - replaces the static "Demo only placeholder,
 * not actual map" JPEG that used to sit in this spot. Centers on La
 * Vergne, TN with a live position dot and a numbered pin per stop
 * wherever the geocoded waypoint cache actually has one (empty right
 * now - see the `stops` prop doc below) - no route line drawn between
 * them yet (see README, "Maps" sections).
 *
 * `maplibre-gl` is imported dynamically inside the effect, not at module
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
  waypointsUrl,
}: {
  className?: string;
  /** A pin per stop, at whatever position this route's own sidecar
   * waypoint cache (waypointsUrl below) has for it - stops with no
   * cache entry (the whole cache is empty until a real
   * ORS_API_KEY-backed `npm run geocode` run populates it - see
   * README, "Maps" sections) are silently skipped rather than placed
   * anywhere approximate. */
  stops?: StopMarker[];
  /** This route's own sidecar cache file, e.g.
   * "/data/125-PM-EL-waypoints.json" - one per real route (see
   * scripts/geocodeRoute.ts), computed by the caller from the same
   * routeNumber/tripType/schoolLevel-based naming convention its steps
   * CSV itself uses (see stepsCsvBaseName, parseRouteMasterList.ts). A
   * demo (fabricated) route's computed URL simply won't exist - a 404
   * resolves to an empty cache below, same as a real route whose
   * geocode run hasn't populated one yet. */
  waypointsUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Read inside the mount effect's async callback below rather than
  // added as that effect's own dependency - `stops` is a fresh array
  // every render, and re-running the whole effect on every change
  // would tear down and rebuild the entire map (style load, geolocation
  // watch included) just to redraw pins that don't actually change
  // mid-trip.
  const stopsRef = useRef(stops);
  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);
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
    // No key, no map - see GEOAPIFY_STYLE_URL's own doc above, and the
    // early return in this component's own render below.
    if (!container || !GEOAPIFY_STYLE_URL) return;

    let map: MapLibreMap | undefined;
    let cancelled = false;
    let watchId: number | undefined;

    void import("maplibre-gl").then((maplibregl) => {
      // The effect's cleanup can fire before this promise resolves
      // (e.g. React StrictMode's dev-only mount/unmount/remount) -
      // bail rather than initializing a map nothing will ever clean up.
      if (cancelled) return;
      const mapInstance = new maplibregl.Map({
        container,
        style: GEOAPIFY_STYLE_URL,
        center: LA_VERGNE_CENTER,
        zoom: DEFAULT_ZOOM,
      });
      mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      map = mapInstance;

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
          const pinLngLats: LngLatLike[] = [];
          for (const stop of stopsRef.current) {
            const entry = cache[stop.waypointKey];
            if (!entry || entry.status !== "ok") continue;
            const lngLat: LngLatLike = [entry.lon, entry.lat];
            pinLngLats.push(lngLat);
            new maplibregl.Marker({ element: elementFromHtml(stopMarkerHtml(stop.number)), anchor: "bottom" })
              .setLngLat(lngLat)
              .addTo(map);
          }
          // Once the route's own stops are geocoded, they're a far more
          // useful default view than the fixed La Vergne town-center
          // placeholder above (or the driver's own live position,
          // deliberately left out of this - see the geolocation watch
          // below) - frame the whole route, not wherever the bus
          // happens to be sitting when the map first mounts.
          if (pinLngLats.length > 0) {
            const bounds = new maplibregl.LngLatBounds();
            for (const lngLat of pinLngLats) bounds.extend(lngLat);
            map.fitBounds(bounds, { padding: 40, maxZoom: 16 });
          }
        });

      // The bus is moving for the whole trip, so this tracks the
      // driver's live position (watchPosition) rather than fetching it
      // once - a single getCurrentPosition call would go stale the
      // moment the bus pulls away. No permission-denied UI here beyond
      // the console warning: the app is still fully usable via the
      // turn-by-turn steps without it, same as if the browser/device
      // simply doesn't have a GPS fix yet. No one-time recenter onto it
      // either (see the fitBounds framing above) - only setLngLat, so
      // it tracks live without fighting the route's own framing.
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;

      let locationMarker: Marker | undefined;

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (cancelled || !map) return;
          const lngLat: LngLatLike = [position.coords.longitude, position.coords.latitude];
          if (!locationMarker) {
            locationMarker = new maplibregl.Marker({ element: elementFromHtml(LOCATION_DOT_HTML), anchor: "center" })
              .setLngLat(lngLat)
              .addTo(map);
          } else {
            locationMarker.setLngLat(lngLat);
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

  // Left as plain text (the container's own background shows through)
  // rather than silently drawing nothing over a placeholder graphic -
  // same "never fake a working feature" ethos as this app's demo-route
  // labeling elsewhere; a missing env var should read as missing, not
  // as a blank box that could be mistaken for "no waypoints yet".
  if (!GEOAPIFY_STYLE_URL) {
    return (
      <div className={`${className ?? ""} flex items-center justify-center p-4 text-center text-xs text-zinc-500`}>
        Map unavailable - NEXT_PUBLIC_GEOAPIFY_API_KEY isn&apos;t set
      </div>
    );
  }

  return <div ref={containerRef} className={className} />;
}
