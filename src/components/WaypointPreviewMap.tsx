"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { collapseAttribution, PMTILES_ATTRIBUTION, PMTILES_URL } from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import type { RoutingResult } from "@/lib/routing/types";

const PREVIEW_ZOOM = 15;
// Same 1s RouteMap.tsx's own driving-mode flyTo already uses for
// "jump to a new step" - familiar motion for the same kind of camera
// move, not a value picked fresh for this component.
const FLY_TO_DURATION_MS = 1000;

// Diameters, in CSS pixels. The current row's own dot is bigger than a
// plain Stop's ("slightly bigger than it is already," and the one
// place a number is guaranteed legible even if a stop's own plain dot
// ever felt tight).
const STOP_SIZE = 18;
// The current row's own diamond, when it's a turn/direction rather
// than a Stop - sized so its own rendered point-to-point height works
// out close to this value, giving it roughly the same visual area (and
// so the same "weight" at a glance) as a STOP_SIZE circle rather than
// reading as a much smaller accent mark next to one.
const TURN_SIZE = STOP_SIZE + 4;
const CURRENT_SIZE = 24;
const STOP_COLOR = "#ef4444"; // red-500
const TURN_COLOR = "#facc15"; // yellow-400
const CURRENT_COLOR = "#2563eb"; // blue-600

// Two independently-geocoded rows (a Stop and a turn typed for the same
// physical corner, say) rarely land on the exact same lat/lon - close
// enough that a human reads them as "the same intersection," but not
// bit-for-bit identical. This is the threshold both the current-turn/
// overlapping-stop hiding below and the camera-jump suppression in
// flyToCenter use to treat two such points as one spot. ~0.0003
// degrees of latitude is roughly 30m - comfortably smaller than the
// gap between two genuinely different intersections on a normal street
// grid, but bigger than the kind of noise two separate geocodes of
// "the same corner" tend to produce. A plain box comparison, not a
// real haversine distance - this only ever needs to answer "basically
// the same spot or not," the same informal precision RouteMap.tsx's
// own nearestCoordIndex already uses for a similar purpose.
const SAME_LOCATION_THRESHOLD_DEG = 0.0003;
function isSameLocation(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): boolean {
  return (
    Math.abs(a.lat - b.lat) < SAME_LOCATION_THRESHOLD_DEG &&
    Math.abs(a.lon - b.lon) < SAME_LOCATION_THRESHOLD_DEG
  );
}

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

/** One colored, optionally-numbered dot's own HTML - MapLibre's Marker
 * takes a real DOM element, built from this string via elementFromHtml
 * below, so a stop/current dot's actual look never has to be written
 * twice. `size` is a full diameter, not a radius. */
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

/** The current row's own HTML when it's a turn/direction rather than a
 * Stop - a rounded diamond (a rounded square rotated 45deg, via an
 * inner element so the rotation doesn't fight the outer element's own
 * positioning/click box, which MapLibre's Marker expects to be an
 * unrotated box of `height`x`height`) with a black border, echoing the
 * real turn-by-turn sign's own look (RouteMap.tsx's turnMarkerHtml)
 * rather than just being another plain dot. `height` is the box this
 * sits in; the inner square's own side is sized (height / sqrt(2)) so
 * the diamond's rendered point-to-point height comes out to roughly
 * `height` itself. */
function diamondHtml(height: number, color: string): string {
  const side = Math.round(height / Math.SQRT2);
  const radius = Math.round(side * 0.22);
  return (
    `<div style="width:${height}px;height:${height}px;display:flex;` +
    'align-items:center;justify-content:center;">' +
    `<div style="width:${side}px;height:${side}px;background:${color};` +
    `border:1.5px solid #000000;border-radius:${radius}px;` +
    "box-shadow:0 1px 2px rgba(0,0,0,0.35);" +
    'transform:rotate(45deg);"></div>' +
    "</div>"
  );
}

