"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { setTurnDiamondRotation, turnDiamondHtml } from "./mapMarkerIcons";
import {
  collapseAttribution,
  PMTILES_ATTRIBUTION,
  PMTILES_URL,
  ROUTE_LINE_OFFSET,
  ROUTE_LINE_WIDTH,
} from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import { nearestSegmentBearings } from "@/lib/routeProgress";
import type { RoutingResult } from "@/lib/routing/types";
import { isSameLocation, spreadCoincidentPoints } from "@/lib/spreadCoincidentPoints";
import type { TurnDirection } from "@/lib/types";

const PREVIEW_ZOOM = 15;
// Same 1s RouteMap.tsx's own driving-mode flyTo already uses for
// "jump to a new step" - familiar motion for the same kind of camera
// move, not a value picked fresh for this component.
const FLY_TO_DURATION_MS = 1000;

// Diameter, in CSS pixels, of a plain (non-current) Stop's own dot.
const STOP_SIZE = 18;
// The current row's own diamond, when it's a turn/direction rather
// than a Stop - sized so its own rendered point-to-point height works
// out close to this value, giving it roughly the same visual area (and
// so the same "weight" at a glance) as a STOP_SIZE circle rather than
// reading as a much smaller accent mark next to one.
const TURN_SIZE = STOP_SIZE + 4;
// The current row's own pin height, when it's a Stop - bigger than a
// plain Stop's own dot for the same reason TURN_SIZE is bigger than
// STOP_SIZE (a much larger visual "weight," not just a slightly bigger
// dot), now that it's the same real pin.svg shape every other numbered-
// stop visual already draws (pinHtml below) rather than a plain colored
// circle of its own.
const CURRENT_PIN_HEIGHT = 34;
const STOP_COLOR = "#ef4444"; // red-500

// Two independently-geocoded rows (a Stop and a turn typed for the same
// physical corner, say) rarely land on the exact same lat/lon - close
// enough that a human reads them as "the same intersection," but not
// bit-for-bit identical. isSameLocation is what both the current-turn/
// overlapping-stop hiding below and the camera-jump suppression in
// flyToCenter use to treat two such points as one spot -
// spreadCoincidentPoints (redrawStopPins, below) is the same threshold
// put to the opposite use: a route that genuinely stops twice at one
// real intersection still needs both dots visible, not one hiding the
// other.

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

/** One colored, numbered dot's own HTML - MapLibre's Marker takes a
 * real DOM element, built from this string via elementFromHtml below,
 * so a plain Stop's own dot look never has to be written twice. `size`
 * is a full diameter, not a radius. */
function dotHtml(size: number, color: string, text: number): string {
  return (
    `<div style="width:${size}px;height:${size}px;border-radius:9999px;` +
    `background:${color};border:1.5px solid #ffffff;` +
    "box-shadow:0 1px 2px rgba(0,0,0,0.35);" +
    "display:flex;align-items:center;justify-content:center;" +
    "color:#ffffff;font-weight:800;font-family:inherit;line-height:1;" +
    `font-size:${Math.round(size * 0.5)}px;">${text}</div>`
  );
}

// pin.svg's own intrinsic aspect ratio (public/assets/pin.svg's own
// viewBox) - what lets pinHtml below derive a matching width from just
// the one height a caller actually cares about, the same way
// `w-auto`/an explicit height alone already sizes it correctly
// everywhere else this same file draws it (StepScreen.tsx,
// RouteProgressBar.tsx, RouteMap.tsx's own stopMarkerHtml).
const PIN_ASPECT_RATIO = 350 / 548;

/** The real numbered pin's own HTML (not a plain colored dot) - the
 * same pin.svg/number-inside-the-pin's-own-circle look StepScreen.tsx's
 * live driving header, RouteProgressBar.tsx's own strip, and
 * RouteMap.tsx's stopMarkerHtml all already draw, reimplemented here as
 * a raw HTML string since this file builds MapLibre marker elements the
 * same way those other map builders do, not JSX. `height` is the pin's
 * own full height; `stopNumber` null draws a plain unnumbered pin
 * (GeocodeConfirmModal's own read-only instance, which never threads a
 * real Stop number through). */
