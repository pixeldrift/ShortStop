"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "shortstop:waypointMapVisible";

/**
 * Whether the small preview map that already accompanies a waypoint
 * list (EditRouteScreen's own per-row StepRowEditor preview,
 * AllStopsModal's own route overview) should currently show - one
 * shared, persisted choice rather than a separate one per screen, so
 * hiding it to fit more list rows on screen (or bringing it back for
 * context) stays applied everywhere a waypoint list can show a map,
 * not just the one screen it was toggled from.
 *
 * Defaults to visible (`true`) on every render up through this
 * component's own hydration - `localStorage` doesn't exist during this
 * "use client" component's first SSR pass (see RouteMap.tsx's own doc
 * comment on that same SSR pass), so seeding state straight from it via
 * a lazy useState initializer would read `true` on the server and
 * whatever's actually stored on the client's very next render,
 * mismatching the server-rendered HTML the instant a driver had ever
 * turned this off before. Read for real in the mount effect below
 * instead, same as every other localStorage-backed preference has to
 * be - a deliberate one-time extra render after mount, not an
 * oversight, so this needs its own eslint-disable rather than the
 * lazy-initializer fix that same lint rule usually wants (see
 * useRouteStepper.ts's own doc comment for a case where that fix *is*
 * right - a resume index seeded from a prop, not from storage that
 * flatly doesn't exist yet at the point this first renders).
 */
export function useWaypointMapVisible(): [boolean, (next: boolean) => void] {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored != null) setVisible(stored === "true");
    } catch {
      // Storage blocked (private mode, or disabled outright) - stays
      // at the always-visible default.
    }
  }, []);

  function update(next: boolean) {
    setVisible(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Nothing to persist to - the in-memory value above still
      // takes effect for the rest of this session.
    }
  }

  return [visible, update];
}