/** The current row's own marker HTML - a numbered blue circle for a
 * Stop (bigger than an ordinary StopPin's own, so it still reads as
 * "the one you're looking at" even sitting right next to one), or the
 * yellow diamond above for a turn/direction. The diamond only ever
 * appears here, for whichever row is actually open right now - there's
 * no separate, always-on marker for every other turn on the route the
 * way StopPin draws one for every other Stop; a route can have far more
 * turns than stops, and showing all of them at once read as clutter
 * without actually helping an admin place *this* row's own point. */
function currentMarkerHtml(stopNumber: number | null, isTurn: boolean): string {
  return isTurn ? diamondHtml(TURN_SIZE, TURN_COLOR) : dotHtml(CURRENT_SIZE, CURRENT_COLOR, stopNumber ?? undefined);
}

/** What mountMapLibre hands back once mounted, so this component can
 * react to a later prop change (StepRowEditor's own prev/next arrows,
 * above all) by moving the *existing* map instead of tearing it down
 * and rebuilding a fresh one - see this file's own top doc comment for
 * why that distinction is the whole point. */
interface PreviewMapController {
  flyToCenter(center: { lat: number; lon: number }, stopNumber: number | null, isTurn: boolean): void;
  setStopPins(stopPins: StopPin[]): void;
  destroy(): void;
}

/**
 * A small, interactive street-level preview inside StepRowEditor - just
 * enough spatial context (this route's own road-following line, every
 * other already-resolved Stop as a red numbered dot, this row's own
 * point highlighted bigger - blue for a Stop, a yellow diamond for a
 * turn/direction) to sanity-check a coordinate against its neighbors
 * without leaving the popup. An admin can drag/scroll/pinch to look
 * around it freely, and tap any other Stop's own dot to jump straight
 * to editing that waypoint instead (onClickPin) - PlaceCoordinatesModal
 * is still the only place to actually *change* a coordinate.
 *
 * A Stop pin sitting at (or very near) the current row's own point -
 * the same physical corner, typed as two separate rows - is hidden
 * while that row is a turn, rather than drawing its plain red dot right
 * underneath the current one's yellow diamond. It reappears the moment
 * a different row becomes current (see isSameLocation above).
 *
 * The map instance itself is mounted once and never rebuilt - StepRowEditor's
 * own prev/next arrows (or a tap on another dot) change `center` (and
 * `stopPins`) as the admin moves between rows, and this reacts to that
 * with a real camera flight (flyToCenter, called from the effect below)
 * rather than remounting with a fresh camera, which is what an earlier
 * version's `key={rowIndex}` at the call site did - every navigation
 * looked like the view cutting straight to the next stop with no sense
 * of where it was relative to the last one. That flight itself is
 * skipped (the marker still moves/changes shape, just without a camera
 * move) whenever the new center is within isSameLocation of where the
 * camera already is - a Stop and a turn typed for the same corner
 * shouldn't visibly reframe the map just to swap which marker shows
 * there; only an actual change of location does.
 * `routeLine`'s own road-following fetch still only happens once, on
 * mount - unlike `center`, it's the same whole-route line regardless of
 * which row is open, so there's nothing for a row-to-row navigation to
 * update there.
 */
