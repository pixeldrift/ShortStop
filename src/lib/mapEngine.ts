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
 * This repo does NOT ship rutherford-county.pmtiles itself - it's a
 * real (tens-of-MB) binary data file built from OpenStreetMap, not
 * something to commit speculatively. To generate one:
 *   1. https://app.protomaps.com/downloads - draw a box around
 *      Rutherford County, TN (and a little padding for routes that
 *      touch its edges), download the .pmtiles extract.
 *   2. Save it as public/maps/rutherford-county.pmtiles in this repo
 *      (matching PMTILES_URL below).
 *   3. Reload the app - resolveMapEngine() finds it via the HEAD check
 *      below and both maps switch to it automatically, no other code
 *      changes needed. Until then, every map keeps working exactly as
 *      it does today, on Leaflet.
 */

/** Where both callers expect the self-hosted PMTiles file, if one has
 * been generated and placed per this module's own doc comment above -
 * a plain static asset under /public, no server-side tile endpoint of
 * this app's own needed. */
export const PMTILES_URL = "/maps/rutherford-county.pmtiles";

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
