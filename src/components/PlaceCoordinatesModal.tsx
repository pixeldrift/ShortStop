"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { ExpandableMap } from "./ExpandableMap";
import { MapPinIcon } from "./icons";
import { collapseAttribution, PMTILES_ATTRIBUTION, PMTILES_URL } from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import type { RoutingResult } from "@/lib/routing/types";

const DEFAULT_ZOOM = 18;

/**
 * The manual alternative to StepRowEditor's own Fetch (globe) button -
 * for the coordinate a geocoder can't find at all (a driveway, a bare
 * curb with no address of its own) rather than one it merely got
 * wrong. Swapped in for StepRowEditor's own form body/footer (its
 * `showPlaceModal` state) rather than opening as a second stacked
 * popup on top of it - same card, same size, no second dim backdrop
 * layered behind another. Center point stays fixed - visually, a pin
 * pinned to the middle of the viewport, never a real map marker bound
 * to a lat/lng - while the map tiles underneath pan freely, so
 * dragging always reads as "move the map until the right spot is
 * under the pin," not "drag the pin to the right spot." The map's own
 * live center on every 'move' is what actually drives the readout
 * below and what "Set coordinates" ultimately sends up via
 * onSetCoordinates - the pin element itself never carries a coordinate
 * of its own.
 *
 * Built on MapLibre GL + self-hosted PMTiles vector tiles (mountMapLibre
 * below), same as RouteMap.tsx and WaypointPreviewMap.tsx - see
 * mapEngine.ts's own doc comment for why this app requires WebGL with
 * no raster-tile fallback.
 */
export function PlaceCoordinatesModal({
  initialCenter,
  routeContext,
  onCancel,
  onSetCoordinates,
  onOverrideCoordinates,
}: {
  /** Where the map opens centered - the nearest already-resolved
   * neighbor waypoint(s) on either side of this row, averaged when both
   * exist (see StepRowEditor's own call site) - just a starting guess
   * the admin drags away from, never assumed correct on its own. */
  initialCenter: { lat: number; lon: number };
  /** Every already-resolved stop on this route, in order, school
   * included (EditRouteScreen's own routeContextPoints) - drawn as the
   * same road-following blue line RouteMap.tsx draws while driving, so
   * an admin placing a pin manually can see where it actually falls
   * relative to the rest of the route rather than guessing from the
   * bare tile background alone. Under two points draws nothing - same
   * "quietly do without it" fallback RouteMap.tsx's own identical fetch
   * already uses for a request/response failure, since there's no line
   * to draw between fewer than two points anyway. */
  routeContext: { lat: number; lon: number }[];
  onCancel: () => void;
  /** "Update" - writes straight into the shared Waypoint cache, same as
   * a real Fetch would (see StepRowEditor's own setManualCoordinates) -
   * every other stop sharing this exact road pair sees it too. */
  onSetCoordinates: (lat: number, lon: number) => void;
  /** "Override" - this row's own permanent coordinate
   * (RouteStep.overrideLat/overrideLon, prisma/schema.prisma's own doc
   * comment), independent of the shared cache and never affecting any
   * other stop. Omitted entirely (no second button) wherever a caller
   * has no real per-row override concept of its own to write into
   * (EditSavedLocationModal's own address-book entry, say - there's
   * only ever one of those, nothing to disambiguate a "second crossing"
   * from). */
  onOverrideCoordinates?: (lat: number, lon: number) => void;
}) {
  const [center, setCenter] = useState(initialCenter);
  // Only the small, persistently-mounted inline instance ever writes
  // this (MapPane's own mapInstanceRef prop below, passed only when
  // !isExpanded) - see ExpandableMap's own onExpandedChange doc comment
  // for why the full-screen instance needs no equivalent of its own.
  const smallMapRef = useRef<import("maplibre-gl").Map | undefined>(undefined);

  return (
    <>
      <ExpandableMap
        className="mt-3 h-64 w-full overflow-hidden rounded-2xl border border-zinc-300"
        onExpandedChange={(expanded) => {
          if (!expanded) {
            smallMapRef.current?.jumpTo({ center: [center.lon, center.lat] });
          }
        }}
        renderMap={(mapClassName, isExpanded) => (
          <MapPane
            className={`relative z-0 ${mapClassName}`}
            // The small instance starts at this modal's own fixed
            // initialCenter (its one true mount, for this modal's
            // whole lifetime); the full-screen instance mounts fresh
            // every time it opens and starts from wherever dragging
            // already left off, not back at the original guess.
            startCenter={isExpanded ? center : initialCenter}
            routeContext={routeContext}
            onCenterChange={setCenter}
            mapInstanceRef={isExpanded ? undefined : smallMapRef}
          />
        )}
      />

      <p className="mt-2 text-center font-mono text-sm text-zinc-600">
        ({center.lat.toFixed(5)}, {center.lon.toFixed(5)})
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-glossy-light font-heading flex flex-1 items-center justify-center rounded-xl bg-zinc-300 py-3 text-sm font-semibold text-zinc-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSetCoordinates(center.lat, center.lon)}
          className="btn-glossy-blue font-heading flex flex-1 items-center justify-center rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white"
        >
          Update
        </button>
        {onOverrideCoordinates && (
          <button
            type="button"
            onClick={() => onOverrideCoordinates(center.lat, center.lon)}
            className="btn-glossy-light font-heading flex flex-1 items-center justify-center rounded-xl bg-zinc-300 py-3 text-sm font-semibold text-zinc-900"
          >
            Override
          </button>
        )}
      </div>
    </>
  );
}

