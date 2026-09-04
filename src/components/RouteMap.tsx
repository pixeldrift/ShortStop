"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

// La Vergne, TN's approximate town center - a placeholder anchor until
// the route's own geocoded waypoints (deriveWaypoints.ts,
// route-125-waypoints.json) give this a real, route-derived center
// (or bounds) instead. Not tied to any specific address in the route
// data - just a general "somewhere in town" starting view.
const LA_VERGNE_CENTER: [number, number] = [36.0134, -86.5581];
const DEFAULT_ZOOM = 13;

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * A real, pannable/zoomable OpenStreetMap tile map - replaces the
 * static "Demo only placeholder, not actual map" JPEG that used to sit
 * in this spot. For now it just centers on La Vergne, TN with no route
 * line, stop markers, or bus position drawn - that comes once the
 * geocoded waypoint cache is populated and wired in (see README,
 * "Maps" sections).
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
export function RouteMap({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: LeafletMap | undefined;
    let cancelled = false;

    void import("leaflet").then((L) => {
      // The effect's cleanup can fire before this promise resolves
      // (e.g. React StrictMode's dev-only mount/unmount/remount) -
      // bail rather than initializing a map nothing will ever clean up.
      if (cancelled) return;
      map = L.map(container, { center: LA_VERGNE_CENTER, zoom: DEFAULT_ZOOM });
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return <div ref={containerRef} className={className} />;
}
