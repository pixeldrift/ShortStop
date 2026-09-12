"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteMap } from "./RouteMap";
import type { StopMarker, TurnMarker } from "./RouteMap";
import { ToggleSwitch } from "./ToggleSwitch";
import { TripTypeIcon } from "./TripTypeIcon";
import {
  BackArrowIcon,
  CloseIcon,
  EditIcon,
  MapPinIcon,
  PersonSolidIcon,
  RoundedTriangleIcon,
  TriangleIcon,
  TurnArrow,
} from "./icons";
import { addressWithoutZip } from "@/lib/schoolAddress";
import type { NavigationStep, Route } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";

/** "Published"/"Draft"/"Demo route" plus its own color - same three
 * RouteStatus values RouteListScreen's own admin rows already key off
 * (isRoutePublished), just spelled out here for a driver/admin reading
 * this one route's own info screen instead of a whole table of them. */
function routeStatusLabel(status: Route["status"]): {
  text: string;
  className: string;
} {
  if (status === "published")
    return { text: "Published", className: "text-green-600" };
  if (status === "draft") return { text: "Draft", className: "text-amber-600" };
  return { text: "Demo route", className: "text-zinc-500" };
}

/** "All coordinates verified" (or a partial "5/7 coordinates verified")
 * - the same "ok" cache-entry check isRouteFullyResolved (routeReadiness.ts)
 * uses before RouteListScreen ever lets a route publish, just counted
 * here instead of reduced to a single pass/fail. A route with nothing
 * geocodable at all (every step "unresolvable" - pure driver
 * instructions, no real stops) has nothing to verify in the first
 * place, so that reads as its own neutral line rather than a
 * confusing "0/0 verified." */
function coordinateStatusLabel(
  route: Route,
  cache: WaypointCache,
): { text: string; verified: boolean } {
  const geocodable = route.steps.filter(
    (s) => !s.waypointKey.startsWith("unresolvable:"),
  );
  if (geocodable.length === 0)
    return { text: "No coordinates to verify", verified: true };
  const resolved = geocodable.filter(
    (s) => cache[s.waypointKey]?.status === "ok",
  ).length;
  return resolved === geocodable.length
    ? { text: "All coordinates verified", verified: true }
    : {
        text: `${resolved}/${geocodable.length} coordinates verified`,
        verified: false,
      };
}

// Not currently rendered (see StartScreen below) - kept ready to
// re-enable later, so it's exported rather than deleted.
export function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}

export function LiveClock({ now }: { now: Date }) {
  const hours24 = now.getHours();
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minute = String(now.getMinutes()).padStart(2, "0");
  const period = hours24 >= 12 ? "PM" : "AM";

  return (
    <div
      className="font-heading mt-2 inline-flex items-center gap-0.5 rounded-lg border border-zinc-300 px-3 py-1"
      suppressHydrationWarning
    >
      <span className="text-xl font-extrabold tabular-nums">{hour12}</span>
      <span className="animate-blink text-xl font-extrabold">:</span>
      <span className="text-xl font-extrabold tabular-nums">{minute}</span>
      <span className="ml-1 text-xs font-semibold text-zinc-500">{period}</span>
    </div>
  );
}

/** Splits a value string like "8.4 mi" into ["8.4", "mi"] - only the
 * number is used, so the distance stat tile can show a spelled-out
 * "miles" label instead of whatever abbreviated unit the data uses. */
function splitValueUnit(text: string): [string, string] {
  const match = text.match(/^([\d.,]+)\s*(.*)$/);
  return match ? [match[1], match[2]] : [text, ""];
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-heading text-2xl font-black tracking-tight">
        {value}
      </span>
      <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {label}
      </span>
    </div>
  );
}

