"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as LeafletMap } from "leaflet";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
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

// Diameters, in CSS pixels - both renderers size their own dots off
// these same three numbers, so Leaflet and MapLibre never drift apart.
// Stops get a real number to show, so they're bigger than a turn's
// plain dot; the current row's own dot is bigger again ("slightly
// bigger than it is already," and the one place a number is guaranteed
// legible even if a stop's own plain dot ever felt tight).
const STOP_SIZE = 18;
const TURN_SIZE = 10;
const CURRENT_SIZE = 24;
const STOP_COLOR = "#ef4444"; // red-500 - unchanged from before this
const TURN_COLOR = "#facc15"; // yellow-400
const CURRENT_COLOR = "#2563eb"; // blue-600 - unchanged from before this

/** One already-resolved Stop's own dot on the map - `rowIndex` (a real
 * index into EditRouteScreen's own `rows`) is what lets tapping one of
 * these open that row's own editor (onClickPin below), not just look at
 * it. `stopNumber` is the same "Stop N" number StepRowEditor's own
 * header shows for this row, shown inside the dot itself. */
export interface StopPin {
  lat: number;
  lon: number;
  rowIndex: number;
  stopNumber: number;
}

/** Every other already-resolved waypoint - a turn, a Depart/Arrive, any
 * row that isn't a Stop. Same `rowIndex`-driven tap-to-edit as StopPin,
 * just no number of its own to show (only a Stop has one). */
export interface TurnPin {
  lat: number;
  lon: number;
  rowIndex: number;
}

/** One colored, optionally-numbered dot's own HTML, shared by both
 * renderers (Leaflet's L.divIcon takes this as a string outright;
 * MapLibre's Marker takes a real DOM element, built from this same
 * string via elementFromHtml below) so a stop/turn/current dot's actual
 * look never has to be written twice. `size` is a full diameter, not a
 * radius - unlike the old circleMarker-based version this replaced,
 * which took radii. */
function dotHtml(size: number, color: string, text?: number): string {
  return (
    `<div style="width:${size}px;height:${size}px;border-radius:9999px;` +
    `background:${color};border:1.5px solid #ffffff;` +
    "box-shadow:0 1px 2px rgba(0,0,0,0.35);" +
    "display:flex;align-items:center;justify-content:center;" +
    "color:#ffffff;font-weight:800;font-family:inherit;line-height:1;" +
    (text != null ? `font-size:${Math.round(size * 0.5)}px;` : "") +
    `">${text ?? ""}</div>`
  );
}

/** What either renderer hands back once mounted, so this component can
 * react to a later prop change (StepRowEditor's own prev/next arrows,
 * above all) by moving the *existing* map instead of tearing it down
 * and rebuilding a fresh one - see this file's own top doc comment for
 * why that distinction is the whole point. */
interface PreviewMapController {
  flyToCenter(center: { lat: number; lon: number }, stopNumber: number | null): void;
  setStopPins(stopPins: StopPin[]): void;
  setTurnPins(turnPins: TurnPin[]): void;
  destroy(): void;
}

/**
 * A small, interactive street-level preview inside StepRowEditor - just
 * enough spatial context (this route's own road-following line, every
 * other already-resolved waypoint as a plain dot - red for a Stop,
 * yellow for anything else - this row's own point highlighted bigger
 * and in blue) to sanity-check a coordinate against its neighbors
 * without leaving the popup. An admin can drag/scroll/pinch to look
 * around it freely, and tap any other dot to jump straight to editing
 * that waypoint instead (onClickPin) - PlaceCoordinatesModal is still
 * the only place to actually *change* a coordinate.
 *
 * The map instance itself is mounted once and never rebuilt - StepRowEditor's
 * own prev/next arrows (or a tap on another dot) change `center` (and
 * `stopPins`/`turnPins`) as the admin moves between rows, and this
 * reacts to that with a real camera flight (flyToCenter, called from
 * the effect below) rather than remounting with a fresh camera, which
 * is what an earlier version's `key={rowIndex}` at the call site did -
 * every navigation looked like the view cutting straight to the next
 * stop with no sense of where it was relative to the last one.
 * `routeLine`'s own road-following fetch still only happens once, on
 * mount - unlike `center`, it's the same whole-route line regardless of
 * which row is open, so there's nothing for a row-to-row navigation to
 * update there.
 */