export function WaypointPreviewMap({
  center,
  centerStopNumber,
  centerIsTurn,
  routeLine,
  stopPins,
  onClickPin,
}: {
  /** This row's own current coordinate (resolved, or manually typed) -
   * StepRowEditor falls back to the same neighbor guess/default it
   * hands PlaceCoordinatesModal when this row doesn't have one of its
   * own yet. */
  center: { lat: number; lon: number };
  /** This row's own "Stop N" number when it is one, shown inside the
   * current dot the same way every StopPin shows its own - null for a
   * turn (or for GeocodeConfirmModal's own read-only instance, which
   * never threads a real number through). */
  centerStopNumber: number | null;
  /** True when this row is a turn/direction rather than a Stop - draws
   * the current marker as the yellow diamond (currentMarkerHtml above)
   * instead of a numbered blue circle, and hides whichever StopPin (if
   * any) sits at this same physical spot for as long as this row stays
   * current. GeocodeConfirmModal's own instance always passes false -
   * it doesn't know or need to distinguish a Stop from a turn for its
   * one-off confirm preview, so it keeps the plain blue dot it always
   * has, same as before this existed. */
  centerIsTurn: boolean;
  /** Every already-resolved waypoint on this route, in order, school
   * included - the same list PlaceCoordinatesModal draws its own line
   * from (EditRouteScreen's routeContextPoints). */
  routeLine: { lat: number; lon: number }[];
  /** Every already-resolved Stop (EditRouteScreen's own stopPins) -
   * drawn as red, numbered dots, distinct from this row's own
   * highlighted point. */
  stopPins: StopPin[];
  /** Tapping one of stopPins' own dots - omitted (GeocodeConfirmModal's
   * own read-only instance) leaves every dot non-interactive, same as
   * before this existed. StepRowEditor's own instance wires this to
   * "open that row's editor instead," the same jump its own prev/next
   * arrows already do. */
  onClickPin?: (rowIndex: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PreviewMapController | null>(null);
  // Read by the click handlers on each marker, which are attached once
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
    controllerRef.current = mountMapLibre(
      container,
      center,
      centerStopNumber,
      centerIsTurn,
      routeLine,
      stopPins,
      onClickPinRef,
      () => cancelled,
    );

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
    // Mount once - center/centerStopNumber/centerIsTurn/routeLine/
    // stopPins's *initial* values seed the very first paint only; every
    // later change is picked up by the effects below instead (this
    // component's own doc comment on why that split exists).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.flyToCenter(center, centerStopNumber, centerIsTurn);
    // Compares the coordinate/number/kind, not the object literal
    // StepRowEditor hands down fresh every render - this only needs to
    // fly (and redraw the current dot) when any of those actually
    // changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lon, centerStopNumber, centerIsTurn]);

  useEffect(() => {
    controllerRef.current?.setStopPins(stopPins);
  }, [stopPins]);

  return (
    <div className="relative mt-3 h-40 w-full overflow-hidden rounded-2xl border border-zinc-300">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function elementFromHtml(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

function mountMapLibre(
  container: HTMLDivElement,
  initialCenter: { lat: number; lon: number },
  initialStopNumber: number | null,
  initialIsTurn: boolean,
  routeLine: { lat: number; lon: number }[],
  initialStopPins: StopPin[],
  onClickPinRef: React.RefObject<((rowIndex: number) => void) | undefined>,
  cancelledRef: () => boolean,
): PreviewMapController {
  let map: MapLibreMap | undefined;
  // maplibre-gl's own module, kept around after the dynamic import
  // resolves so setStopPins/flyToCenter (called well after mount, from
  // a later prop-change effect) can still build a new Marker without
  // importing it a second time.
  let maplibreModule: typeof import("maplibre-gl") | undefined;
  let currentMarker: MapLibreMarker | undefined;
  let stopMarkers: MapLibreMarker[] = [];

  // The latest values flyToCenter/setStopPins have been called with -
  // read by redrawStopPins (below) so a change to either one alone
  // (a fresh geocode resolving a StopPin, or simply navigating to a
  // different row) recomputes the same filtered set consistently, and
  // by the map's own initial draw once the async import resolves,
  // which may well be *after* an early flyToCenter/setStopPins call
  // already updated these past the values this function was first
  // called with - reading the latest ones here rather than the
  // original params keeps that first paint correct either way.
  let latestCenter = initialCenter;
  let latestStopNumber = initialStopNumber;
  let latestIsTurn = initialIsTurn;
  let latestStopPins = initialStopPins;

  // Shared by every marker this renderer ever draws - a real DOM
  // element (elementFromHtml) wrapped in a maplibregl.Marker (dotHtml
  // for a Stop, currentMarkerHtml for the current point). Markers
  // aren't part of the map's own style/layers, so unlike the route
  // line below, none of this needs to wait on the map's "load" event -
  // safe to add right away.
  function makeDotMarker(
    maplibregl: typeof import("maplibre-gl"),
    lat: number,
    lon: number,
    html: string,
    rowIndex: number | undefined,
  ): MapLibreMarker {
    const element = elementFromHtml(html);
    if (rowIndex != null && onClickPinRef.current != null) {
      element.style.cursor = "pointer";
      element.addEventListener("click", () => onClickPinRef.current?.(rowIndex));
    }
    return new maplibregl.Marker({ element, anchor: "center" }).setLngLat([lon, lat]);
  }

  // Every StopPin, minus whichever one (if any) sits at the current
  // row's own spot while that row is itself a turn - see this file's
  // own top doc comment for why. A Stop that IS the current row
  // (latestIsTurn false) never needs this - its own StopPin is simply
  // sitting directly under the bigger current marker, the same overlay
  // this already relied on before isSameLocation existed.
  function visibleStopPins(): StopPin[] {
    if (!latestIsTurn) return latestStopPins;
    return latestStopPins.filter((pin) => !isSameLocation(pin, latestCenter));
  }

  function redrawStopPins(maplibregl: typeof import("maplibre-gl")) {
    if (!map) return;
    for (const marker of stopMarkers) marker.remove();
    stopMarkers = visibleStopPins().map((pin) =>
      makeDotMarker(maplibregl, pin.lat, pin.lon, dotHtml(STOP_SIZE, STOP_COLOR, pin.stopNumber), pin.rowIndex).addTo(
        map!,
      ),
    );
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
        center: [latestCenter.lon, latestCenter.lat],
        zoom: PREVIEW_ZOOM,
        attributionControl: { customAttribution: PMTILES_ATTRIBUTION, compact: true },
      });
      const mapInstance = map;
      collapseAttribution(container);

      redrawStopPins(maplibregl);
      // This row's own point - created last (a higher z-index than
      // every plain dot above, so it always reads on top even where
      // one lands at the exact same point).
      currentMarker = makeDotMarker(
        maplibregl,
        latestCenter.lat,
        latestCenter.lon,
        currentMarkerHtml(latestStopNumber, latestIsTurn),
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
            .then((res): Promise<RoutingResult> | null => {
              // A non-OK response (quota exceeded, provider down)
              // resolves rather than rejects, so it never reaches the
              // .catch below - logged here so a missing line stays
              // diagnosable instead of silently vanishing (see
              // RouteMap.tsx's own identical fix).
              if (res.ok) return res.json();
              console.warn(`Couldn't fetch route geometry: HTTP ${res.status} ${res.statusText}`);
              return null;
            })
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
    flyToCenter(next, stopNumber, isTurn) {
      // Recorded regardless of whether the map itself has finished
      // loading yet - the async initial draw above reads these back
      // out, so an early navigation still paints correctly on first
      // load instead of showing whatever this function's own initial
      // params happened to be.
      const previousCenter = latestCenter;
      latestCenter = next;
      latestStopNumber = stopNumber;
      latestIsTurn = isTurn;

      if (!map) return;
      // Two rows resolved to (near enough) the same physical spot - a
      // Stop and a turn typed for the same corner - shouldn't visibly
      // reframe the map just to swap which marker shows there; only an
      // actual change of location gets the real camera flight.
      if (!isSameLocation(previousCenter, next)) {
        map.flyTo({ center: [next.lon, next.lat], duration: FLY_TO_DURATION_MS });
      }
      currentMarker?.setLngLat([next.lon, next.lat]);
      if (currentMarker) {
        currentMarker.getElement().innerHTML = currentMarkerHtml(stopNumber, isTurn);
      }
      if (maplibreModule) redrawStopPins(maplibreModule);
    },
    setStopPins(next) {
      latestStopPins = next;
      if (maplibreModule) redrawStopPins(maplibreModule);
    },
    destroy() {
      map?.remove();
    },
  };
}