/**
 * One map instance plus its own fixed center pin - ExpandableMap's own
 * `renderMap` calls this twice (the small inline box, and again for the
 * independent full-screen instance), each call mounting its own real
 * MapLibre map via mountMapLibre below. `startCenter` is only ever read
 * at mount (same "initial value, not a live binding" contract
 * mountMapLibre's own params already had before this was split out).
 */
function MapPane({
  startCenter,
  routeContext,
  onCenterChange,
  mapInstanceRef,
  className,
}: {
  startCenter: { lat: number; lon: number };
  routeContext: { lat: number; lon: number }[];
  onCenterChange: CenterSetter;
  /** Written with this instance's own live MapLibre Map once created -
   * only PlaceCoordinatesModal's small, persistently-mounted inline
   * instance passes this (see that component's own onExpandedChange),
   * so closing full screen can jump the still-mounted small map back
   * in sync with wherever dragging in full screen actually left off,
   * without needing a live two-way binding between two independent map
   * instances for their whole mounted lifetime. */
  mapInstanceRef?: MutableRefObject<import("maplibre-gl").Map | undefined>;
  className: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const cleanup = mountMapLibre(
      container,
      startCenter,
      routeContext,
      onCenterChange,
      () => cancelled,
      mapInstanceRef,
    );

    return () => {
      cancelled = true;
      cleanup();
    };
    // startCenter/routeContext are only ever read on mount (this
    // instance's own starting point and its one-time route-line fetch)
    // - see PlaceCoordinatesModal's own call site for why startCenter
    // deliberately differs per instance despite that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <div ref={containerRef} className="h-full w-full" />
      {/* Fixed dead-center, never moved - this is the "place" the
          admin is positioning the map under, not a marker with a
          coordinate of its own. Tip anchored exactly at the
          container's visual center via the -100% vertical translate,
          same as any other teardrop-pin anchor elsewhere in this app
          (RouteMap.tsx's own marker icons). */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
        <MapPinIcon className="h-8 w-8 text-red-500 drop-shadow-md" />
      </div>
    </div>
  );
}

type CenterSetter = (center: { lat: number; lon: number }) => void;

// MapLibre GL + self-hosted PMTiles vector tiles - drag-under-a-fixed-
// pin behavior, reading the live center off MapLibre's own
// map.getCenter().
function mountMapLibre(
  container: HTMLDivElement,
  initialCenter: { lat: number; lon: number },
  routeContext: { lat: number; lon: number }[],
  setCenter: CenterSetter,
  cancelledRef: () => boolean,
  mapInstanceRef?: MutableRefObject<import("maplibre-gl").Map | undefined>,
): () => void {
  let map: import("maplibre-gl").Map | undefined;

  void import("maplibre-gl").then((maplibregl) =>
    import("pmtiles").then(({ Protocol }) => {
      if (cancelledRef()) return;

      // Harmless to repeat across this modal's own mounts and
      // RouteMap.tsx's own identical registration - see that
      // component's own doc comment on mountMapLibre for why this
      // skips an "already registered" guard.
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);

      map = new maplibregl.Map({
        container,
        style: protomapsStyle(PMTILES_URL),
        center: [initialCenter.lon, initialCenter.lat],
        zoom: DEFAULT_ZOOM,
        // compact: true - see RouteMap.tsx's own identical option for
        // why (a small tap-to-expand "i" rather than the credit
        // spelled out at all times); doubly relevant here since this
        // modal's own map is even smaller than the route info screen's.
        attributionControl: { customAttribution: PMTILES_ATTRIBUTION, compact: true },
      });
      const mapInstance = map;
      if (mapInstanceRef) mapInstanceRef.current = mapInstance;
      collapseAttribution(container);
      mapInstance.on("move", () => {
        const c = mapInstance.getCenter();
        setCenter({ lat: c.lat, lon: c.lng });
      });

      // addSource/addLayer need the style to have actually finished
      // loading first - same "load" gate RouteMap.tsx's own
      // mountMapLibre uses, for the same reason.
      mapInstance.once("load", () => {
        if (cancelledRef() || routeContext.length <= 1) return;
        // The route's own road-following line, for spatial context
        // while placing this pin - see this function's own
        // `routeContext` param doc for why a request/response failure
        // also just means no line draws, never a fabricated straight
        // one standing in.
        fetch("/api/route-geometry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints: routeContext }),
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
            mapInstance.addSource("route-line", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: result.geometry.coordinates },
              },
            });
            mapInstance.addLayer({
              id: "route-line",
              type: "line",
              source: "route-line",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.7 },
            });
          })
          .catch((err) => console.warn("Couldn't fetch route geometry:", err));
      });
    }),
  );

  return () => {
    map?.remove();
  };
}
