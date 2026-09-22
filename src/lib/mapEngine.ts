import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

/**
 * Shared MapLibre GL setup for every map in this app (RouteMap.tsx,
 * WaypointPreviewMap.tsx, PlaceCoordinatesModal.tsx) - self-hosted
 * vector tiles (PMTILES_URL below), no other renderer. This app
 * requires WebGL; there is no raster-tile/Canvas2D fallback for a
 * browser without it. That was a real, deliberate call, not an
 * oversight - WebGL has shipped in every mainstream mobile browser
 * (iOS Safari since iOS 8/2014, Android Chrome since ~2013) for over a
 * decade, well past any device this app plausibly runs on, and
 * maintaining a second renderer cost real, ongoing double-implementation
 * work for every map feature with no evidence it was ever actually
 * needed. If a real device without WebGL ever does turn up (a locked-
 * down kiosk tablet on a GPU driver blocklist, say), that's the time to
 * design a real fallback for it - not before.
 *
 * This repo ships public/maps/middle-tennessee.pmtiles directly - a
 * real (tens-of-MB) binary data file built from OpenStreetMap. To
 * regenerate it for a different service area:
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

/** Where the self-hosted PMTiles file lives - a plain static asset
 * under /public, no server-side tile endpoint of this app's own
 * needed. Named for the extract's actual coverage (currently a
 * central-TN rectangle spanning roughly Clarksville to Chattanooga,
 * not just Rutherford County) so the filename doesn't go stale the
 * next time the drawn area changes. */
export const PMTILES_URL = "/maps/middle-tennessee.pmtiles";

/** Required corner attribution for the MapLibre/PMTiles path - this
 * tileset is a Produced Work of OpenStreetMap data per Protomaps'
 * basemaps licensing guidelines (github.com/protomaps/basemaps -
 * LICENSE_DATA.md), which requires visible "© OpenStreetMap"
 * attribution on any web map using it, plus their own requested (not
 * required, but appreciated) Protomaps credit. */
export const PMTILES_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Forces MapLibre's own attribution control (a native `<details>`
 * element, `compact: true` in the Map constructor's own
 * `attributionControl` option) to start collapsed - every map caller
 * in this app calls this right after constructing its map. `compact:
 * true` alone only lets the control auto-collapse once the map gets
 * too narrow for the full credit to fit (MapLibre's own doc comment on
 * that option is explicit about this); it does nothing when there's
 * room, which every map in this app always has. OSM's own attribution
 * guidelines (osmfoundation.org/wiki/Licence/Attribution_Guidelines)
 * explicitly allow a small expandable icon in place of spelled-out
 * credit on space-constrained displays, so collapsing it
 * unconditionally here - not just when MapLibre's own width check
 * happens to agree - is still within those terms. A plain DOM tweak
 * (toggling the native `open` attribute) rather than fighting MapLibre
 * for a real API to do this with, since it doesn't expose one - safe
 * because MapLibre's own expand/collapse click handling reads that
 * same attribute natively, it doesn't track a separate open/closed
 * state of its own to fight with. */
export function collapseAttribution(container: HTMLElement): void {
  const details = container.querySelector<HTMLDetailsElement>(
    ".maplibregl-ctrl-attrib",
  );
  if (details) details.open = false;
}

/** Zoom-interpolated line-width for every route line this app draws
 * (RouteMap.tsx's own route-traveled/route-remaining, WaypointPreviewMap.tsx's
 * preview-route-line, PlaceCoordinatesModal.tsx's route-line) - thinner
 * zoomed out, thicker zoomed in, the same "reads like it has real
 * width, not a fixed-pixel highlighter stroke" feel the base style's
 * own road layers already have (protomapsStyle.ts). Not a true
 * meters-wide road buffer - MapLibre's line-width is always screen
 * pixels, never real-world distance, so this is an approximation tuned
 * to feel right across the zoom range every map in this app actually
 * operates in (roughly 12-18, see each file's own zoom constants), not
 * a physically exact width at any one of them. */
export const ROUTE_LINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  2,
  18,
  6,
];

/** A small, fixed offset (MapLibre's own line-offset paint property, in
 * line-width units - positive shifts right relative to the direction
 * the line's own coordinates are drawn in) applied to every route line
 * this app draws, same reasoning as ROUTE_LINE_WIDTH above. A route's
 * own geometry already encodes real drive direction (the coordinate
 * order is the literal path driven), so a consistent offset naturally
 * separates two passes over the same street driven in opposite
 * directions (a bus that doubles back down a road it was already on)
 * into two parallel lines instead of one drawing directly over the
 * other - the same way real traffic lanes read as separate rather than
 * as one road. */
export const ROUTE_LINE_OFFSET = 3;
