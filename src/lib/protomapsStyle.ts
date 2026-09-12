import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

/**
 * A minimal MapLibre style for Protomaps' own open basemap vector-tile
 * schema (https://docs.protomaps.com/basemaps/layers - the same schema
 * the extract mapEngine.ts's own doc comment walks through generating).
 * Roads, water, parks, building footprints, and road-name labels
 * (`roads-major-label`/`roads-minor-label` below) - the label layers'
 * own `visibility` layout property is what RouteMap.tsx's street-names
 * toggle flips at runtime (map.setLayoutProperty), not a separate
 * style swap.
 *
 * Kept intentionally plain/legible over decorative - this is a
 * from-scratch style, not a port of CARTO Voyager's own look (the
 * raster basemap this replaces), so there was nothing to match pixel
 * for pixel.
 */
// Self-hosted (public/fonts/Noto Sans Regular/*.pbf, one file per
// 256-codepoint range) rather than Protomaps' own hosted
// basemaps-assets copy (protomaps.github.io/basemaps-assets/fonts/...)
// - same "no runtime dependency on a host this app doesn't control"
// reasoning as the PMTiles basemap file itself (mapEngine.ts's own doc
// comment). SIL Open Font License (public/fonts/OFL.txt) - freely
// redistributable, no attribution required. Only "Regular" is copied
// in (not the Medium/Italic variants basemaps-assets also has) since
// nothing in this style needs a second weight yet.
const GLYPHS_URL = "/fonts/{fontstack}/{range}.pbf";
const LABEL_FONT = ["Noto Sans Regular"];
// The `as unknown as StyleSpecification` cast on the return below is
// deliberate, not a shortcut around a real type error: every literal
// here (each layer's own "type", each filter's own operator strings)
// is a real, valid MapLibre style value, but TypeScript's own inferred
// type for a plain object literal widens `"fill"`/`"=="`/etc. to `string`
// well before it ever reaches StyleSpecification's own (deeply
// discriminated-union) shape, and re-annotating every single field
// with its own `as const` just to satisfy that inference isn't worth
// the noise for one hand-authored style object.
export function protomapsStyle(pmtilesUrl: string): StyleSpecification {
  const source = "basemap";
  return {
    version: 8 as const,
    glyphs: GLYPHS_URL,
    sources: {
      [source]: {
        type: "vector" as const,
        url: `pmtiles://${pmtilesUrl}`,
      },
    },
    layers: [
      {
        id: "background",
        type: "background" as const,
        paint: { "background-color": "#f4f1ea" },
      },
      {
        id: "earth",
        type: "fill" as const,
        source,
        "source-layer": "earth",
        paint: { "fill-color": "#f4f1ea" },
      },
      {
        id: "landuse-park",
        type: "fill" as const,
        source,
        "source-layer": "landuse",
        filter: ["==", ["get", "kind"], "park"],
        paint: { "fill-color": "#d7e8d4" },
      },
      {
        id: "water",
        type: "fill" as const,
        source,
        "source-layer": "water",
        paint: { "fill-color": "#a7cbe8" },
      },
      {
        id: "buildings",
        type: "fill" as const,
        source,
        "source-layer": "buildings",
        minzoom: 15,
        paint: { "fill-color": "#e3ddd0", "fill-opacity": 0.8 },
      },
      {
        id: "roads-minor",
        type: "line" as const,
        source,
        "source-layer": "roads",
        filter: [
          "!",
          ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        ],
        layout: { "line-cap": "round" as const, "line-join": "round" as const },
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 18, 6],
        },
      },
      {
        id: "roads-major",
        type: "line" as const,
        source,
        "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        layout: { "line-cap": "round" as const, "line-join": "round" as const },
        paint: {
          "line-color": "#f6c453",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 18, 10],
        },
      },
      // Street-name labels - RouteMap.tsx's own toggle control flips
      // `visibility` on these two at runtime (map.setLayoutProperty),
      // rather than there being a second style to swap to. Split
      // major/minor (like the line layers above) so major-road names
      // show up first while zooming in, minor ones only once the map's
      // actually zoomed enough that MapLibre's own built-in collision
      // detection can space them out without a cluttered jumble.
      {
        id: "roads-major-label",
        type: "symbol" as const,
        source,
        "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        minzoom: 10,
        layout: {
          visibility: "visible" as const,
          "symbol-placement": "line" as const,
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 18, 13],
        },
        paint: {
          "text-color": "#5c4a1a",
          "text-halo-color": "#f6c453",
          "text-halo-width": 1,
        },
      },
      {
        id: "roads-minor-label",
        type: "symbol" as const,
        source,
        "source-layer": "roads",
        filter: [
          "!",
          ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        ],
        minzoom: 14,
        layout: {
          visibility: "visible" as const,
          "symbol-placement": "line" as const,
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 11,
        },
        paint: {
          "text-color": "#57534e",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      },
    ],
  } as unknown as StyleSpecification;
}
