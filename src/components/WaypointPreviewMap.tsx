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
// Same 1s RouteMap.tsx's own driving-mode flyTo already uses for
// "jump to a new step" - familiar motion for the same kind of camera
// move, not a value picked fresh for this component.
const FLY_TO_DURATION_MS = 1000;

/** One already-resolved Stop's own dot on the map - `rowIndex` (a real
 * index into EditRouteScreen's own `rows`) is what lets tapping one of
 * these open that row's own editor (onClickPin below), not just look at
 * it. */
export interface StopPin {
  lat: number;
  lon: number;
  rowIndex: number;
}

/** What either renderer hands back once mounted, so this component can
 * react to a later prop change (StepRowEditor's own prev/next arrows,
 * above all) by moving the *existing* map instead of tearing it down
 * and rebuilding a fresh one - see this file's own top doc comment for
 * why that distinction is the whole point. */
interface PreviewMapController {
  flyToCenter(center: { lat: number; lon: number }): void;
  setStopPins(stopPins: StopPin[]): void;
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
  onClickPin,
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
  stopPins: StopPin[];
  /** Tapping one of `stopPins`' own dots - omitted (GeocodeConfirmModal's
   * own read-only instance) leaves every dot non-interactive, same as
   * before this existed. StepRowEditor's own instance wires this to
   * "open that row's editor instead," the same jump its own prev/next
   * arrows already do. */
  onClickPin?: (pin: StopPin) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PreviewMapController | null>(null);
  // Read by both renderers' own click handlers, which are attached once
  // (at pin-creation time) and would otherwise close over whatever
  // `onClickPin` happened to be at that moment - a ref keeps every
  // click reading the *latest* prop instead, without needing to tear
  // down and re-attach a listener every time it changes identity.
  const onClickPinRef = useRef(onClickPin);
  useEffect(() => {
    onClickPinRef.current = onClickPin;
  }, [onClickPin]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    void resolveMapEngine().then((engine) => {
      if (cancelled) return;
      controllerRef.current =
        engine === "maplibre"
          ? mountMapLibre(container, center, routeLine, stopPins, onClickPinRef, () => cancelled)
          : mountLeaflet(container, center, routeLine, stopPins, onClickPinRef, () => cancelled);
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
  stopPins: StopPin[],
  onClickPinRef: React.RefObject<((pin: StopPin) => void) | undefined>,
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

  // Shared by the initial mount and setStopPins below, so a stop dot's
  // own styling/click-wiring only ever lives in one place. Interactive
  // whenever a click handler is actually wanted (Leaflet's own default
  // `.leaflet-interactive` CSS already gives it a pointer cursor for
  // free) - a plain, un-clickable dot otherwise, same as before this
  // existed (GeocodeConfirmModal's own read-only instance, which never
  // passes onClickPin).
  function makeStopMarker(
    L: typeof import("leaflet"),
    pin: StopPin,
  ): ReturnType<typeof import("leaflet").circleMarker> {
    const marker = L.circleMarker([pin.lat, pin.lon], {
      radius: 5,
      color: "#ffffff",
      weight: 1.5,
      fillColor: "#ef4444",
      fillOpacity: 1,
      interactive: onClickPinRef.current != null,
    });
    marker.on("click", () => onClickPinRef.current?.(pin));
    return marker;
  }

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

    stopMarkers = stopPins.map((pin) => makeStopMarker(L, pin).addTo(map!));
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
      stopMarkers = next.map((pin) => makeStopMarker(leaflet!, pin).addTo(map!));
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

// Same shape as pointFeature above, plus `rowIndex` carried in
// `properties` - the click handler below reads it back off
// `e.features[0].properties.rowIndex` (GeoJSON geometry has no room for
// anything but coordinates) to know which row a tapped dot belongs to.
function stopPinFeature(pin: StopPin) {
  return {
    type: "Feature" as const,
    properties: { rowIndex: pin.rowIndex },
    geometry: { type: "Point" as const, coordinates: [pin.lon, pin.lat] },
  };
}

function stopPinsCollection(stopPins: StopPin[]) {
  return {
    type: "FeatureCollection" as const,
    features: stopPins.map(stopPinFeature),
  };
}

function mountMapLibre(
  container: HTMLDivElement,
  center: { lat: number; lon: number },
  routeLine: { lat: number; lon: number }[],
  stopPins: StopPin[],
  onClickPinRef: React.RefObject<((pin: StopPin) => void) | undefined>,
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
        // Attached once, unconditionally - reads onClickPinRef fresh on
        // every click (see that ref's own doc comment), so this never
        // needs to know whether a real handler exists yet, only whether
        // one does at the moment a tap actually lands. The hover cursor
        // swap is the same "this is clickable" affordance Leaflet's own
        // `.leaflet-interactive` CSS gives its circleMarkers for free -
        // MapLibre has no equivalent default, so it's done by hand here.
        mapInstance.on("click", "preview-stops", (e) => {
          const rowIndex = e.features?.[0]?.properties?.rowIndex;
          if (typeof rowIndex === "number") {
            onClickPinRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng, rowIndex });
          }
        });
        mapInstance.on("mouseenter", "preview-stops", () => {
          mapInstance.getCanvas().style.cursor = "pointer";
        });
        mapInstance.on("mouseleave", "preview-stops", () => {
          mapInstance.getCanvas().style.cursor = "";
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
