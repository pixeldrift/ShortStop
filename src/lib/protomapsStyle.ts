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
 * for pixel. Buildings extrude into real 3D volumes (see the
 * "buildings" layer below) and the driving map carries a default
 * camera pitch (RouteMap.tsx's own DRIVING_PITCH) - a richer palette
 * was tried alongside those two, but read as gross rather than better,
 * so only the 3D shape stuck around.
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

/** Every color this style paints with, in one place - the MapLibre
 * equivalent of tweaking Mapbox Standard's own runtime `config.basemap`
 * (colorBuildings/colorGreenspace/etc.), just resolved at build time
 * instead of the browser's, since MapLibre has no such runtime config
 * API of its own. roadsMajorLabelHalo intentionally matches roadsMajor
 * itself - that label's own "symbol-placement": "line" (below) draws it
 * running right along the road, so a matching halo reads as part of the
 * road rather than a separate white patch on top of it. roadsMinorLabel
 * has no such placement (plain point, more often beside the road than
 * on it), so its halo stays the universal light "labelHalo" instead of
 * pairing with roadsMinor's own line color. */
const BASEMAP_COLORS = {
  land: "#f4f1ea",
  park: "#d7e8d4",
  water: "#a7cbe8",
  buildings: "#e3ddd0",
  roadsMinor: "#a8a29e",
  roadsMajor: "#f6c453",
  rail: "#7c4a1e",
  roadsMajorLabelText: "#5c4a1a",
  roadsMajorLabelHalo: "#f6c453",
  roadsMinorLabelText: "#57534e",
  labelHalo: "#ffffff",
  school: "#2563eb",
  schoolLabelText: "#1d4ed8",
  housenumberLabelText: "#78716c",
} as const;
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
        paint: { "background-color": BASEMAP_COLORS.land },
      },
      {
        id: "earth",
        type: "fill" as const,
        source,
        "source-layer": "earth",
        paint: { "fill-color": BASEMAP_COLORS.land },
      },
      {
        id: "landuse-park",
        type: "fill" as const,
        source,
        "source-layer": "landuse",
        filter: ["==", ["get", "kind"], "park"],
        paint: { "fill-color": BASEMAP_COLORS.park },
      },
      // "water" (the source-layer) mixes real polygon water bodies
      // (lakes, ponds, pools) with linear waterways (rivers/creeks,
      // e.g. Stewart Creek here - a LineString, `kind: "river"`) - the
      // *same* source-layer, distinguished only by each feature's own
      // geometry type. A plain fill layer with no filter doesn't check
      // that: MapLibre's fill bucket treats every geometry it's handed
      // as a polygon ring regardless of its real type, so a river's own
      // long, winding *line* got implicitly closed edge-to-edge and
      // filled - a wildly wrong, self-intersecting "lake" shape cutting
      // across whatever neighborhood the creek actually winds through,
      // not a rendering glitch specific to this app's own style, just
      // this fill layer never having excluded the wrong geometry type.
      // `["geometry-type"]` filters on the real MVT type rather than
      // guessing at every possible non-polygon `kind` value there might
      // be, so this stays correct even for a `kind` this extract
      // doesn't happen to carry yet.
      {
        id: "water",
        type: "fill" as const,
        source,
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": BASEMAP_COLORS.water },
      },
      // The linear half of that same source-layer, drawn as its own
      // actual line rather than dropped - a real creek/river still
      // matters as map context (a route that crosses one, say), it just
      // was never safe to hand to the fill layer above.
      {
        id: "water-line",
        type: "line" as const,
        source,
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round" as const, "line-join": "round" as const },
        paint: {
          "line-color": BASEMAP_COLORS.water,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 18, 4],
        },
      },
      // Real 3D building footprints (fill-extrusion, not a flat fill) -
      // `height`/`min_height` are genuine per-building fields this
      // extract's own vector_layers metadata carries (meters, straight
      // from OSM's own building:height/height tags where mapped ones
      // exist) - coalesced to a flat, modest default for the (large
      // majority of) buildings OSM never recorded a real height for, so
      // every footprint still extrudes into *something* rather than
      // only the few with real data standing out as the sole 3D shapes
      // in an otherwise flat field. Reads identically to the plain fill
      // this replaces at pitch 0 (WaypointPreviewMap/PlaceCoordinatesModal,
      // and RouteMap's own overview mode - a fill-extrusion's top face is
      // all a straight-down camera ever sees), and only actually shows
      // real walls once pitched (RouteMap's own driving mode - see
      // DRIVING_PITCH, RouteMap.tsx). installSchoolBuildingHighlight
      // (mapEngine.ts) queries this same layer id and redraws whichever
      // footprint it finds as its own matching fill-extrusion, so the
      // highlighted school building extrudes too, not just this layer's
      // own ordinary buildings.
      {
        id: "buildings",
        type: "fill-extrusion" as const,
        source,
        "source-layer": "buildings",
        minzoom: 15,
        paint: {
          "fill-extrusion-color": BASEMAP_COLORS.buildings,
          "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
          "fill-extrusion-opacity": 0.8,
        },
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
          "line-color": BASEMAP_COLORS.roadsMinor,
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
          "line-color": BASEMAP_COLORS.roadsMajor,
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
          "line-color": BASEMAP_COLORS.rail,
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
          "text-color": BASEMAP_COLORS.roadsMajorLabelText,
          "text-halo-color": BASEMAP_COLORS.roadsMajorLabelHalo,
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
          "text-color": BASEMAP_COLORS.roadsMinorLabelText,
          "text-halo-color": BASEMAP_COLORS.labelHalo,
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
          "circle-color": BASEMAP_COLORS.school,
          "circle-stroke-color": BASEMAP_COLORS.labelHalo,
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
          "text-color": BASEMAP_COLORS.schoolLabelText,
          "text-halo-color": BASEMAP_COLORS.labelHalo,
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
          "text-color": BASEMAP_COLORS.housenumberLabelText,
          "text-halo-color": BASEMAP_COLORS.labelHalo,
          "text-halo-width": 1,
        },
      },
    ],
  } as unknown as StyleSpecification;
}
