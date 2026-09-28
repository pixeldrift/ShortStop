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

/** Shared "the bus is genuinely moving, not just reading GPS jitter"
 * line - every consumer of a live speed reading (useGpsAutoAdvance's
 * own stop-and-go/distance triggers, useNavigationPrompts' own approach
 * warnings, StepScreen's own "hide the rider box while driving" safety
 * gate) wants the exact same answer to "is this speed real movement,"
 * not each drawing its own slightly different line. ~2 mph. */
export const MOVING_THRESHOLD_MPS = 0.9;

/** How far (route meters, not as the crow flies) a live GPS fix's own
 * projection is allowed to move from the *previous* fix's own known
 * position in one tick - see projectOntoRoute's own
 * searchNearDistance/maxDeviationMeters doc comment (routeProgress.ts)
 * for why bounding this search matters at all: a route that loops back
 * on itself (a driven loop around a block, exactly the shape a real
 * test drive is likely to take) can otherwise let a live fix snap onto
 * the wrong pass the instant it's geometrically closer. Generous enough
 * to cover ordinary watchPosition timing (fixes every ~1-5s under
 * enableHighAccuracy) even at a speed well past anything this app's own
 * neighborhood-street routes see, plus real slack for an occasional gap
 * between fixes - nowhere near enough to reach a route's own later re-
 * crossing of the same real corner, which is real additional driving
 * distance away, not another couple hundred meters of the same
 * stretch. */
const MAX_LIVE_FIX_JUMP_METERS = 250;

/** How many recent fixes the speed estimate averages over - smooths a
 * single noisy fix rather than letting it swing a speed-derived time-
 * to-maneuver estimate on its own. Kept small (not, say, 30 seconds of
 * history) since a bus's own speed genuinely changes quickly
 * (braking for a stop, accelerating out of a turn) and old fixes would
 * just drag a fresh estimate toward a speed that's no longer true. */
const SPEED_SMOOTHING_FIXES = 4;

/** Distinguishes a real, physically-possible jump in `distanceAlongRoute`
 * (a genuine gap between fixes - a phone that slept, a tunnel) from an
 * implausible one-tick swing (GPS jitter briefly projecting the fix onto
 * a nearby-but-wrong stretch of the line) - the "250ft to 40ft between
 * two ordinary ticks" symptom smoothDistanceAlongRoute (below) exists to
 * damp. ~67 mph - generously past anything this app's own neighborhood-
 * street/county-road routes actually see, so no real driving ever gets
 * mistaken for an implausible jump. */
const MAX_PLAUSIBLE_SPEED_MPS = 30;
/** Only a jump inside this short a window even gets checked against
 * MAX_PLAUSIBLE_SPEED_MPS above - a real gap this long (10+ seconds)
 * easily covers real distance far past what a single ordinary tick
 * could, so it's trusted outright rather than damped, same reasoning
 * MAX_LIVE_FIX_JUMP_METERS' own doc comment gives for not trying to
 * bound a genuine gap the same way it bounds ordinary tick-to-tick
 * noise. */
const MIN_SMOOTHING_WINDOW_SEC = 10;
/** How much of an implausible jump this tick actually trusts - the rest
 * catches up over the next few, presumably more consistent fixes,
 * rather than either snapping straight to a possibly-bad value or
 * ignoring it outright (a real, fast, sustained change - not just one
 * noisy fix - still gets there, just smoothed in rather than jumped
 * to). */
