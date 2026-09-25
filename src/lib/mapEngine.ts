#import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { CustomLayerInterface, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

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
 * (stopMarkerHtml/schoolMarkerHtml in RouteMap.tsx, turnDiamondHtml in
 * mapMarkerIcons.tsx) via
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

const SCHOOL_BUILDING_HIGHLIGHT_SOURCE = "school-building-highlight";

/** Fills the school's own real building footprint the same blue every
 * school pin already uses (schoolMarkerHtml, RouteMap.tsx), so it stands
 * out against every other building nearby's plain tan fill
 * (protomapsStyle.ts's own "buildings" layer) - the one building on the
 * map that's actually this route's destination, not just another
 * rooftop. Can't be a plain style filter the way pois-school is
 * (protomapsStyle.ts): the basemap's own "buildings" source-layer
 * carries no amenity=school tag on the polygon itself - kind_detail is
 * empty for every real building in the current extract (checked
 * directly against the pmtiles file's own vector-tile bytes, not just
 * the schema docs) - so there's nothing a declarative filter could ever
 * match on. Finds the right polygon at runtime instead: queries
 * whatever the basemap's own "buildings" fill layer has actually
 * rendered right under the school's own point, and redraws that one
 * feature's real geometry into its own source/layer, painted directly
 * above the base fill (and below roads/labels/pins, same stacking the
 * base fill itself already has) so the school's building reads as
 * highlighted, not just present.
 *
 * Self-maintaining rather than a one-shot call: attaches its own "idle"
 * listener (fires once the map has actually finished rendering every
 * tile in view - a query run any earlier could hit a tile still in
 * flight and find nothing) and re-queries/redraws on every one of those,
 * so a caller only ever needs to keep `schoolRef.current` up to date
 * (RouteMap.tsx already does, for its own `school` prop) - no separate
 * "the school changed, please redraw" call of its own to remember. A
 * school whose point isn't on-screen yet (still zoomed out in overview
 * mode, or below the base fill's own minzoom 15) simply queries empty
 * until the map actually gets there, the same "nothing to show until
 * you're close enough" behavior the base fill already has.
 */
export function installSchoolBuildingHighlight(
  map: MapLibreMap,
  // A plain `{ current }` shape, not React.RefObject - this file has no
  // other React dependency, and every caller already has a real
  // useRef-backed ref (schoolRef, RouteMap.tsx) that satisfies this
  // structurally with no cast needed.
  schoolRef: { current: { lat: number; lon: number } | null | undefined },
): void {
  let layerAdded = false;

  function ensureLayer() {
    if (layerAdded) return;
    map.addSource(SCHOOL_BUILDING_HIGHLIGHT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // beforeId "roads-minor" - directly above the base "buildings"
    // extrusion, below every road/label/pin, matching that base layer's
    // own existing stacking (protomapsStyle.ts's own layer order) rather
    // than painting over roads that cross the building's own footprint.
    // fill-extrusion, not a flat fill, same reasoning as protomapsStyle's
    // own "buildings" layer - a flat highlight would otherwise paint as a
    // ground-level patch that ignores the extruded volume right above it
    // once the map's pitched (RouteMap.tsx's own DRIVING_PITCH), reading
    // as detached from the real building it's meant to be marking rather
    // than coloring its actual walls/roof. A few meters taller than the
    // real building itself (see refresh's own `+3`) so the highlighted
    // school visibly pokes up above its own real rooftop, not just a
    // same-height re-paint indistinguishable from the ordinary buildings
    // layer already right underneath it.
    map.addLayer(
      {
        id: SCHOOL_BUILDING_HIGHLIGHT_SOURCE,
        type: "fill-extrusion",
        source: SCHOOL_BUILDING_HIGHLIGHT_SOURCE,
        paint: {
          "fill-extrusion-color": "#2563eb",
          "fill-extrusion-height": ["+", ["coalesce", ["get", "height"], 6], 3],
          "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
          "fill-extrusion-opacity": 0.75,
        },
      },
      "roads-minor",
    );
    layerAdded = true;
  }

  function refresh() {
    const school = schoolRef.current;
    ensureLayer();
    const source = map.getSource(SCHOOL_BUILDING_HIGHLIGHT_SOURCE) as
      | GeoJSONSource
      | undefined;
    if (!source) return;
    if (!school) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const point = map.project([school.lon, school.lat]);
    // A small box, not a single point - queryRenderedFeatures needs
    // real screen-pixel area to hit-test against, and the school pin's
    // own anchor ("bottom", schoolMarkerHtml) doesn't necessarily land
    // exactly on the building's own rendered fill pixel-for-pixel.
    const features = map.queryRenderedFeatures(
      [
        [point.x - 4, point.y - 4],
        [point.x + 4, point.y + 4],
      ],
      { layers: ["buildings"] },
    );
    const building = features.find((f) => f.properties?.kind === "building");
    source.setData(
      building
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: building.geometry,
                // height/min_height carried straight through from the
                // real queried feature - dropping them (as an earlier
                // version of this did, `properties: {}`) left the
                // fill-extrusion paint above with nothing to read but
                // its own coalesced default, so a school with a real
                // recorded height would extrude to the wrong one.
                properties: {
                  height: building.properties?.height,
                  min_height: building.properties?.min_height,
                },
              },
            ],
          }
        : { type: "FeatureCollection", features: [] },
    );
  }

  map.on("idle", refresh);
}

