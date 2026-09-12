import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

/**
 * A minimal MapLibre style for Protomaps' own open basemap vector-tile
 * schema (https://docs.protomaps.com/basemaps/layers - the same schema
 * the extract mapEngine.ts's own doc comment walks through generating).
 * Roads, water, parks, and building footprints only - deliberately no
 * text labels (street/city names) yet, since those need a `glyphs`
 * font-PBF server of their own, a separate self-hosting concern from
 * the PMTiles basemap file itself (see README's "Next steps").
 *
 * Kept intentionally plain/legible over decorative - this is a
 * from-scratch style, not a port of CARTO Voyager's own look (the
 * raster basemap this replaces), so there was nothing to match pixel
 * for pixel.
 */
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
    ],
  } as unknown as StyleSpecification;
}