function pinHtml(height: number, stopNumber: number | null): string {
  const width = Math.round(height * PIN_ASPECT_RATIO);
  const number =
    stopNumber != null
      ? `<span style="position:absolute;top:31%;left:50%;transform:translate(-50%,-50%);` +
        `color:#b91c1c;font-weight:800;font-family:inherit;line-height:1;` +
        `font-size:${Math.round(height * 0.42)}px;">${stopNumber}</span>`
      : "";
  return (
    `<div style="position:relative;width:${width}px;height:${height}px;">` +
    `<img src="/assets/pin.svg" alt="" style="width:100%;height:100%;` +
    `filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));" />${number}</div>`
  );
}

/** The current row's own marker HTML - the real numbered pin (pinHtml
 * above, bigger than an ordinary StopPin's own plain dot, so it still
 * reads as "the one you're looking at" even sitting right next to one)
 * for a Stop, or the shared yellow diamond (turnDiamondHtml,
 * mapMarkerIcons.tsx) for a turn/direction - the same shape/symbol
 * treatment RouteMap.tsx's own turn markers now draw. The diamond only
 * ever appears here, for whichever row is actually open right now -
 * there's no separate, always-on marker for every other turn on the
 * route the way StopPin draws one for every other Stop; a route can
 * have far more turns than stops, and showing all of them at once read
 * as clutter without actually helping an admin place *this* row's own
 * point. Falls back to the plain (possibly unnumbered) pin for a
 * malformed row turnDiamondHtml can't draw a real symbol for (neither
 * `direction` nor `heading` set) rather than ever showing a blank
 * diamond. */
function currentMarkerHtml(
  stopNumber: number | null,
  direction: TurnDirection | undefined,
  heading: string | undefined,
): string {
  return turnDiamondHtml(TURN_SIZE, direction, heading) ?? pinHtml(CURRENT_PIN_HEIGHT, stopNumber);
}

/** What mountMapLibre hands back once mounted, so this component can
 * react to a later prop change (StepRowEditor's own prev/next arrows,
 * above all) by moving the *existing* map instead of tearing it down
 * and rebuilding a fresh one - see this file's own top doc comment for
 * why that distinction is the whole point. */
