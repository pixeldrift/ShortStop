"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Tracks which expected riders have boarded at each stop, plus any
 * unexpected riders added on the spot. Lives above the step screen (in
 * RouteApp) so it survives navigating back and forth between stops, and
 * so the running onboard total stays visible throughout the whole trip -
 * not just while looking at one stop - for a headcount during an
 * incident.
 */
export function useRiderRoster() {
  const [rosters, setRosters] = useState<Record<number, boolean[]>>({});

  const getRoster = useCallback(
    (stepId: number, expectedCount: number): boolean[] =>
      rosters[stepId] ?? Array(expectedCount).fill(false),
    [rosters],
  );

  // Star-rating style: tapping rider N checks in everyone from 1 through
  // N and un-checks anyone after N, rather than toggling one at a time.
  const fillTo = useCallback((stepId: number, index: number, expectedCount: number) => {
    setRosters((prev) => {
      const current = prev[stepId] ?? Array(expectedCount).fill(false);
      const next = current.map((_, i) => i <= index);
      return { ...prev, [stepId]: next };
    });
  }, []);

  // A rider added on the spot is, by definition, already on the bus -
  // and so, in practice, is everyone ahead of them: nobody boards out of
  // order, so an unexpected rider showing up implies every expected
  // rider already did too. Checks off the whole roster rather than just
  // appending the new one, same "fill to" spirit as fillTo above.
  const addUnexpectedRider = useCallback((stepId: number, expectedCount: number) => {
    setRosters((prev) => {
      const current = prev[stepId] ?? Array(expectedCount).fill(false);
      return { ...prev, [stepId]: [...current.map(() => true), true] };
    });
  }, []);

  const totalOnboard = useMemo(
    () => Object.values(rosters).reduce((sum, roster) => sum + roster.filter(Boolean).length, 0),
    [rosters],
  );

  return { getRoster, fillTo, addUnexpectedRider, totalOnboard };
}
