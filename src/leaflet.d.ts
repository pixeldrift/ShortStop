// Augments @types/leaflet with the extra L.map() options and the
// setBearing() method leaflet-rotate patches onto L.Map at runtime
// (see its own leaflet-rotate.d.ts, and the side-effect import in
// RouteMap.tsx) - it ships no types of its own, so without this,
// RouteMap.tsx's `rotate`/`bearing`/`rotateControl` options and its
// `map.setBearing(...)` call wouldn't typecheck.
//
// The `export {}` below is required, not decorative: without a
// top-level import/export of its own, TypeScript treats this whole
// file as a global script rather than a module, and a bare `declare
// module "leaflet" { ... }` in a script file REPLACES @types/leaflet's
// real declarations instead of merging with them - every plain
// `L.map(...)`/`L.marker(...)` call elsewhere would stop typechecking.
export {};

declare module "leaflet" {
  interface MapOptions {
    /** Enables the rotation machinery leaflet-rotate patches onto this
     * map - required before `bearing`/setBearing have any effect. */
    rotate?: boolean;
    /** Initial heading in degrees (0 = north-up), only meaningful with
     * `rotate: true`. */
    bearing?: number;
    /** The built-in compass-dial control widget leaflet-rotate would
     * otherwise add (defaults to on) - false since this app drives
     * bearing itself (direction of travel), not a manual control. */
    rotateControl?: boolean | Record<string, unknown>;
  }

  interface Map {
    /** Rotates the map to this heading (degrees, 0 = north-up) -
     * added by leaflet-rotate, not part of stock Leaflet. */
    setBearing(theta: number): this;
  }
}
