import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

/**
 * A minimal MapLibre style for Protomaps' own open basemap vector-tile
 * schema (https://docs.protomaps.com/basemaps/layers - the same schema
 * the extract mapEngine.ts's own doc comment walks through generating).
 * Roads, water, parks, building footprints, and road-name labels
 * (`roads-major-label`/`roads-minor-label` below), always visible - an
 * earlier version of RouteMap.tsx had a runtime toggle for these two
 * layers' own `visibility`, removed since a driver toggling road-name
 * labels on/off never actually proved useful.
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
        // The real extract (public/maps/middle-tennessee.pmtiles) only
        // ever has tiles through z15 (PMTiles' own v3 header, byte 101 -
        // checked directly against the file, not assumed from the
        // schema docs) - Protomaps' basemap builder stops generalizing
        // new detail past that and expects the *renderer* to overzoom
        // the z15 tile for anything deeper, not the archive to carry
        // real z16+ tiles of its own. Declaring that here is what
        // actually makes that overzoom happen: MapLibre only stretches
        // a source's own deepest tile past `maxzoom` when the source
        // says where that deepest tile is - left unset, it defaults to
        // requesting genuinely deeper zooms straight from the pmtiles://
        // protocol handler instead, which simply has nothing to hand
        // back for a zoom the archive never wrote (confirmed directly -
        // a raw z18 PMTiles.getZxy() call over this exact file returns
        // undefined), so every layer below gated to open only past z15
        // (buildings-housenumber-label, currently the only one) never
        // painted anything at all, at any zoom, regardless of its own
        // minzoom.
        maxzoom: 15,
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
          ["in", ["get", "kind"], ["literal", ["highway", "major_road", "rail"]]],
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
      // A real railroad track, drawn deliberately unlike any road - a
      // brown dashed line, not this style's usual white/yellow solid
      // fill - so a crossing reads as its own distinct kind of hazard on
      // the map, not just another minor road (which "kind": "rail" would
      // otherwise fall into, sharing roads-minor's own filter above,
      // rendered in the exact same white as a driveway). Painted above
      // both road line layers (later in this array = on top) so a track
      // crossing a road stays visible right at the crossing rather than
      // disappearing under the road's own fill; still below every label
      // layer, same stacking every other line in this style already
      // keeps. Schema/kind value per Protomaps' own basemap layer docs
      // (docs.protomaps.com/basemaps/layers) - "roads" is the one
      // source-layer this extract's own vector_layers metadata actually
      // carries a rail feature in, not a separate "transit" layer some
      // other vector-tile schemas use.
      {
        id: "rail",
        type: "line" as const,
        source,
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "rail"],
        layout: { "line-cap": "butt" as const, "line-join": "round" as const },
        paint: {
          "line-color": "#7c4a1e",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 18, 3],
          "line-dasharray": [2, 2],
        },
      },
      // Street-name labels, always visible (see this file's own top
      // doc comment). Split major/minor (like the line layers above)
      // so major-road names show up first while zooming in, minor ones
      // only once the map's actually zoomed enough that MapLibre's own
      // built-in collision detection can space them out without a
      // cluttered jumble.
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
          ["in", ["get", "kind"], ["literal", ["highway", "major_road", "rail"]]],
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
      // A school's own dot, drawn under its label below - visible well
      // before the label's own text can be (a driver/admin scanning a
      // zoomed-out overview should still see roughly where a school
      // sits, not just once zoomed in enough to read its name). Same
      // blue schoolMarkerHtml already uses for this route's own school
      // pin (RouteMap.tsx), so a school reads as the same "this matters"
      // color everywhere in the app, not just at the one school this
      // route actually visits - every other school nearby is real
      // map context, not a route waypoint, so it's a plain dot rather
      // than that pin's own teardrop glyph.
      {
        id: "pois-school",
        type: "circle" as const,
        source,
        "source-layer": "pois",
        filter: ["==", ["get", "kind"], "school"],
        minzoom: 11,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 18, 6],
          "circle-color": "#2563eb",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      },
      // A school's own name - the one basemap label in this style
      // that's deliberately more prominent than a street name
      // (roads-major-label just above), since a school is the single
      // most important thing on this map for an app about driving kids
      // to and from one. Same minzoom as its own dot above so the two
      // always appear together.
      {
        id: "pois-school-label",
        type: "symbol" as const,
        source,
        "source-layer": "pois",
        filter: ["==", ["get", "kind"], "school"],
        minzoom: 11,
        layout: {
          visibility: "visible" as const,
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 12, 18, 15],
          "text-anchor": "top" as const,
          "text-offset": [0, 0.6],
        },
        paint: {
          "text-color": "#1d4ed8",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      },
      // A building's own street number - real detail, but only once
      // zoomed in close enough that it's actually useful (matching a
      // physical house against the route on the ground, not reading a
      // whole neighborhood's numbers off an overview). "address" is
      // this schema's own kind for a standalone address point, distinct
      // from a building's own footprint (which shares this same
      // source-layer but renders through the plain "buildings" fill
      // above, itself only from minzoom 15) - a symbol layer only ever
      // draws the point geometries here regardless, but the explicit
      // filter keeps this from ever matching a stray polygon feature
      // that happened to carry the same field. minzoom 17, not some
      // deeper zoom - matches RouteMap.tsx's own STREET_ZOOM, the
      // camera zoom driving mode already flies to for every step, so a
      // driver already at street level sees these without a further
      // manual pinch. (The source's own maxzoom above, not this value,
      // is what previously kept these from ever painting at all - see
      // its own doc comment.)
      {
        id: "buildings-housenumber-label",
        type: "symbol" as const,
        source,
        "source-layer": "buildings",
        filter: ["==", ["get", "kind"], "address"],
        minzoom: 17,
        layout: {
          visibility: "visible" as const,
          "text-field": ["get", "addr_housenumber"],
          "text-font": LABEL_FONT,
          "text-size": 10,
        },
        paint: {
          "text-color": "#78716c",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      },
    ],
  } as unknown as StyleSpecification;
}
