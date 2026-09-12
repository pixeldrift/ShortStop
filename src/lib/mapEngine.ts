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
 *
 * package.json pins maplibre-gl to 5.24.0, not the newer 6.x this was
 * originally built against - 6.2.0 through at least 6.9.0 have a
 * confirmed bug (maplibre/maplibre-gl-js#8186) where a pmtiles://
 * vector source resolves its metadata fine but then never requests an
 * actual tile in a PRODUCTION build specifically (next build/start;
 * next dev is unaffected) - the map silently stays blank forever, no
 * error anywhere. 5.24.0 predates the regression. This does mean
 * losing 6.x's fix for a real XSS sanitizer bypass (GHSA-jrc7-96c5-
 * q579) - accepted here because nothing in this app ever hands
 * user-controlled or remote HTML to MapLibre's own sanitizer: every
 * marker is built from this app's own fixed icon strings
 * (stopMarkerHtml/turnMarkerHtml/schoolMarkerHtml in RouteMap.tsx) via
 * a plain `el.innerHTML =`, never a MapLibre popup or any other API
 * that runs through DOM.sanitize(). Re-check this pin against
 * maplibre-gl-js#8186's status before ever bumping past 5.x again.
 */

/** Where both callers expect the self-hosted PMTiles file, if one has
 * been generated and placed per this module's own doc comment above -
 * a plain static asset under /public, no server-side tile endpoint of
 * this app's own needed. Named for the extract's actual coverage
 * (currently a central-TN rectangle spanning roughly Clarksville to
 * Chattanooga, not just Rutherford County) so the filename doesn't go
 * stale the next time the drawn area changes. */
export const PMTILES_URL = "/maps/middle-tennessee.pmtiles";

/** Required corner attribution for the MapLibre/PMTiles path - this
 * tileset is a Produced Work of OpenStreetMap data per Protomaps'
 * basemaps licensing guidelines (github.com/protomaps/basemaps -
 * LICENSE_DATA.md), which requires visible "© OpenStreetMap"
 * attribution on any web map using it, plus their own requested (not
 * required, but appreciated) Protomaps credit. Distinct from
 * TILE_ATTRIBUTION (RouteMap.tsx) - that one credits CARTO, the
 * Leaflet fallback's own tile provider, and would be wrong to reuse
 * here now that these maps render real OSM-via-Protomaps data instead
 * of CARTO's. */
export const PMTILES_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Forces MapLibre's own attribution control (a native `<details>`
 * element, `compact: true` in the Map constructor's own
 * `attributionControl` option) to start collapsed - RouteMap.tsx and
 * PlaceCoordinatesModal.tsx both call this right after constructing
 * their map. `compact: true` alone only lets the control auto-collapse
 * once the map gets too narrow for the full credit to fit
 * (MapLibre's own doc comment on that option is explicit about this);
 * it does nothing when there's room, which every map in this app
 * always has. OSM's own attribution guidelines
 * (osmfoundation.org/wiki/Licence/Attribution_Guidelines) explicitly
 * allow a small expandable icon in place of spelled-out credit on
 * space-constrained displays, so collapsing it unconditionally here -
 * not just when MapLibre's own width check happens to agree - is
 * still within those terms. A plain DOM tweak (toggling the native
 * `open` attribute) rather than fighting MapLibre for a real API to
 * do this with, since it doesn't expose one - safe because MapLibre's
 * own expand/collapse click handling reads that same attribute
 * natively, it doesn't track a separate open/closed state of its own
 * to fight with. */
export function collapseAttribution(container: HTMLElement): void {
  const details = container.querySelector<HTMLDetailsElement>(
    ".maplibregl-ctrl-attrib",
  );
  if (details) details.open = false;
}

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
