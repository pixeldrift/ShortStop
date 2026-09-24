"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cumulativeDistances, haversineMeters, projectOntoRoute } from "./routeProgress";
import type { LatLon, WaypointProgress } from "./routeProgress";

/** Beyond this, a live fix reads as "not actually on this route" -
 * parked in a lot, on a side street mid-detour, a bad GPS fix - rather
 * than trusted as real progress. ~200 ft; a starting guess, not tuned
 * against real driving data yet. Every consumer of this hook (auto-
 * advance, the time-based prompt scheduler) should no-op while
 * `onRoute` is false instead of acting on a projection that doesn't
 * mean anything. */
const MAX_ON_ROUTE_METERS = 60;

/** How many recent fixes the speed estimate averages over - smooths a
 * single noisy fix rather than letting it swing a speed-derived time-
 * to-maneuver estimate on its own. Kept small (not, say, 30 seconds of
 * history) since a bus's own speed genuinely changes quickly
 * (braking for a stop, accelerating out of a turn) and old fixes would
 * just drag a fresh estimate toward a speed that's no longer true. */
const SPEED_SMOOTHING_FIXES = 4;

export interface LiveRouteProgress {
  /** Null until a first usable GPS fix arrives, or forever if
   * geolocation is denied/unavailable - every consumer already has to
   * handle "no live info yet" the same way the rest of this app
   * treats GPS as optional (RouteMap.tsx's own live position dot,
   * same fallback). */
  liveFix: LatLon | null;
  /** How far along routeLine's own geometry the live fix currently
   * projects to, in meters from the route's start. Null until a fix
   * arrives, or whenever that fix reads too far from the line to
   * trust (see onRoute) - never a stale/last-known value once it's
   * gone bad, so a consumer can't accidentally act on a projection
   * from minutes ago. */
  distanceAlongRoute: number | null;
  /** False whenever the live fix (or the lack of one) can't be
   * trusted as real progress along this route - see
   * MAX_ON_ROUTE_METERS above. */
  onRoute: boolean;
  /** Smoothed current speed in meters/second - averaged over the last
   * few fixes (SPEED_SMOOTHING_FIXES), not the possibly-null/jumpy
   * instantaneous GPS reading alone. Null until enough fixes have
   * arrived to estimate one. Never negative. */
  speedMps: number | null;
  /** Every tracked waypoint's own distance along the route (meters
   * from the start) - recomputed only when routeLine or the waypoint
   * list itself changes, never per GPS fix (a waypoint's own position
   * along a fixed route never moves). */
  waypointDistances: WaypointProgress[];
  /** Live distance from the current position to one specific
   * waypoint, measured along the route (not straight-line) - negative
   * once that waypoint is already behind the live fix. Null whenever
   * distanceAlongRoute itself is null (no fix yet, or off-route). */
  distanceToWaypoint: (key: string) => number | null;
}

/**
 * Watches the browser's own live GPS feed and continuously projects it
 * onto a route's road-following line (routeProgress.ts) - the shared
 * foundation for GPS auto-advance and time-based navigation prompting
 * alike (useNavigationPrompts.ts), both of which need the same two
 * numbers (how far along the route the bus actually is, how fast it's
 * actually going) computed the same way.
 *
 * Deliberately its own independent watchPosition, not shared with
 * RouteMap.tsx's own (used there to draw the live position dot and
 * split the drawn line into traveled/remaining) - consolidating the
 * two into one GPS watch is a reasonable follow-up, but RouteMap.tsx's
 * own watcher is deeply embedded in one large closure-based
 * mountMapLibre function, not something to restructure speculatively.
 *
 * `routeLine`/`waypointDistanceByKey` are read through refs inside the
 * watchPosition callback rather than closed over directly - they can
 * legitimately change after this hook first mounts (a route's own
 * geometry usually finishes loading asynchronously, after this hook's
 * caller has already mounted), and the GPS watch itself should keep
 * running through that without dropping and re-subscribing - a real
 * watchPosition subscription is meant to be long-lived for as long as
 * the screen needs live position, not something to tear down and
 * restart every time upstream data finishes loading.
 *
 * `waypointDistanceByKey` is every real waypoint's own exact distance-
 * along-route, straight from RouteMap.tsx's own RouteGeometryResult
 * (which gets it from the routing provider's own exact per-leg
 * distances, routing/types.ts) - not derived here via a fresh
 * projectOntoRoute search per waypoint the way this hook used to (that
 * search shares the exact same "which pass" ambiguity a route that
 * doubles back can create for any nearest-point search over the
 * returned geometry, routeProgress.ts's own nearestSegmentBearings doc
 * comment has the full story). The live GPS fix itself still needs its
 * own fresh projectOntoRoute call below - a moving point genuinely has
 * no fixed position to look up ahead of time the way a waypoint does.
 */