interface PreviewMapController {
  flyToCenter(
    center: { lat: number; lon: number },
    stopNumber: number | null,
    direction: TurnDirection | undefined,
    heading: string | undefined,
  ): void;
  setStopPins(stopPins: StopPin[]): void;
  setRouteLine(routeLine: { lat: number; lon: number }[]): void;
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
 * `routeLine`'s own road-following fetch re-runs (setRouteLine, below)
 * whenever `routeLine` itself actually changes identity - unlike
 * `center`, it's the same whole-route line regardless of which row is
 * open, so a plain row-to-row navigation never triggers this on its
 * own, but a coordinate resolving (or an Update/Override/Fetch landing
 * on some other row while this map is already open) does, and the
 * drawn line needs to reflect that rather than staying frozen at
 * whatever it looked like the moment this component first mounted -
 * see EditRouteScreen's own routeContextPoints, the actual source this
 * always reads from.
 */
export function WaypointPreviewMap({
  center,
  centerStopNumber,
  centerDirection,
  centerHeading,
  routeLine,
  stopPins,
  onClickPin,
  className,
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
  /** This row's own action, split the same way RouteMap.tsx's own
   * TurnMarker is - `centerDirection` (Left/Right) or `centerHeading`
   * (everything else) draws the current marker as the shared yellow
   * diamond (currentMarkerHtml above) instead of a numbered blue
   * circle, and hides whichever StopPin (if any) sits at this same
   * physical spot for as long as this row stays current. Both omitted
   * (GeocodeConfirmModal's own read-only instance, or a Stop) keeps the
   * plain blue dot. */
  centerDirection?: TurnDirection;
  centerHeading?: string;
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
  /** Full outer-wrapper className, same "caller composes it" contract
   * as RouteMap.tsx's own className prop - defaults to this component's
   * original fixed inline size/border when omitted, so every call site
   * from before ExpandableMap wrapped this in still renders unchanged.
   * ExpandableMap's own callers pass a bare `h-full w-full` (small box)
   * or a full-bleed one (expanded), composing the border/rounded-corner
   * treatment themselves the same way RouteMap's own ExpandableMap call
   * sites already do. */
  className?: string;
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
      centerDirection,
      centerHeading,
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
    // Mount once - center/centerStopNumber/centerDirection/
    // centerHeading/routeLine/stopPins's *initial* values seed the very
    // first paint only; every later change is picked up by the effects
    // below instead (this component's own doc comment on why that
    // split exists).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.flyToCenter(center, centerStopNumber, centerDirection, centerHeading);
    // Compares the coordinate/number/kind, not the object literal
    // StepRowEditor hands down fresh every render - this only needs to
    // fly (and redraw the current dot) when any of those actually
    // changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lon, centerStopNumber, centerDirection, centerHeading]);

  useEffect(() => {
    controllerRef.current?.setRouteLine(routeLine);
    // routeLine itself, not its contents - EditRouteScreen's own
    // routeContextPoints is already a useMemo (same reference across
    // renders where nothing relevant changed), the same "caller keeps
    // identity stable, this just trusts it" contract setStopPins below
    // already relies on. Re-running this on every render would mean
    // re-fetching /api/route-geometry constantly for no reason; missing
    // a real change would mean this map drawing a stale line forever,
    // which is exactly the bug this effect exists to fix (see this
    // file's own top doc comment).
  }, [routeLine]);

  useEffect(() => {
    controllerRef.current?.setStopPins(stopPins);
  }, [stopPins]);

  return (
    <div
      className={
        className ??
        "relative mt-3 h-40 w-full overflow-hidden rounded-2xl border border-zinc-300"
      }
    >
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
  initialDirection: TurnDirection | undefined,
  initialHeading: string | undefined,
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
  let latestDirection = initialDirection;
  let latestHeading = initialHeading;
  let latestStopPins = initialStopPins;
  let latestRouteLine = routeLine;
  // This route's own already-fetched road-following geometry (set once
  // drawRouteLine's own /api/route-geometry call resolves) - what
  // redrawStopPins passes to spreadCoincidentPoints so a coincident
  // group of stops offsets onto the real side of the road the line
  // itself draws that stop's pass on, rather than an arbitrary clock
  // position. Empty until that first fetch lands, same "quietly do
  // without it" fallback spreadCoincidentPoints already has for a
  // route with under two points to draw a line between at all.
  let latestRoadGeometry: { lat: number; lon: number }[] = [];
  // False until the map's own "load" event fires - addSource/addLayer
  // (inside drawRouteLine) need the style to have actually finished
  // loading first, same gate RouteMap.tsx's own mountMapLibre already
  // uses. setRouteLine, called well after mount, trusts this instead of
  // re-registering its own "load" listener (which would never fire a
  // second time - MapLibre's "load" is once-per-map, not once-per-
  // listener) - draws immediately once this is true, otherwise leaves
  // latestRouteLine for the mount-time "load" handler to pick up.
  let mapStyleLoaded = false;
  // Bumped on every drawRouteLine call, below - a fetch already in
  // flight when a newer one starts (setRouteLine firing again before
  // the previous /api/route-geometry response has landed) checks this
  // against the id it was called with and quietly drops its own result
  // rather than drawing over whatever the newer call already drew, or -
  // worse - drawing itself *after* the newer one and winning the race
  // with stale geometry.
  let routeLineRequestId = 0;

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
  // own top doc comment for why. A Stop that IS the current row (no
  // direction/heading at all) never needs this - its own StopPin is
  // simply sitting directly under the bigger current marker, the same
  // overlay this already relied on before isSameLocation existed.
  function visibleStopPins(): StopPin[] {
    if (!latestDirection && !latestHeading) return latestStopPins;
    return latestStopPins.filter((pin) => !isSameLocation(pin, latestCenter));
  }

  // The current row's own real compass bearing, when it's a Left/Right
  // turn - `preferOutgoing: [true]` (nearestSegmentBearings's own doc
  // comment, routeProgress.ts) since a turn sign needs the road being
  // turned *onto*, unlike stopBearings (below), which deliberately
  // wants the *incoming* road a stop still sits on. Unlike RouteMap.tsx's
  // own applyTurnRotations, this map's own camera never rotates (no
  // bearing option anywhere in this file), so the map's own on-screen
  // bearing is always 0 - true compass bearing and screen angle are the
  // same thing here, no live "rotate" listener needed the way
  // RouteMap.tsx's own driving-mode camera spin requires.
  function currentTurnBearing(): number | null {
    if (!latestDirection) return null;
    return nearestSegmentBearings(latestRoadGeometry, [latestCenter], [true])[0];
  }

  // Re-applies the current marker's own real bearing (if it's a
  // Left/Right turn) - called right after currentMarker's own HTML is
  // (re)built, and again once latestRoadGeometry actually resolves
  // (drawRouteLine's own fetch, below), since a turn drawn before that
  // fetch lands has no real bearing to point at yet.
  function applyCurrentMarkerRotation() {
    if (!currentMarker || !latestDirection) return;
    setTurnDiamondRotation(currentMarker.getElement(), latestDirection, currentTurnBearing(), 0);
  }

  // One bearing per StopPin in `pins` - matched against
  // latestRouteLine (this route's own full, resolved, trip-ordered
  // waypoint list, stops and turns and school alike - EditRouteScreen's
  // own routeContextPoints, which a StopPin's own lat/lon always comes
  // from verbatim, same index order, per stopPins's own doc comment
  // there) by walking both lists in lockstep and consuming the next
  // matching entry for each pin in turn - not just matching each pin's
  // coordinate independently, which can't tell two visits to the same
  // real corner apart on its own (nearestSegmentBearings's own doc
  // comment, routeProgress.ts) the way trusting trip order does.
  function stopBearings(pins: StopPin[]): (number | null)[] {
    const orderedBearings = nearestSegmentBearings(latestRoadGeometry, latestRouteLine);
    let cursor = 0;
    return pins.map((pin) => {
      while (
        cursor < latestRouteLine.length &&
        !(latestRouteLine[cursor].lat === pin.lat && latestRouteLine[cursor].lon === pin.lon)
      ) {
        cursor++;
      }
      if (cursor >= latestRouteLine.length) return null;
      return orderedBearings[cursor++];
    });
  }

  function redrawStopPins(maplibregl: typeof import("maplibre-gl")) {
    if (!map) return;
    for (const marker of stopMarkers) marker.remove();
    // A route that genuinely stops twice at one real intersection (see
    // this file's own top doc comment) resolves both rows to the same
    // point - spread apart here, onto whichever real side of the road
    // latestRoadGeometry draws that stop's own pass on, so both stay
    // visible and tappable instead of one drawing directly on top of
    // the other.
    const pins = visibleStopPins();
    stopMarkers = spreadCoincidentPoints(pins, stopBearings(pins)).map((pin) =>
      makeDotMarker(maplibregl, pin.lat, pin.lon, dotHtml(STOP_SIZE, STOP_COLOR, pin.stopNumber), pin.rowIndex).addTo(
        map!,
      ),
    );
  }

  // Fetches this route's own road-following geometry and (re)draws it -
  // called once at mount (from the "load" handler below, since a fresh
  // map has no style loaded yet to add a source/layer to) and again by
  // setRouteLine, well after mount, whenever the caller's own routeLine
  // prop actually changes (this file's own top doc comment on why that
  // matters). `mapInstance` is threaded through as a param rather than
  // read off the outer `map` closure - setRouteLine's own call already
  // has to guard "is the map even built yet," and passing the
  // known-non-null instance through keeps that check in exactly one
  // place instead of two copies agreeing to stay in sync.
  function drawRouteLine(mapInstance: MapLibreMap, nextRouteLine: { lat: number; lon: number }[]) {
    const requestId = ++routeLineRequestId;
    const existingSource = mapInstance.getSource("preview-route-line");
    if (nextRouteLine.length <= 1) {
      // Fewer than two points to draw a line between at all (the same
      // "quietly do without it" case this always had) - clears
      // whatever line a previous, since-invalidated routeLine left
      // drawn, rather than leaving a stale one up with nothing left to
      // justify it.
      if (existingSource && mapInstance.getLayer("preview-route-line")) {
        mapInstance.removeLayer("preview-route-line");
      }
      if (existingSource) mapInstance.removeSource("preview-route-line");
      latestRoadGeometry = [];
      if (maplibreModule) redrawStopPins(maplibreModule);
      applyCurrentMarkerRotation();
      return;
    }
    fetch("/api/route-geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints: nextRouteLine }),
    })
      .then((res): Promise<RoutingResult> | null => {
        // A non-OK response (quota exceeded, provider down) resolves
        // rather than rejects, so it never reaches the .catch below -
        // logged here so a missing line stays diagnosable instead of
        // silently vanishing (see RouteMap.tsx's own identical fix).
        if (res.ok) return res.json();
        console.warn(`Couldn't fetch route geometry: HTTP ${res.status} ${res.statusText}`);
        return null;
      })
      .then((result) => {
        if (cancelledRef() || !result || requestId !== routeLineRequestId) return;
        const data = {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates: result.geometry.coordinates },
        };
        const existing = mapInstance.getSource("preview-route-line") as GeoJSONSource | undefined;
        if (existing) {
          existing.setData(data);
        } else {
          mapInstance.addSource("preview-route-line", { type: "geojson", data });
          mapInstance.addLayer({
            id: "preview-route-line",
            type: "line",
            source: "preview-route-line",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#2563eb",
              "line-width": ROUTE_LINE_WIDTH,
              "line-offset": ROUTE_LINE_OFFSET,
              "line-opacity": 0.7,
            },
          });
        }
        // Stop pins drawn before this fetch landed (the mount-time
        // first paint, or any redraw while a newer routeLine was still
        // in flight) used no real road geometry yet - redraw now so a
        // coincident group of stops picks up the real side-of-road
        // offset instead of staying on whatever this file's own
        // fallback left them at.
        latestRoadGeometry = result.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
        if (maplibreModule) redrawStopPins(maplibreModule);
        applyCurrentMarkerRotation();
      })
      .catch((err) => console.warn("Couldn't fetch route geometry:", err));
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
        currentMarkerHtml(latestStopNumber, latestDirection, latestHeading),
        undefined,
      ).addTo(mapInstance);
      currentMarker.getElement().style.zIndex = "10";
      applyCurrentMarkerRotation();