const IMPLAUSIBLE_JUMP_BLEND = 0.3;

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
   * waypoint (its own NavigationStep.id - WaypointProgress's own doc
   * comment, routeProgress.ts, has why this is a stepId and not the
   * shared waypointKey cache text), measured along the route (not
   * straight-line) - negative once that waypoint is already behind the
   * live fix. Null whenever distanceAlongRoute itself is null (no fix
   * yet, or off-route). */
  distanceToWaypoint: (stepId: number) => number | null;
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
  waypointDistanceByKey: Map<number, number>,
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

  // Recent fixes for the speed rolling average, once a real route to
  // project onto exists - route-distance, the same basis
  // distanceToWaypoint downstream already reports remaining-distance
  // in, not raw lat/lon, so a fallback speed estimate and a maneuver's
  // own remaining distance never disagree about what "how far" means
  // the way this hook's own predecessor did (a straight-line gap
  // between two fixes reads shorter than the real road distance on any
  // curved stretch, understating speed and so overstating time-to-
  // maneuver). A ref, not state, since nothing ever renders off this
  // list directly, only the speedMps value derived from it.
  const recentRouteFixesRef = useRef<{ distanceAlongRoute: number; atMs: number }[]>([]);
  // The one fallback still worth keeping in plain lat/lon - a
  // genuinely route-less moment (road geometry hasn't loaded yet at
  // all, so there's no route-distance value to compute from either)
  // still wants *some* rough speed estimate, and a straight-line one is
  // far better than none for that narrow window.
  const recentRawFixesRef = useRef<{ point: LatLon; atMs: number }[]>([]);
  // The last fix's own real (smoothed - see smoothDistanceAlongRoute
  // below) distanceAlongRoute - read by the very next fix to bound its
  // own search (MAX_LIVE_FIX_JUMP_METERS above), a ref rather than the
  // exposed `distanceAlongRoute` state since it needs to stay set even
  // through a fix that comes back untrusted (off-route or too far to
  // project confidently) - see its own update site below for why that
  // distinction matters. Anchored to the *smoothed* value, not
  // whatever a single noisy fix's own raw projection happened to read,
  // so one implausible jump doesn't also bias where the *next* fix's
  // own search looks - self-correcting back toward wherever the bus is
  // actually trusted to be, rather than compounding. Null until the
  // first successful projection, same as `distanceAlongRoute` state
  // itself.
  const lastKnownDistanceRef = useRef<number | null>(null);
  // smoothDistanceAlongRoute's own last trusted output/timestamp - see
  // that function's own doc comment below.
  const lastTrustedDistanceRef = useRef<number | null>(null);
  const lastTrustedAtMsRef = useRef<number | null>(null);

  /** Damps an implausible one-tick swing in a live fix's own raw
   * projected distanceAlongRoute (GPS jitter briefly projecting near a
   * nearby-but-wrong stretch of the line - the "250ft to 40ft between
   * two ordinary ticks" symptom) rather than reporting it outright,
   * while still passing a genuinely large, real change straight
   * through once it's happened consistently across a few fixes (each
   * one only ever blends IMPLAUSIBLE_JUMP_BLEND of the way toward a
   * flagged jump, but a *sustained* fast change keeps re-triggering
   * that same partial blend tick after tick, catching up within a
   * couple of fixes rather than being permanently capped). A real gap
   * of MIN_SMOOTHING_WINDOW_SEC or more since the last trusted fix
   * (the phone slept, a tunnel) is trusted outright instead - there's
   * no jitter theory that explains a gap that long, only a real one. */
  function smoothDistanceAlongRoute(rawDistance: number, nowMs: number): number {
    const lastDistance = lastTrustedDistanceRef.current;
    const lastAtMs = lastTrustedAtMsRef.current;
    let smoothed = rawDistance;
    if (lastDistance != null && lastAtMs != null) {
      const elapsedSec = (nowMs - lastAtMs) / 1000;
      const impliedSpeed =
        elapsedSec > 0 ? Math.abs(rawDistance - lastDistance) / elapsedSec : Infinity;
      if (impliedSpeed > MAX_PLAUSIBLE_SPEED_MPS && elapsedSec < MIN_SMOOTHING_WINDOW_SEC) {
        smoothed = lastDistance + (rawDistance - lastDistance) * IMPLAUSIBLE_JUMP_BLEND;
      }
    }
    lastTrustedDistanceRef.current = smoothed;
    lastTrustedAtMsRef.current = nowMs;
    return smoothed;
  }

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const point: LatLon = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setLiveFix(point);

        // Bounded to near the previous fix's own position when one
        // exists (see projectOntoRoute's own searchNearDistance/
        // maxDeviationMeters doc comment for why) - falls back to an
        // unbounded search whenever there's no prior position to bound
        // against yet (the very first fix), or the bounded search came
        // up with nothing at all (a real gap bigger than
        // MAX_LIVE_FIX_JUMP_METERS since the last one - the phone was
        // asleep, a tunnel, whatever), rather than reporting no
        // progress at all over a gap the bound itself was never meant
        // to cover.
        const lastKnown = lastKnownDistanceRef.current;
        const projection =
          (lastKnown != null &&
            projectOntoRoute(
              routeLineRef.current,
              cumulativeRef.current,
              point,
              lastKnown,
              MAX_LIVE_FIX_JUMP_METERS,
            )) ||
          projectOntoRoute(routeLineRef.current, cumulativeRef.current, point);

        if (projection) {
          // Smoothed before anchoring the *next* fix's own bounded
          // search or feeding recentRouteFixesRef below - see
          // smoothDistanceAlongRoute's own doc comment above for why
          // both want the trusted value, not a single fix's own
          // possibly-noisy raw one. Anchored/collected regardless of
          // whether this fix passes the onRoute trust threshold below -
          // even an off-route fix (briefly parked, weak signal) still
          // projects somewhere near the bus's own real neighborhood on
          // the route, and keeping the anchor fresh is what lets the
          // next good fix self-heal instead of searching near a
          // position that's gone stale.
          const smoothedDistance = smoothDistanceAlongRoute(
            projection.distanceAlongRoute,
            position.timestamp,
          );
          lastKnownDistanceRef.current = smoothedDistance;
          const routeFixes = recentRouteFixesRef.current;
          routeFixes.push({ distanceAlongRoute: smoothedDistance, atMs: position.timestamp });
          while (routeFixes.length > SPEED_SMOOTHING_FIXES) routeFixes.shift();

          if (projection.distanceFromRoute <= MAX_ON_ROUTE_METERS) {
            setDistanceAlongRoute(smoothedDistance);
            setOnRoute(true);
          } else {
            setOnRoute(false);
          }
        } else {
          setOnRoute(false);
        }

        const rawFixes = recentRawFixesRef.current;
        rawFixes.push({ point, atMs: position.timestamp });
        while (rawFixes.length > SPEED_SMOOTHING_FIXES) rawFixes.shift();

        // coords.speed (m/s) when the browser actually reports a real
        // one - many devices don't at low speed, or report null
        // outright - falls back to a route-distance delta over the
        // last few fixes (the same basis distanceToWaypoint downstream
        // already uses - see recentRouteFixesRef's own doc comment
        // above), or, only while there's no route geometry to project
        // onto at all yet, a plain straight-line distance/time average
        // instead. Either way, blended with the previous estimate (a
        // simple exponential average) rather than replaced outright, so
        // one noisy fix nudges the estimate instead of swinging it.
        const routeSpeed =
          recentRouteFixesRef.current.length >= 2
            ? (() => {
                const fixes = recentRouteFixesRef.current;
                const first = fixes[0];
                const last = fixes[fixes.length - 1];
                const elapsedSec = (last.atMs - first.atMs) / 1000;
                return elapsedSec > 0
                  ? Math.abs(last.distanceAlongRoute - first.distanceAlongRoute) / elapsedSec
                  : null;
              })()
            : null;
        const rawSpeed =
          routeSpeed == null && rawFixes.length >= 2
            ? (() => {
                const first = rawFixes[0];
                const last = rawFixes[rawFixes.length - 1];
                const elapsedSec = (last.atMs - first.atMs) / 1000;
                return elapsedSec > 0 ? haversineMeters(first.point, last.point) / elapsedSec : null;
              })()
            : null;

        const instantSpeed =
          typeof position.coords.speed === "number" && position.coords.speed >= 0
            ? position.coords.speed
            : (routeSpeed ?? rawSpeed);

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
    (stepId: number): number | null => {
      if (distanceAlongRoute == null) return null;
      const waypoint = waypointDistances.find((w) => w.key === stepId);
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