export function useLiveRouteProgress(
  routeLine: LatLon[],
  waypointDistanceByKey: Map<string, number>,
): LiveRouteProgress {
  const cumulative = useMemo(() => cumulativeDistances(routeLine), [routeLine]);
  const waypointDistances = useMemo<WaypointProgress[]>(
    () =>
      Array.from(waypointDistanceByKey, ([key, distanceAlongRoute]) => ({
        key,
        distanceAlongRoute,
      })),
    [waypointDistanceByKey],
  );

  const routeLineRef = useRef(routeLine);
  const cumulativeRef = useRef(cumulative);
  useEffect(() => {
    routeLineRef.current = routeLine;
    cumulativeRef.current = cumulative;
  }, [routeLine, cumulative]);

  const [liveFix, setLiveFix] = useState<LatLon | null>(null);
  const [distanceAlongRoute, setDistanceAlongRoute] = useState<number | null>(null);
  const [onRoute, setOnRoute] = useState(false);
  const [speedMps, setSpeedMps] = useState<number | null>(null);

  // Recent fixes for the speed rolling average - a ref, not state,
  // since nothing ever renders off this list directly, only the
  // speedMps value derived from it.
  const recentFixesRef = useRef<{ point: LatLon; atMs: number }[]>([]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const point: LatLon = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setLiveFix(point);

        const projection = projectOntoRoute(
          routeLineRef.current,
          cumulativeRef.current,
          point,
        );
        if (projection && projection.distanceFromRoute <= MAX_ON_ROUTE_METERS) {
          setDistanceAlongRoute(projection.distanceAlongRoute);
          setOnRoute(true);
        } else {
          setOnRoute(false);
        }

        // coords.speed (m/s) when the browser actually reports a real
        // one - many devices don't at low speed, or report null
        // outright - falls back to a plain distance/time average over
        // the last few fixes otherwise. Either way, blended with the
        // previous estimate (a simple exponential average) rather
        // than replaced outright, so one noisy fix nudges the
        // estimate instead of swinging it.
        const fixes = recentFixesRef.current;
        fixes.push({ point, atMs: position.timestamp });
        while (fixes.length > SPEED_SMOOTHING_FIXES) fixes.shift();

        const instantSpeed =
          typeof position.coords.speed === "number" && position.coords.speed >= 0
            ? position.coords.speed
            : fixes.length >= 2
              ? (() => {
                  const first = fixes[0];
                  const last = fixes[fixes.length - 1];
                  const elapsedSec = (last.atMs - first.atMs) / 1000;
                  return elapsedSec > 0
                    ? haversineMeters(first.point, last.point) / elapsedSec
                    : null;
                })()
              : null;

        if (instantSpeed != null) {
          setSpeedMps((previous) =>
            previous == null ? instantSpeed : previous * 0.5 + instantSpeed * 0.5,
          );
        }
      },
      (error) => {
        console.warn("Geolocation unavailable:", error.message);
      },
      { enableHighAccuracy: true },
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // Deliberately empty - see this hook's own doc comment above for
    // why the GPS watch itself stays subscribed for this hook's whole
    // mounted lifetime regardless of routeLine/waypoints changing
    // (routeLineRef/cumulativeRef are refs, not reactive values, so
    // the lint rule has nothing to ask for here).
  }, []);

  const distanceToWaypoint = useCallback(
    (key: string): number | null => {
      if (distanceAlongRoute == null) return null;
      const waypoint = waypointDistances.find((w) => w.key === key);
      return waypoint ? waypoint.distanceAlongRoute - distanceAlongRoute : null;
    },
    [distanceAlongRoute, waypointDistances],
  );

  return {
    liveFix,
    distanceAlongRoute,
    onRoute,
    speedMps,
    waypointDistances,
    distanceToWaypoint,
  };
}