export function WaypointPreviewMap({
  center,
  centerStopNumber,
  routeLine,
  stopPins,
  turnPins,
  onClickPin,
}: {
  /** This row's own current coordinate (resolved, or manually typed) -
   * StepRowEditor falls back to the same neighbor guess/default it
   * hands PlaceCoordinatesModal when this row doesn't have one of its
   * own yet. */
  center: { lat: number; lon: number };
  /** This row's own "Stop N" number when it is one, shown inside the
   * current dot the same way every StopPin shows its own - null for a
   * turn (or any row with no stop number of its own), which just draws
   * as a plain, larger blue dot with nothing inside it. */
  centerStopNumber: number | null;
  /** Every already-resolved waypoint on this route, in order, school
   * included - the same list PlaceCoordinatesModal draws its own line
   * from (EditRouteScreen's routeContextPoints). */
  routeLine: { lat: number; lon: number }[];
  /** Every already-resolved Stop (EditRouteScreen's own stopPins) -
   * drawn as red, numbered dots, distinct from this row's own
   * highlighted point. */
  stopPins: StopPin[];
  /** Every other already-resolved waypoint - a turn, a Depart/Arrive -
   * drawn as plain yellow dots (EditRouteScreen's own turnPins). */
  turnPins: TurnPin[];
  /** Tapping one of stopPins'/turnPins' own dots - omitted
   * (GeocodeConfirmModal's own read-only instance) leaves every dot
   * non-interactive, same as before this existed. StepRowEditor's own
   * instance wires this to "open that row's editor instead," the same
   * jump its own prev/next arrows already do. */
  onClickPin?: (rowIndex: number) => void;
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
          ? mountMapLibre(container, center, routeLine, stopPins, turnPins, onClickPinRef, () => cancelled)
          : mountLeaflet(container, center, routeLine, stopPins, turnPins, onClickPinRef, () => cancelled);
    });

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
    // Mount once - center/routeLine/stopPins/turnPins's *initial*
    // values seed the very first paint only; every later change is
    // picked up by the effects below instead (this component's own doc
    // comment on why that split exists).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.flyToCenter(center, centerStopNumber);
    // Compares the coordinate/number, not the object literal
    // StepRowEditor hands down fresh every render - this only needs to
    // fly (and redraw the current dot) when either actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lon, centerStopNumber]);

  useEffect(() => {
    controllerRef.current?.setStopPins(stopPins);
  }, [stopPins]);

  useEffect(() => {
    controllerRef.current?.setTurnPins(turnPins);
  }, [turnPins]);

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
  turnPins: TurnPin[],
  onClickPinRef: React.RefObject<((rowIndex: number) => void) | undefined>,
  cancelledRef: () => boolean,
): PreviewMapController {
  let map: LeafletMap | undefined;
  // Leaflet's own module, kept around after the dynamic import resolves
  // so flyToCenter/setStopPins/setTurnPins (called well after mount,
  // from a later prop-change effect) can still reach L.marker/L.divIcon
  // without importing it a second time.
  let leaflet: typeof import("leaflet") | undefined;
  let currentMarker: ReturnType<typeof import("leaflet").marker> | undefined;
  let stopMarkers: ReturnType<typeof import("leaflet").marker>[] = [];
  let turnMarkers: ReturnType<typeof import("leaflet").marker>[] = [];
  let destroyed = false;

  // Shared by every dot this renderer ever draws (stop/turn/current
  // alike, both at initial mount and every later setStopPins/
  // setTurnPins/flyToCenter) - a colored, optionally-numbered
  // L.divIcon marker, clickable only when a real handler exists
  // (Leaflet's own default `.leaflet-interactive` CSS already gives an
  // interactive marker a pointer cursor for free).
  function makeDotMarker(
    L: typeof import("leaflet"),
    lat: number,
    lon: number,
    size: number,
    color: string,
    text: number | undefined,
    rowIndex: number | undefined,
  ): ReturnType<typeof import("leaflet").marker> {
    const clickable = rowIndex != null && onClickPinRef.current != null;
    const marker = L.marker([lat, lon], {
      icon: L.divIcon({ html: dotHtml(size, color, text), className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
      interactive: clickable,
    });
    if (rowIndex != null) marker.on("click", () => onClickPinRef.current?.(rowIndex));
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

    turnMarkers = turnPins.map((pin) =>
      makeDotMarker(L, pin.lat, pin.lon, TURN_SIZE, TURN_COLOR, undefined, pin.rowIndex).addTo(map!),
    );
    stopMarkers = stopPins.map((pin) =>
      makeDotMarker(L, pin.lat, pin.lon, STOP_SIZE, STOP_COLOR, pin.stopNumber, pin.rowIndex).addTo(map!),
    );
    // This row's own point, added last (on top of every plain dot
    // above, via a high zIndexOffset - L.Marker sorts by latitude by
    // default, which "added last" alone doesn't override) and in blue -
    // the one pin among the others an admin is actually here to check.
    currentMarker = L.marker([center.lat, center.lon], {
      icon: L.divIcon({
        html: dotHtml(CURRENT_SIZE, CURRENT_COLOR, undefined),
        className: "",
        iconSize: [CURRENT_SIZE, CURRENT_SIZE],
        iconAnchor: [CURRENT_SIZE / 2, CURRENT_SIZE / 2],
      }),
      interactive: false,
      zIndexOffset: 1000,
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
    flyToCenter(next, stopNumber) {
      if (!map || !leaflet) return;
      map.flyTo([next.lat, next.lon], PREVIEW_ZOOM, {
        duration: FLY_TO_DURATION_MS / 1000,
      });
      currentMarker?.setLatLng([next.lat, next.lon]);
      currentMarker?.setIcon(
        leaflet.divIcon({
          html: dotHtml(CURRENT_SIZE, CURRENT_COLOR, stopNumber ?? undefined),
          className: "",
          iconSize: [CURRENT_SIZE, CURRENT_SIZE],
          iconAnchor: [CURRENT_SIZE / 2, CURRENT_SIZE / 2],
        }),
      );
    },
    setStopPins(next) {
      if (!map || !leaflet) return;
      for (const marker of stopMarkers) marker.remove();
      stopMarkers = next.map((pin) =>
        makeDotMarker(leaflet!, pin.lat, pin.lon, STOP_SIZE, STOP_COLOR, pin.stopNumber, pin.rowIndex).addTo(map!),
      );
    },
    setTurnPins(next) {
      if (!map || !leaflet) return;
      for (const marker of turnMarkers) marker.remove();
      turnMarkers = next.map((pin) =>
        makeDotMarker(leaflet!, pin.lat, pin.lon, TURN_SIZE, TURN_COLOR, undefined, pin.rowIndex).addTo(map!),
      );
    },
    destroy() {
      destroyed = true;
      map?.remove();
    },
  };
}

function elementFromHtml(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

function mountMapLibre(
  container: HTMLDivElement,
  center: { lat: number; lon: number },
  routeLine: { lat: number; lon: number }[],
  stopPins: StopPin[],
  turnPins: TurnPin[],
  onClickPinRef: React.RefObject<((rowIndex: number) => void) | undefined>,
  cancelledRef: () => boolean,
): PreviewMapController {
  let map: MapLibreMap | undefined;
  // maplibre-gl's own module, kept around after the dynamic import
  // resolves so setStopPins/setTurnPins (called well after mount, from
  // a later prop-change effect) can still build a new Marker without
  // importing it a second time.
  let maplibreModule: typeof import("maplibre-gl") | undefined;
  let currentMarker: MapLibreMarker | undefined;
  let stopMarkers: MapLibreMarker[] = [];
  let turnMarkers: MapLibreMarker[] = [];

  // Shared by every dot this renderer ever draws - a real DOM element
  // (elementFromHtml, same dotHtml string Leaflet's own L.divIcon
  // takes) wrapped in a maplibregl.Marker, same "small colored,
  // optionally-numbered circle" this file's Leaflet renderer draws.
  // Markers aren't part of the map's own style/layers, so unlike the
  // route line below, none of this needs to wait on the map's "load"
  // event - safe to add right away.
  function makeDotMarker(
    maplibregl: typeof import("maplibre-gl"),
    lat: number,
    lon: number,
    size: number,
    color: string,
    text: number | undefined,
    rowIndex: number | undefined,
  ): MapLibreMarker {
    const element = elementFromHtml(dotHtml(size, color, text));
    if (rowIndex != null && onClickPinRef.current != null) {
      element.style.cursor = "pointer";
      element.addEventListener("click", () => onClickPinRef.current?.(rowIndex));
    }
    return new maplibregl.Marker({ element, anchor: "center" }).setLngLat([lon, lat]);
  }

  void import("maplibre-gl").then((maplibregl) =>
    import("pmtiles").then(({ Protocol }) => {
      if (cancelledRef()) return;
      maplibreModule = maplibregl;

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

      turnMarkers = turnPins.map((pin) =>
        makeDotMarker(maplibregl, pin.lat, pin.lon, TURN_SIZE, TURN_COLOR, undefined, pin.rowIndex).addTo(
          mapInstance,
        ),
      );
      stopMarkers = stopPins.map((pin) =>
        makeDotMarker(maplibregl, pin.lat, pin.lon, STOP_SIZE, STOP_COLOR, pin.stopNumber, pin.rowIndex).addTo(
          mapInstance,
        ),
      );
      // This row's own point - created last (a higher z-index than
      // every plain dot above, so it always reads on top even where
      // one lands at the exact same point) and in blue.
      currentMarker = makeDotMarker(
        maplibregl,
        center.lat,
        center.lon,
        CURRENT_SIZE,
        CURRENT_COLOR,
        undefined,
        undefined,
      ).addTo(mapInstance);
      currentMarker.getElement().style.zIndex = "10";

      if (routeLine.length > 1) {
        mapInstance.once("load", () => {
          if (cancelledRef()) return;
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
              mapInstance.addLayer({
                id: "preview-route-line",
                type: "line",
                source: "preview-route-line",
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.7 },
              });
            })
            .catch((err) => console.warn("Couldn't fetch route geometry:", err));
        });
      }
    }),
  );

  return {
    flyToCenter(next, stopNumber) {
      if (!map) return;
      map.flyTo({ center: [next.lon, next.lat], duration: FLY_TO_DURATION_MS });
      currentMarker?.setLngLat([next.lon, next.lat]);
      if (currentMarker) {
        currentMarker.getElement().innerHTML = dotHtml(CURRENT_SIZE, CURRENT_COLOR, stopNumber ?? undefined);
      }
    },
    setStopPins(next) {
      if (!map || !maplibreModule) return;
      for (const marker of stopMarkers) marker.remove();
      stopMarkers = next.map((pin) =>
        makeDotMarker(maplibreModule!, pin.lat, pin.lon, STOP_SIZE, STOP_COLOR, pin.stopNumber, pin.rowIndex).addTo(
          map!,
        ),
      );
    },
    setTurnPins(next) {
      if (!map || !maplibreModule) return;
      for (const marker of turnMarkers) marker.remove();
      turnMarkers = next.map((pin) =>
        makeDotMarker(maplibreModule!, pin.lat, pin.lon, TURN_SIZE, TURN_COLOR, undefined, pin.rowIndex).addTo(
          map!,
        ),
      );
    },
    destroy() {
      map?.remove();
    },
  };
}
