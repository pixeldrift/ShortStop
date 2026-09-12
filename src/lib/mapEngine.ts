/**
 * Which map renderer RouteMap.tsx and PlaceCoordinatesModal.tsx should
 * use - MapLibre GL (self-hosted vector tiles, PMTILES_URL below) when
 * it can actually work, Leaflet + CARTO's raster tiles (RouteMap.tsx's
 * own long-standing TILE_URL) otherwise. Both callers make this same
 * check rather than each hardcoding one engine, so a browser without
 * WebGL, or a deployment that hasn't generated/placed a PMTiles file
 * yet, silently and identically falls back everywhere instead of only
 * some maps working.
 *
 * This repo does NOT ship middle-tennessee.pmtiles itself - it's a
 * real (tens-of-MB, depending on the drawn extent) binary data file
 * built from OpenStreetMap, not something to commit speculatively. To
 * generate one:
 *   1. https://app.protomaps.com/downloads - draw a box covering the
 *      service area (and a little padding for routes that touch its
 *      edges), download the .pmtiles extract. This doesn't need to
 *      stay Rutherford-County-sized - a wider extract (e.g. one
 *      spanning multiple counties) works the same way, just a bigger
 *      file; name it for whatever it actually covers, not the one
 *      county this app started in.
 *   2. Save it as public/maps/middle-tennessee.pmtiles in this repo
 *      (matching PMTILES_URL below - rename both together if the
 *      extract's own coverage changes again).
 *   3. Reload the app - resolveMapEngine() finds it via the HEAD check
 *      below and both maps switch to it automatically, no other code
 *      changes needed. Until then, every map keeps working exactly as
 *      it does today, on Leaflet.
 */

/** Where both callers expect the self-hosted PMTiles file, if one has
 * been generated and placed per this module's own doc comment above -
 * a plain static asset under /public, no server-side tile endpoint of
 * this app's own needed. Named for the extract's actual coverage
 * (currently a central-TN rectangle spanning roughly Clarksville to
 * Chattanooga, not just Rutherford County) so the filename doesn't go
 * stale the next time the drawn area changes. */
export const PMTILES_URL = "/maps/middle-tennessee.pmtiles";

function supportsWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

/** A cheap existence check, not a real tile request - confirms the
 * PMTiles file is actually deployed before either map caller commits
 * to the MapLibre code path at all. Without this, a missing file would
 * only surface as MapLibre failing to load individual vector tiles one
 * by one, well after the map already started rendering blank - this
 * way it falls back to Leaflet up front instead, same as the
 * no-WebGL case. */
async function pmtilesAvailable(): Promise<boolean> {
  try {
    const res = await fetch(PMTILES_URL, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

// Checked once per page load and cached - the file isn't going to
// appear or a browser's WebGL support isn't going to change mid-session,
// so there's no reason for a second map mounted later on the same page
// (RouteMap and PlaceCoordinatesModal can both be on screen in the same
// session) to redo either check.
let cachedEngine: Promise<"maplibre" | "leaflet"> | null = null;

export function resolveMapEngine(): Promise<"maplibre" | "leaflet"> {
  if (!cachedEngine) {
    cachedEngine = (async () => {
      if (!supportsWebGL()) return "leaflet";
      return (await pmtilesAvailable()) ? "maplibre" : "leaflet";
    })();
  }
  return cachedEngine;
}
