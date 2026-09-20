import type {
  RouteGeometry,
  RouteWaypoint,
  RoutingProvider,
  RoutingResult,
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

interface OrsDirectionsFeature {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { summary?: { distance: number; duration: number } };
}

interface OrsDirectionsResponse {
  features: OrsDirectionsFeature[];
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
        provider: "openrouteservice",
      };
    },
  };
}
