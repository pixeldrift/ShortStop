"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as LeafletMap } from "leaflet";
import {
  collapseAttribution,
  PMTILES_ATTRIBUTION,
  PMTILES_URL,
  resolveMapEngine,
} from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import { TILE_ATTRIBUTION, TILE_SUBDOMAINS, TILE_URL } from "./RouteMap";
import type { RoutingResult } from "@/lib/routing/types";

const PREVIEW_ZOOM = 15;

/**
 * A small, read-only street-level preview inside StepRowEditor - just
 * enough spatial context (this route's own road-following line, every
 * other resolved Stop as a plain dot, this row's own point highlighted
 * in blue) to sanity-check a coordinate against its neighbors without
 * leaving the popup. Unlike PlaceCoordinatesModal's own map, the
 * camera is set once on mount and never moves again - there's nothing
 * here for an admin to drag or tap, only to look at.
 */
export function WaypointPreviewMap({
  center,
  routeLine,
  stopPins,
}: {
  /** This row's own current coordinate (resolved, or manually typed) -
   * StepRowEditor falls back to the same neighbor guess/default it
   * hands PlaceCoordinatesModal when this row doesn't have one of its
   * own yet. */
  center: { lat: number; lon: number };
  /** Every already-resolved waypoint on this route, in order, school
   * included - the same list PlaceCoordinatesModal draws its own line
   * from (EditRouteScreen's routeContextPoints). */
  routeLine: { lat: number; lon: number }[];
  /** Every already-resolved Stop (not a turn, not the school) on this
   * route (EditRouteScreen's own stopPins) - drawn as plain dots,
   * distinct from this row's own highlighted point. */
  stopPins: { lat: number; lon: number }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void resolveMapEngine().then((engine) => {
      if (cancelled) return;
      cleanup =
        engine === "maplibre"
          ? mountMapLibre(container, center, routeLine, stopPins, () => cancelled)
          : mountLeaflet(container, center, routeLine, stopPins, () => cancelled);
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // center/routeLine/stopPins are only ever read on mount - this
    // preview is a fixed snapshot, not a live view, so there's nothing
    // to re-fetch or redraw as StepRowEditor's own draft keeps changing
    // underneath it (same reasoning PlaceCoordinatesModal's identical
    // mount effect already documents).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative mt-3 h-40 w-full overflow-hidden rounded-2xl border border-zinc-300">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

// Every interaction handler is switched off below (dragging, zoom,
// etc.) - this is a fixed snapshot for spatial context, not a real
// map an admin can pan around inside a card this small.
function mountLeaflet(
  container: HTMLDivElement,
  center: { lat: number; lon: number },
  routeLine: { lat: number; lon: number }[],
  stopPins: { lat: number; lon: number }[],
  cancelledRef: () => boolean,
): () => void {
  let map: LeafletMap | undefined;

  void import("leaflet").then((L) => {
    if (cancelledRef()) return;
    map = L.map(container, {
      center: [center.lat, center.lon],
      zoom: PREVIEW_ZOOM,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    L.tileLayer(TILE_URL, {
      maxZoom: 20,
      subdomains: TILE_SUBDOMAINS,
      attribution: TILE_ATTRIBUTION,
      detectRetina: true,
    }).addTo(map);

    for (const pin of stopPins) {
      L.circleMarker([pin.lat, pin.lon], {
        radius: 5,
        color: "#ffffff",
        weight: 1.5,
        fillColor: "#ef4444",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }
    // This row's own point, drawn last (on top of every plain stop dot
    // above) and in blue - the one pin among the others an admin is
    // actually here to check.
    L.circleMarker([center.lat, center.lon], {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: "#2563eb",
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);

    if (routeLine.length > 1) {
      fetch("/api/route-geometry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints: routeLine }),
      })
        .then((res): Promise<RoutingResult> | null => (res.ok ? res.json() : null))
        .then((result) => {
          if (cancelledRef() || !map || !result) return;
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
  });

  return () => {
    map?.remove();
  };
}

function mountMapLibre(
  container: HTMLDivElement,
  center: { lat: number; lon: number },
  routeLine: { lat: number; lon: number }[],
  stopPins: { lat: number; lon: number }[],
  cancelledRef: () => boolean,
): () => void {
  let map: import("maplibre-gl").Map | undefined;

  void import("maplibre-gl").then((maplibregl) =>
    import("pmtiles").then(({ Protocol }) => {
      if (cancelledRef()) return;

      // Harmless to repeat across every mount - see RouteMap.tsx's own
      // mountMapLibre for why this skips an "already registered" guard.
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);

      map = new maplibregl.Map({
        container,
        style: protomapsStyle(PMTILES_URL),
        center: [center.lon, center.lat],
        zoom: PREVIEW_ZOOM,
        interactive: false,
        attributionControl: { customAttribution: PMTILES_ATTRIBUTION, compact: true },
      });
      const mapInstance = map;
      collapseAttribution(container);

      mapInstance.once("load", () => {
        if (cancelledRef()) return;

        mapInstance.addSource("preview-stops", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: stopPins.map((p) => ({
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            })),
          },
        });
        mapInstance.addLayer({
          id: "preview-stops",
          type: "circle",
          source: "preview-stops",
          paint: {
            "circle-radius": 5,
            "circle-color": "#ef4444",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        // This row's own point - added after (and so drawn on top of)
        // every plain stop dot above.
        mapInstance.addSource("preview-current", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [center.lon, center.lat] },
          },
        });
        mapInstance.addLayer({
          id: "preview-current",
          type: "circle",
          source: "preview-current",
          paint: {
            "circle-radius": 6,
            "circle-color": "#2563eb",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });

        if (routeLine.length <= 1) return;
        fetch("/api/route-geometry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints: routeLine }),
        })
          .then((res): Promise<RoutingResult> | null => (res.ok ? res.json() : null))
          .then((result) => {
            if (cancelledRef() || !result) return;
            mapInstance.addSource("preview-route-line", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: result.geometry.coordinates },
              },
            });
            // Inserted below the stop dots (beforeId) so the line
            // never draws over them.
            mapInstance.addLayer(
              {
                id: "preview-route-line",
                type: "line",
                source: "preview-route-line",
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.7 },
              },
              "preview-stops",
            );
          })
          .catch((err) => console.warn("Couldn't fetch route geometry:", err));
      });
    }),
  );

  return () => {
    map?.remove();
  };
}