/** Soft ground-contact shadows + ambient occlusion under every extruded
 * building (protomapsStyle.ts's own "buildings" fill-extrusion layer) -
 * WallShadowLayer (src/lib/vendor/wallShadowLayer.js, see that file's own
 * attribution/doc comment for provenance) reuses MapLibre's already-
 * uploaded building geometry to draw both in four cheap GPU passes, no
 * shadow maps or extra cameras. Inserted directly after "buildings" in
 * paint order (protomapsStyle.ts's own layer order has "roads-minor"
 * immediately following it, same beforeId installSchoolBuildingHighlight
 * above already anchors to) so the shadow/AO overlay sits under buildings
 * but over every earlier fill (earth, landuse, water) and below every
 * road/label/pin. Only ever called for RouteMap.tsx's own full-screen map
 * - the GPU/VRAM cost (~40MB, a handful of extra draw calls - see that
 * file's own README) isn't worth paying on WaypointPreviewMap's or
 * PlaceCoordinatesModal's much smaller preview boxes.
 *
 * `map.setLight` drives MapLibre's own built-in fill-extrusion shading
 * too (used by the school highlight layer above, which WallShadowLayer
 * doesn't touch - a separate geojson source, not part of the vector
 * "buildings" bucket it walks) - syncing its direction to the shadow's
 * own default `shadowOffset` keeps every extruded building's lighting
 * reading as one consistent scene rather than two independently-lit
 * effects layered on top of each other.
 *
 * Best-effort, not a hard requirement: wrapped in try/catch so a real
 * failure (an unexpectedly different MapLibre internal shape - this
 * reaches into style.sourceCaches/bucket.programConfigurations, neither
 * a documented public API - see wallShadowLayer.js's own doc comment)
 * leaves the map exactly as it already was (buildings still extruded,
 * just flat-shaded) rather than a broken or blank map. Only suppresses
 * the ordinary "buildings" layer's own flat draw
 * (fill-extrusion-opacity: 0) once the replacement has actually been
 * added successfully - never the other way around, which would leave
 * every building invisible if this failed.
 */
export function installBuildingShadows(map: MapLibreMap): void {
  if (!map.getLayer("buildings")) return;
  // Dynamic import, not a static one - this vendored file (see its own
  // doc comment) is plain JS with no type declarations of its own, and
  // deferring the import into this try/catch means a real load/parse
  // failure degrades the same way every other failure path here already
  // does (buildings stay flat-shaded, nothing else breaks) rather than
  // failing the whole module graph this function happens to live in.
  import("./vendor/wallShadowLayer.js")
    .then(({ WallShadowLayer }) => {
      // Tuned down from the vendored file's own defaults (strength 0.5,
      // shadowAlpha 0.35, aoIntensity 0.80) - at full strength the effect
      // reads as distracting clutter on a route map drivers are glancing
      // at, not the subtle depth cue it's meant to be. Each knob here is
      // roughly half its default, and shadowBlur is raised so what's left
      // reads as a soft gradient rather than a hard-edged shape.
      const shadowLayer = new WallShadowLayer({
        buildingsLayerId: "buildings",
        strength: 0.15,
        shadowAlpha: 0.25,
        aoIntensity: 0.25,
        shadowBlur: 2.5,
      }) as CustomLayerInterface & {
        shadowOffset: [number, number];
      };
      map.addLayer(shadowLayer, "roads-minor");
      map.setPaintProperty("buildings", "fill-extrusion-opacity", 0);
      const [sx, sy] = shadowLayer.shadowOffset;
      const azimuthal = ((Math.atan2(-sx, -sy) * 180) / Math.PI + 360) % 360;
      map.setLight({ anchor: "map", position: [1.2, azimuthal, 30], intensity: 0.5 });
    })
    .catch((err: unknown) => {
      console.warn("Couldn't install building shadows:", err);
    });
}
