"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as LeafletMap } from "leaflet";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
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
// Same 750ms RouteMap.tsx's own driving-mode flyTo already uses for
// "jump to a new step" - familiar motion for the same kind of camera
// move, not a value picked fresh for this component.
const FLY_TO_DURATION_MS = 750;

/** What either renderer hands back once mounted, so this component can
 * react to a later prop change (StepRowEditor's own prev/next arrows,
 * above all) by moving the *existing* map instead of tearing it down
 * and rebuilding a fresh one - see this file's own top doc comment for
 * why that distinction is the whole point. */
interface PreviewMapController {
  flyToCenter(center: { lat: number; lon: number }): void;
  setStopPins(stopPins: { lat: number; lon: number }[]): void;
  destroy(): void;
}

/**
 * A small, interactive street-level preview inside StepRowEditor - just
 * enough spatial context (this route's own road-following line, every
 * other resolved Stop as a plain dot, this row's own point highlighted
 * in blue) to sanity-check a coordinate against its neighbors without
 * leaving the popup. An admin can drag/scroll/pinch to look around it
 * freely - PlaceCoordinatesModal is still the only place to actually
 * *change* a coordinate, this is just for looking.
 *
 * The map instance itself is mounted once and never rebuilt - StepRowEditor's
 * own prev/next arrows change `center` (and `stopPins`) as the admin
 * steps through rows, and this reacts to that with a real camera flight
 * (flyToCenter, called from the effect below) rather than remounting
 * with a fresh camera, which is what an earlier version's `key={rowIndex}`
 * at the call site did - every navigation looked like the view cutting
 * straight to the next stop with no sense of where it was relative to
 * the last one. `routeLine`'s own road-following fetch still only
 * happens once, on mount - unlike `center`, it's the same whole-route
 * line regardless of which row is open, so there's nothing for a
 * row-to-row navigation to update there.
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
  const controllerRef = useRef<PreviewMapController | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    void resolveMapEngine().then((engine) => {
      if (cancelled) return;
      controllerRef.current =
        engine === "maplibre"
          ? mountMapLibre(container, center, routeLine, stopPins, () => cancelled)
          : mountLeaflet(container, center, routeLine, stopPins, () => cancelled);
    });

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
    // Mount once - center/routeLine/stopPins's *initial* values seed
    // the very first paint only; every later change is picked up by
    // the two effects below instead (this component's own doc comment
    // on why that split exists).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.flyToCenter(center);
    // Compares the two numbers, not the object literal StepRowEditor
    // hands down fresh every render - this only needs to fly when the
    // coordinate itself actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lon]);

  useEffect(() => {
    controllerRef.current?.setStopPins(stopPins);
  }, [stopPins]);

  return (
    <div className="relative mt-3 h-40 w-full overflow-hidden rounded-2xl border border-zinc-300">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function mountLeaflet(
  container: HTMLDivElement,
  center: { lat: number; lon: number },
  routeLine: { lat: number; lon: number }[],
  stopPins: { lat: number; lon: number }[],
  cancelledRef: () => boolean,
): PreviewMapController {
  let map: LeafletMap | undefined;
  // Leaflet's own module, kept around after the dynamic import resolves
  // so flyToCenter/setStopPins (called well after mount, from a later
  // prop-change effect) can still reach L.circleMarker/L.latLng without
  // importing it a second time.
  let leaflet: typeof import("leaflet") | undefined;
  let currentMarker: ReturnType<typeof import("leaflet").circleMarker> | undefined;
  let stopMarkers: ReturnType<typeof import("leaflet").circleMarker>[] = [];
  let destroyed = false;

  void import("leaflet").then((L) => {
    if (cancelledRef() || destroyed) return;
    leaflet = L;
    map = L.map(container, {
      center: [center.lat, center.lon],
      zoom: PREVIEW_ZOOM,
    });
    L.tileLayer(TILE_URL, {
      maxZoom: 20,
      subdomains: TILE_SUBDOMAINS,
      attribution: TILE_ATTRIBUTION,
      detectRetina: true,
    }).addTo(map);

    stopMarkers = stopPins.map((pin) =>
      L.circleMarker([pin.lat, pin.lon], {
        radius: 5,
        color: "#ffffff",
        weight: 1.5,
        fillColor: "#ef4444",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map!),
    );
    // This row's own point, added last (on top of every plain stop dot
    // above) and in blue - the one pin among the others an admin is
    // actually here to check.
    currentMarker = L.circleMarker([center.lat, center.lon], {
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

  return {
    flyToCenter(next) {
      if (!map) return;
      map.flyTo([next.lat, next.lon], PREVIEW_ZOOM, {
        duration: FLY_TO_DURATION_MS / 1000,
      });
      currentMarker?.setLatLng([next.lat, next.lon]);
    },
    setStopPins(next) {
      if (!map || !leaflet) return;
      for (const marker of stopMarkers) marker.remove();
      stopMarkers = next.map((pin) =>
        leaflet!
          .circleMarker([pin.lat, pin.lon], {
            radius: 5,
            color: "#ffffff",
            weight: 1.5,
            fillColor: "#ef4444",
            fillOpacity: 1,
            interactive: false,
          })
          .addTo(map!),
      );
      currentMarker?.bringToFront();
    },
    destroy() {
      destroyed = true;
      map?.remove();
    },
  };
}

function pointFeature(point: { lat: number; lon: number }) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] },
  };
}

function stopPinsCollection(stopPins: { lat: number; lon: number }[]) {
  return {
    type: "FeatureCollection" as const,
    features: stopPins.map(pointFeature),
  };
}

function mountMapLibre(
  container: HTMLDivElement,
  center: { lat: number; lon: number },
  routeLine: { lat: number; lon: number }[],
  stopPins: { lat: number; lon: number }[],
  cancelledRef: () => boolean,
): PreviewMapController {
  let map: MapLibreMap | undefined;
  let loaded = false;
  // A flyToCenter/setStopPins call can land before the map's own "load"
  // event fires (StepRowEditor can navigate rows faster than a fresh
  // map mounts) - held here and applied once loaded instead of dropped.
  let pendingCenter = center;
  let pendingStopPins = stopPins;

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
        attributionControl: { customAttribution: PMTILES_ATTRIBUTION, compact: true },
      });
      const mapInstance = map;
      collapseAttribution(container);

      mapInstance.once("load", () => {
        if (cancelledRef()) return;
        loaded = true;

        mapInstance.addSource("preview-stops", {
          type: "geojson",
          data: stopPinsCollection(pendingStopPins),
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
          data: pointFeature(pendingCenter),
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

        if (routeLine.length > 1) {
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
        }

        // A flyToCenter/setStopPins already called before "load" fired
        // only ever updated `pending*` above - applied for real now
        // that the sources actually exist to update.
        if (pendingCenter !== center) {
          (mapInstance.getSource("preview-current") as GeoJSONSource | undefined)?.setData(
            pointFeature(pendingCenter),
          );
        }
        if (pendingStopPins !== stopPins) {
          (mapInstance.getSource("preview-stops") as GeoJSONSource | undefined)?.setData(
            stopPinsCollection(pendingStopPins),
          );
        }
      });
    }),
  );

  return {
    flyToCenter(next) {
      pendingCenter = next;
      if (!map || !loaded) return;
      map.flyTo({ center: [next.lon, next.lat], duration: FLY_TO_DURATION_MS });
      (map.getSource("preview-current") as GeoJSONSource | undefined)?.setData(
        pointFeature(next),
      );
    },
    setStopPins(next) {
      pendingStopPins = next;
      if (!map || !loaded) return;
      (map.getSource("preview-stops") as GeoJSONSource | undefined)?.setData(
        stopPinsCollection(next),
      );
    },
    destroy() {
      map?.remove();
    },
  };
}
