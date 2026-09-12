"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as LeafletMap } from "leaflet";
import { MapPinIcon } from "./icons";
import { PMTILES_URL, resolveMapEngine } from "@/lib/mapEngine";
import { protomapsStyle } from "@/lib/protomapsStyle";
import { TILE_ATTRIBUTION, TILE_SUBDOMAINS, TILE_URL } from "./RouteMap";

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
 * Same two-renderer split as RouteMap.tsx - resolveMapEngine()
 * (mapEngine.ts) decides once, on mount, between MapLibre GL's
 * self-hosted vector tiles (mountMapLibre, preferred) and the original
 * Leaflet + CARTO raster map (mountLeaflet, kept exactly as it always
 * was as the automatic fallback). See mapEngine.ts's own doc comment
 * for what that check looks at and how to generate the PMTiles file
 * the MapLibre path needs.
 */
export function PlaceCoordinatesModal({
  initialCenter,
  onCancel,
  onSetCoordinates,
}: {
  /** Where the map opens centered - the nearest already-resolved
   * neighbor waypoint(s) on either side of this row, averaged when both
   * exist (see StepRowEditor's own call site) - just a starting guess
   * the admin drags away from, never assumed correct on its own. */
  initialCenter: { lat: number; lon: number };
  onCancel: () => void;
  onSetCoordinates: (lat: number, lon: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(initialCenter);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void resolveMapEngine().then((engine) => {
      if (cancelled) return;
      cleanup =
        engine === "maplibre"
          ? mountMapLibre(container, initialCenter, setCenter, () => cancelled)
          : mountLeaflet(container, initialCenter, setCenter, () => cancelled);
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // initialCenter is only ever read on mount (the map's own starting
    // point) - re-centering on every render would fight the admin's own
    // drag the instant it happened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="relative mt-3 h-64 w-full overflow-hidden rounded-lg">
        <div ref={containerRef} className="h-full w-full" />
        {/* Fixed dead-center, never moved - this is the "place" the
            admin is positioning the map under, not a marker with a
            coordinate of its own. Tip anchored exactly at the
            container's visual center via the -100% vertical
            translate, same as any other teardrop-pin anchor
            elsewhere in this app (RouteMap.tsx's own marker icons). */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
          <MapPinIcon className="h-8 w-8 text-red-500 drop-shadow-md" />
        </div>
      </div>

      <p className="mt-2 text-center font-mono text-sm text-zinc-600">
        {center.lat.toFixed(5)}, {center.lon.toFixed(5)}
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
          Set coordinates
        </button>
      </div>
    </>
  );
}

type CenterSetter = (center: { lat: number; lon: number }) => void;

// The original renderer, unchanged from before mountMapLibre existed -
// the automatic fallback whenever resolveMapEngine() (mapEngine.ts)
// can't use MapLibre.
function mountLeaflet(
  container: HTMLDivElement,
  initialCenter: { lat: number; lon: number },
  setCenter: CenterSetter,
  cancelledRef: () => boolean,
): () => void {
  let map: LeafletMap | undefined;

  // Dynamic import, not top-level - same "leaflet touches `window`
  // during module evaluation" reasoning RouteMap.tsx's own identical
  // import documents.
  void import("leaflet").then((L) => {
    if (cancelledRef()) return;
    map = L.map(container, {
      center: [initialCenter.lat, initialCenter.lon],
      zoom: DEFAULT_ZOOM,
    });
    L.tileLayer(TILE_URL, {
      maxZoom: 20,
      subdomains: TILE_SUBDOMAINS,
      attribution: TILE_ATTRIBUTION,
      detectRetina: true,
    }).addTo(map);
    map.on("move", () => {
      if (!map) return;
      const c = map.getCenter();
      setCenter({ lat: c.lat, lon: c.lng });
    });
  });

  return () => {
    map?.remove();
  };
}

// MapLibre GL + self-hosted PMTiles vector tiles - the preferred
// renderer wherever resolveMapEngine() (mapEngine.ts) finds it can
// actually work. Same drag-under-a-fixed-pin behavior as mountLeaflet
// above, just reading the live center off MapLibre's own map.getCenter()
// instead of Leaflet's.
function mountMapLibre(
  container: HTMLDivElement,
  initialCenter: { lat: number; lon: number },
  setCenter: CenterSetter,
  cancelledRef: () => boolean,
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
      });
      map.on("move", () => {
        if (!map) return;
        const c = map.getCenter();
        setCenter({ lat: c.lat, lon: c.lng });
      });
    }),
  );

  return () => {
    map?.remove();
  };
}
