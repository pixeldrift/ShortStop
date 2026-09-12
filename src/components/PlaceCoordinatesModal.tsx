"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";
import { MapPinIcon } from "./icons";
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
 * pinned to the middle of the viewport, never a real Leaflet marker
 * bound to a lat/lng - while the map tiles underneath pan freely, so
 * dragging always reads as "move the map until the right spot is
 * under the pin," not "drag the pin to the right spot." `map.getCenter()`
 * on every 'move' is what actually drives the live readout below and
 * what "Set coordinates" ultimately sends up via onSetCoordinates -
 * the pin element itself never carries a coordinate of its own.
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

    let map: LeafletMap | undefined;
    let cancelled = false;

    // Dynamic import, not top-level - same "leaflet touches `window`
    // during module evaluation" reasoning RouteMap.tsx's own identical
    // import documents.
    void import("leaflet").then((L) => {
      if (cancelled) return;
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
      cancelled = true;
      map?.remove();
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
