import type {
  RouteGeometry,
  RouteWaypoint,
  RoutingProvider,
  RoutingResult,
  RoutingStep,
} from "../types";

// Moved to api.heigit.org, same as geocode.ts's own ORS_GEOCODE_URL -
// api.openrouteservice.org's quota was cut to 10% as of 2026-08-27 and
// the host is being fully shut off 2026-09-28, so staying on it is no
// longer optional. Unlike geocoding (a separate Pelias service, at its
// own api.heigit.org/pelias/v1/search path - see ORS_GEOCODE_URL's own
// doc comment for why that one came back a 404 under the general
// pattern below), directions/isochrones/matrix are the actual
// openrouteservice engine HeiGIT documents under its general
// "api.heigit.org/<service>/<version>/..." pattern - this is that
// pattern applied to directions specifically. Not yet confirmed live
// against a real ORS_API_KEY (this repo's own dev sandbox can't reach
// api.heigit.org to test it) - verify this actually resolves before
// relying on it, same caution ORS_GEOCODE_URL's own history already
// went through once.
const ORS_DIRECTIONS_URL = "https://api.heigit.org/openrouteservice/v2/directions";

// ORS has no dedicated school-bus profile - "driving-car" is the
// closest general-vehicle one, and it's enough for this app's actual
// need (following real streets/turn restrictions the way a bus's own
// path would, not enforcing a bus's specific height/weight limits).
// "driving-hgv" is the other real candidate if a bus's own size
// restrictions ever need modeling, but that needs vehicle-dimension
// parameters this app doesn't collect today.
const PROFILE = "driving-car";

// ORS's own maneuver-type codes (its own "instructions" schema,
// documented alongside the Directions API) - the numbers this app's
// own RoutingStep.type carries straight through unchanged. Recorded
// here, not re-derived at every call site, since EditRouteScreen.tsx's
// own Autoroute feature is the one real consumer that needs to turn a
// step back into one of this app's own action words (Left/Right/
// Continue/...):
//   0 turn left        1 turn right       2 sharp left
//   3 sharp right       4 slight left      5 slight right
//   6 continue straight 7 enter roundabout 8 exit roundabout
//   9 u-turn           10 arrive (goal)   11 depart
//  12 keep left        13 keep right
interface OrsDirectionsStep {
  type: number;
  instruction: string;
  name: string;
  // [startIndex, endIndex] into this segment's own feature.geometry.
  // coordinates - only the start actually matters here (where the
  // maneuver itself happens), see stepsFromFeature below.
  way_points: [number, number];
}

interface OrsDirectionsFeature {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    summary?: { distance: number; duration: number };
    // One entry per leg between two consecutive input coordinates -
    // Autoroute (this app's one real caller today) only ever requests
    // exactly two coordinates, so this is always a single-element
    // array in practice, but every leg's own steps are still flattened
    // together (stepsFromFeature below) rather than assuming that.
    segments?: { steps: OrsDirectionsStep[] }[];
  };
}

interface OrsDirectionsResponse {
  features: OrsDirectionsFeature[];
}

// Flattens every segment's own steps into one trip-ordered list,
// resolving each step's own real-world point from its `way_points`
// start index against this same feature's geometry - ORS reports a
// step's location as a range into the line, never a bare coordinate of
// its own, so this is the one place that lookup has to happen. ORS's
// "-" placeholder for "no street name available" (an unmarked lot, an
// unnamed connector) is normalized to "" here, once, rather than every
// later consumer having to know to check for that literal string.
function stepsFromFeature(feature: OrsDirectionsFeature): RoutingStep[] {
  const coordinates = feature.geometry.coordinates;
  return (feature.properties.segments ?? []).flatMap((segment) =>
    segment.steps.map(
      (step): RoutingStep => ({
        type: step.type,
        instruction: step.instruction,
        name: step.name === "-" ? "" : step.name,
        point: coordinates[step.way_points[0]] as RoutingStep["point"],
      }),
    ),
  );
}

/**
 * Road-following route geometry via OpenRouteService's Directions API -
 * the same ORS_API_KEY this app already spends on geocoding (see
 * src/lib/geocode.ts's own doc comment on why ORS covers both with one
 * key instead of two separate external dependencies). Only ever called
 * server-side (src/app/api/route-geometry/route.ts) - same "stays a
 * server-only env var, never shipped to the browser" reasoning
 * src/app/api/geocode/route.ts already documents for this same key.
 */
export function openRouteServiceProvider(apiKey: string): RoutingProvider {
  return {
    async route(waypoints: RouteWaypoint[]): Promise<RoutingResult> {
      if (waypoints.length < 2) {
        throw new Error(
          "At least two waypoints are required to compute a route.",
        );
      }

      const res = await fetch(`${ORS_DIRECTIONS_URL}/${PROFILE}/geojson`, {
        method: "POST",
        headers: {
          // ORS's own documented header form for this endpoint - the
          // raw key, not a "Bearer " prefix.
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: waypoints.map((w): [number, number] => [w.lon, w.lat]),
          // Explicit rather than relying on ORS's own default (which
          // is already true) - this is what actually puts `segments`
          // (and so `steps`, below) in the response at all; leaving it
          // to the default would work today but silently stop
          // reporting steps the moment ORS's own default ever changed.
          instructions: true,
          // ORS's own default ("recommended," a time-weighted blend)
          // can pick a route that's genuinely longer in distance when
          // one street along the direct path is modeled as slow enough
          // (a low road class, a low tagged speed) that its time-cost
          // estimate loses to a longer, faster-classed detour - even
          // between two waypoints one street-length apart. Confirmed
          // for real on a route that consistently backtracked down one
          // subdivision street instead of continuing onto the very one
          // its own turn-by-turn instructions named, resolved every
          // time by forcing a shortest-distance leg through an extra
          // via-point - which only papers over one specific leg an
          // admin happened to notice, not the underlying preference
          // that can misfire on any leg of any route. Every route this
          // app ever computes is already short, local, subdivision-
          // street travel end to end - there's no highway-vs-side-
          // street tradeoff "fastest" is meant to solve here, so the
          // shortest real distance between two consecutive stops is
          // the correct answer far more often than a time-weighted
          // detour is.
          preference: "shortest",
        }),
      });

      if (!res.ok) {
        // Best-effort - ORS's own error body usually says *why*
        // ("quota exceeded," an invalid key, unreachable coordinates),
        // which a bare status/statusText doesn't distinguish, same
        // reasoning geocode.ts's own error path already documents.
        const detail = await res.text().catch(() => "");
        throw new Error(
          `OpenRouteService directions returned ${res.status} ${res.statusText}` +
            (detail ? `: ${detail}` : ""),
        );
      }

      const body = (await res.json()) as OrsDirectionsResponse;
      const [feature] = body.features;
      if (!feature) {
        throw new Error(
          "OpenRouteService returned no route for these waypoints.",
        );
      }

      const geometry: RouteGeometry = {
        type: "LineString",
        coordinates: feature.geometry
          .coordinates as RouteGeometry["coordinates"],
      };

      return {
        geometry,
        distanceMeters: feature.properties.summary?.distance,
        durationSeconds: feature.properties.summary?.duration,
        steps: stepsFromFeature(feature),
        provider: "openrouteservice",
      };
    },
  };
}
