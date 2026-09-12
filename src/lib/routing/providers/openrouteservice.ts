import type {
  RouteGeometry,
  RouteWaypoint,
  RoutingProvider,
  RoutingResult,
} from "../types";

// Reverted from api.heigit.org back to ORS's own domain - see
// geocode.ts's own doc comment on ORS_GEOCODE_URL for why: every
// request to api.heigit.org came back a bare nginx "404 Not Found"
// (not a real API-level error from the geocoder/directions service
// itself), the signature of a host/path that was never actually
// serving this route. Same fix applies here since this hits the same
// host under a different path.
const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions";

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