export function StartScreen({
  route,
  onStart,
  onBack,
  onEdit,
  onViewSchool,
}: {
  route: Route;
  onStart: () => void;
  onBack: () => void;
  /** Admin-only - opens EditRouteScreen for this route (see page.tsx).
   * Small and easy to miss on purpose: this is a district-admin tool
   * living on the same screen every driver sees, not a primary action. */
  onEdit: () => void;
  /** Opens the school's own school-routes screen (page.tsx) - the
   * school name/address block below is its tap target. */
  onViewSchool: (schoolName: string) => void;
}) {
  const totalStops = route.steps.filter((s) => s.kind === "stop").length;
  const totalRiders = route.steps.reduce(
    (sum, s) => sum + (s.studentCount ?? 0),
    0,
  );
  const [distanceValue] = splitValueUnit(route.distance);
  const [showStopsModal, setShowStopsModal] = useState(false);
  // The committed geocode cache (src/app/api/waypoints), fetched fresh
  // on mount purely to answer "is this route's coordinate data actually
  // good" (coordinateStatusLabel above) - a real fetch failure just
  // reads as "0 confirmed" rather than blocking anything else on this
  // screen, same empty-fallback convention every other cache fetch in
  // this app already uses (RouteMap.tsx, EditRouteScreen.tsx).
  const [waypointCache, setWaypointCache] = useState<WaypointCache>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/waypoints")
      .then((res): Promise<WaypointCache> | WaypointCache =>
        res.ok ? res.json() : {},
      )
      .catch(() => ({}) as WaypointCache)
      .then((data) => {
        if (!cancelled) setWaypointCache(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const status = routeStatusLabel(route.status);
  const coordStatus = coordinateStatusLabel(route, waypointCache);

  // Same derivation as StepScreen's own stopMarkers/turnMarkers/
  // routePath/schoolPoint - this screen's small overview map wants the
  // exact same markers/line the driving screen's own map draws, just at
  // a glance rather than tracked live.
  const stopMarkers = useMemo<StopMarker[]>(() => {
    let stopCount = 0;
    return route.steps
      .filter((s) => s.kind === "stop")
      .map((s) => ({ waypointKey: s.waypointKey, number: ++stopCount }));
  }, [route]);
  const turnMarkers = useMemo<TurnMarker[]>(
    () =>
      route.steps
        .filter((s) => s.kind === "turn")
        .map((s) => ({
          waypointKey: s.waypointKey,
          direction: s.direction,
          heading: s.heading,
        })),
    [route],
  );
  const routePath = useMemo(
    () => route.steps.map((s) => s.waypointKey),
    [route],
  );
  const schoolPoint = useMemo(
    () =>
      route.schoolLat != null && route.schoolLon != null
        ? { lat: route.schoolLat, lon: route.schoolLon }
        : null,
    [route.schoolLat, route.schoolLon],
  );

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-hidden px-6 pb-6 text-center">
      {/* Everything that can genuinely grow past the viewport (the
          overview map especially) lives in this inner, scrollable
          region - Start Route/Edit Route below stay outside it, pinned
          to the bottom of the screen instead of scrolling away with a
          long route. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-4 overflow-y-auto">
        <div className="flex w-full max-w-md shrink-0 items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to routes"
            className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
          >
            <BackArrowIcon className="h-5 w-5" />
          </button>
          <div>
            {/* Same small district label SchoolListScreen carries above
                its own heading - hardcoded for now, every real route
                here is a Rutherford County one (see that screen's own
                doc comment for why this isn't folded into the heading
                itself). */}
            <span className="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Rutherford County
            </span>
            {/* mt-[1.25px] - once leading-[0.7083] below trimmed this
                h1's own line box down to the digits' true ink height (see
                that class's own doc comment), the -mt-1 tuned against the
                old leading-none box collapsed the gap against the county
                label above to nothing (leading-none's line box carried
                enough of its own top padding to read as a gap on its
                own). Re-measured via canvas actualBoundingBoxAscent
                against the live rendered box so the visual gap here
                matches RouteListScreen's own "Routes" title - which still
                uses leading-none/-mt-1 and never needed retuning - to
                1.5px, rather than guessing a value against this tighter
                line-height. relative/absolute rather than a flex row -
                the AM/PM icon floats off the text's own right edge
                (left-full) so it never shifts the title text itself
                off-center from the county label above, the way sharing
                a centered flex row with it used to. am.svg/pm.svg carry
                their own label lettering, so pickup/dropoff is the icon
                alone - vertically centered against the title's full
                height and sized to nearly match it. Every other
                TripType (fieldtrip/other) skips the badge entirely -
                those routes may not even have a morning/afternoon
                distinction to badge, and there's no real example of
                one yet to design that case against. */}
            <h1 className="font-heading relative mt-[1.25px] text-4xl leading-[0.7083] font-black tracking-tight">
              Route {route.routeNumber}
              {(route.tripType === "pickup" ||
                route.tripType === "dropoff") && (
                <TripTypeIcon
                  tripType={route.tripType}
                  className="absolute top-1/2 left-full ml-2 h-6 w-6 -translate-y-1/2 text-zinc-400"
                />
              )}
            </h1>
          </div>
          {/* Balances the back button's own width so the title block
              above is genuinely centered in this row, not just left to
              whatever space happens to be left after a back button on
              one side and nothing on the other. */}
          <span className="h-10 w-10 shrink-0" aria-hidden="true" />
        </div>

        <div className="w-full max-w-md shrink-0 rounded-2xl border border-zinc-300 p-5">
          <button
            type="button"
            onClick={() => onViewSchool(route.schoolName)}
            className="w-full rounded-lg py-1 active:bg-zinc-100"
          >
            <p className="font-heading text-xl leading-tight font-bold text-zinc-700">
              {route.schoolName}
            </p>
            <p className="mt-0.5 flex items-center justify-center gap-1 text-sm text-zinc-500">
              <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              {addressWithoutZip(route.schoolAddress)}
            </p>
          </button>

          {/* The route's own start time - big and bold, between the
              address above and the stats row below, rather than a small
              line tucked under the title (its old spot, sharing that
              row's own centering with the AM/PM badge) - the one thing
              on this whole card worth reading at a glance before
              anything else. */}
          <p className="font-heading mt-3 text-3xl leading-none font-black tracking-tight text-blue-600">
            {route.departureTime}
          </p>

          <div className="mt-4 grid grid-cols-4 gap-2">
            <StatTile value={distanceValue} label="miles" />
            <StatTile
              value={
                route.durationMinutes != null
                  ? String(route.durationMinutes)
                  : "—"
              }
              label="minutes"
            />
            <StatTile value={String(totalStops)} label="stops" />
            <StatTile value={String(totalRiders)} label="riders" />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-lg">
            <dt className="text-right text-zinc-500">Bus</dt>
            <dd className="text-left font-medium">{route.busNumber}</dd>
            <dt className="text-right text-zinc-500">Driver</dt>
            <dd className="text-left font-medium">{route.driverName}</dd>
          </dl>

          {/* Admin-relevant status, not a driver stat - whether this
              route is actually live (published/draft/demo) and whether
              its own stops are all real, geocoded locations yet, both
              things RouteListScreen/EditRouteScreen already track but
              that were otherwise invisible from this one route's own
              info screen. */}
          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-sm font-semibold">
            <span className={status.className}>{status.text}</span>
            <span className="text-zinc-300">·</span>
            <span
              className={
                coordStatus.verified ? "text-green-600" : "text-zinc-500"
              }
            >
              {coordStatus.text}
            </span>
          </p>

          <button
            type="button"
            onClick={() => setShowStopsModal(true)}
            className="btn-glossy-light font-heading mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-zinc-300 py-2.5 text-base font-semibold text-zinc-900"
          >
            View All Stops
          </button>
        </div>

        {/* A small, glanceable overview of the whole route - the same
            stops/turns/school markers and road-following line
            StepScreen's own map draws while actually driving, just
            smaller and not yet tracking a live position against any of
            it. relative z-0 gives Leaflet's own internal panes/controls
            (tile pane, zoom control, attribution - several carry their
            own explicit, fairly high z-index) a stacking context of
            their own to escalate within, same reasoning as StepScreen's
            own map - without it they escape to the page's root stacking
            context and can paint above a z-20 overlay like
            AllStopsModal below despite being earlier in the DOM and
            visually "behind" it. */}
        <RouteMap
          className="relative z-0 h-40 w-full max-w-md shrink-0 overflow-hidden rounded-2xl border border-zinc-300"
          stops={stopMarkers}
          turns={turnMarkers}
          path={routePath}
          school={schoolPoint}
          tripType={route.tripType}
          waypointsUrl="/api/waypoints"
          mode="overview"
        />
      </div>

      <button
        type="button"
        onClick={onStart}
        className="btn-glossy-blue font-heading flex w-full max-w-xs shrink-0 items-center justify-center gap-2 rounded-2xl bg-blue-600 py-6 text-2xl font-bold text-white active:scale-[0.98]"
      >
        Start Route <TriangleIcon direction="right" className="h-6 w-6" />
      </button>

      <button
        type="button"
        onClick={onEdit}
        className="flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-400 active:text-zinc-600"
      >
        <EditIcon className="h-3 w-3" />
        Edit Route
      </button>

      {showStopsModal && (
        <AllStopsModal route={route} onClose={() => setShowStopsModal(false)} />
      )}
    </div>
  );
}

/** A stop's own "Road A & Road B" subheading, with the "&" set apart
 * from the two road names (smaller, gray, italic) the same way
 * EditRouteScreen's own StepRowView already styles its identical
 * connector, so a stop reads the same whether it's being viewed here
 * or edited there. Splits on " & " (the exact separator
 * buildRouteFromRows/parseRouteCsv.ts joins fromLocation/location
 * with) - anything that doesn't split into exactly two parts (a plain
 * address, no cross street) passes through unstyled. */
function StopSubheading({ subheading }: { subheading: string }) {
  const parts = subheading.split(" & ");
  if (parts.length !== 2) return <>{subheading}</>;
  const [roadA, roadB] = parts;
  return (
    <>
      {roadA}{" "}
      <span className="text-sm font-normal text-zinc-400 italic">&</span>{" "}
      {roadB}
    </>
  );
}

/** The school row in AllStopsModal - no stop number, since it isn't one
 * of the route's actual numbered stops. Styled like every other
 * school-address callout in the app (MapPinIcon + address, under the
 * school's name) rather than like a Stop row. */
function SchoolEntry({ route }: { route: Route }) {
  return (
    <div className="py-3 text-left">
      <span className="font-heading font-black">{route.schoolName}</span>
      <p className="mt-0.5 flex items-center gap-1 text-sm text-zinc-500">
        <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        {route.schoolAddress}
      </p>
    </div>
  );
}

/** One turn step's row - same card shape as a stop's, but the turn
 * arrow (mirrored per direction, same as StepScreen's own big one)
 * stands in for the numbered map pin, and there's no rider count. Only
 * shown at all once the "Show turns" toggle is on (see AllStopsModal). */
function TurnRow({ step }: { step: NavigationStep }) {
  return (
    <div className="py-3 text-left">
      <span className="font-heading flex items-center gap-1.5 text-base font-bold text-zinc-500">
        {step.direction && (
          <TurnArrow direction={step.direction} className="h-4 w-4 shrink-0" />
        )}
        {step.heading}
      </span>
      <p className="text-zinc-700">{step.subheading}</p>
      {step.specialInstruction && (
        <p className="mt-0.5 text-sm text-zinc-500">
          {step.specialInstruction}
        </p>
      )}
    </div>
  );
}

/** Scrolling list of every stop on the route, in order - tapping "View
 * All Stops" on the Route info screen above. Stops only by default
 * (matching how this always used to work); the "Show turns" toggle
 * interleaves turn steps back in at their real position in the route
 * rather than appending them separately, so the order shown always
 * matches the real drive.
 *
 * The school itself isn't one of route.steps' own stops (see
 * parseRouteCsv.ts - it only ever turns route-125.csv's rows into
 * steps, and the school is where those rows start or end, not a row of
 * its own), so it's rendered here as its own entry rather than folded
 * into the stops list - first for a dropoff route (the bus starts
 * there), last for a pickup route (the bus ends there), matching which
 * end of the real trip it actually is. */
function AllStopsModal({
  route,
  onClose,
}: {
  route: Route;
  onClose: () => void;
}) {
  const [showTurns, setShowTurns] = useState(false);
  const schoolEntry = <SchoolEntry route={route} />;

  // Precomputed outside the JSX map below (not incremented inline in the
  // render callback) so React Compiler's per-item memoization doesn't see a
  // mutated closure variable - each stop step looks up its own number here.
  let stopCounter = 0;
  const stopNumbers = new Map<number, number>();
  for (const step of route.steps) {
    if (step.kind === "stop") stopNumbers.set(step.id, ++stopCounter);
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="animate-popup-pop flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl bg-[var(--background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="font-heading flex flex-wrap items-center gap-1.5 text-xl font-black tracking-tight">
            Route {route.routeNumber}
            {(route.tripType === "pickup" || route.tripType === "dropoff") && (
              <TripTypeIcon
                tripType={route.tripType}
                className="h-[15px] w-[15px] text-zinc-400"
              />
            )}
            <span className="text-zinc-400">-</span>
            All Stops
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 justify-end border-b border-zinc-200 px-5 py-2">
          <ToggleSwitch
            checked={showTurns}
            onChange={setShowTurns}
            label="Show turns"
          />
        </div>

        <div className="divide-y divide-zinc-200 overflow-y-auto px-5">
          {route.tripType === "dropoff" && schoolEntry}

          {route.steps.map((step) => {
            if (step.kind === "stop") {
              const number = stopNumbers.get(step.id);
              return (
                <div key={step.id} className="py-3 text-left">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-heading flex items-center gap-1.5 text-lg font-black">
                      <MapPinIcon className="h-4 w-4 shrink-0 text-red-500" />
                      Stop {number}
                      {step.sideOfRoad && (
                        <span className="flex items-center gap-0.5 text-sm font-semibold text-zinc-400">
                          ({step.sideOfRoad.toLowerCase()}
                          <RoundedTriangleIcon
                            direction={
                              step.sideOfRoad.toLowerCase() === "left"
                                ? "left"
                                : "right"
                            }
                            className="h-3 w-3"
                          />
                          )
                        </span>
                      )}
                    </span>
                    {step.studentCount != null && (
                      <span className="flex shrink-0 items-center gap-1 text-sm text-zinc-500">
                        <PersonSolidIcon className="h-4 w-4" />
                        {step.studentCount} rider
                        {step.studentCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-700">
                    {step.subheading && (
                      <StopSubheading subheading={step.subheading} />
                    )}
                  </p>
                  {step.specialInstruction && (
                    <p className="mt-0.5 text-sm text-zinc-500">
                      {step.specialInstruction}
                    </p>
                  )}
                </div>
              );
            }
            if (step.kind === "turn" && showTurns) {
              return <TurnRow key={step.id} step={step} />;
            }
            return null;
          })}

          {/* Dropoff starts at the school (see the "before" branch
              above); pickup and a one-off field trip both default to
              ending there instead - not "pickup only" (a fieldtrip
              route would otherwise show no school entry at all, having
              matched neither branch). */}
          {route.tripType !== "dropoff" && schoolEntry}
        </div>
      </div>
    </div>
  );
}