      mapInstance.once("load", () => {
        if (cancelledRef()) return;
        mapStyleLoaded = true;
        drawRouteLine(mapInstance, latestRouteLine);
      });
    }),
  );

  return {
    flyToCenter(next, stopNumber, direction, heading) {
      // Recorded regardless of whether the map itself has finished
      // loading yet - the async initial draw above reads these back
      // out, so an early navigation still paints correctly on first
      // load instead of showing whatever this function's own initial
      // params happened to be.
      const previousCenter = latestCenter;
      latestCenter = next;
      latestStopNumber = stopNumber;
      latestDirection = direction;
      latestHeading = heading;

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
        currentMarker.getElement().innerHTML = currentMarkerHtml(stopNumber, direction, heading);
      }
      applyCurrentMarkerRotation();
      if (maplibreModule) redrawStopPins(maplibreModule);
    },
    setStopPins(next) {
      latestStopPins = next;
      if (maplibreModule) redrawStopPins(maplibreModule);
    },
    setRouteLine(next) {
      latestRouteLine = next;
      // Not yet loaded: the mount-time "load" handler above will pick
      // this up off latestRouteLine itself once it fires, same as
      // flyToCenter/setStopPins already trust their own latest* values
      // for an early call. Already loaded: draw it right now instead of
      // waiting on a "load" event that already happened and will never
      // fire again.
      if (map && mapStyleLoaded) drawRouteLine(map, next);
    },
    destroy() {
      map?.remove();
    },
  };
}
