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

  const toggleRider = useCallback((stepId: number, index: number, expectedCount: number) => {
    setRosters((prev) => {
      const current = prev[stepId] ?? Array(expectedCount).fill(false);
      const next = current.map((checked, i) => (i === index ? !checked : checked));
      return { ...prev, [stepId]: next };
    });
  }, []);

  const checkAll = useCallback((stepId: number, expectedCount: number) => {
    setRosters((prev) => {
      const current = prev[stepId] ?? Array(expectedCount).fill(false);
      return { ...prev, [stepId]: current.map(() => true) };
    });
  }, []);

  // A rider added on the spot is, by definition, already on the bus.
  const addUnexpectedRider = useCallback((stepId: number, expectedCount: number) => {
    setRosters((prev) => {
      const current = prev[stepId] ?? Array(expectedCount).fill(false);
      return { ...prev, [stepId]: [...current, true] };
    });
  }, []);

  const totalOnboard = useMemo(
    () => Object.values(rosters).reduce((sum, roster) => sum + roster.filter(Boolean).length, 0),
    [rosters],
  );

  return { getRoster, toggleRider, checkAll, addUnexpectedRider, totalOnboard };
}
