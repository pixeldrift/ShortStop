"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Logo } from "./Logo";
import { ToggleSwitch } from "./ToggleSwitch";
import {
  BackArrowIcon,
  CheckCircleIcon,
  MapPinIcon,
  SaveIcon,
  TrashIcon,
  TurnArrow,
  UploadIcon,
  WarningIcon,
  XCircleIcon,
} from "./icons";
import { buildRouteFromRows } from "@/lib/parseRouteCsv";
import type { RawRouteRow, RouteMeta } from "@/lib/parseRouteCsv";
import { deriveWaypoints } from "@/lib/deriveWaypoints";
import type { WaypointQuery } from "@/lib/deriveWaypoints";
import type { GeocodableQuery } from "@/lib/geocode";
import { stepsCsvBaseName } from "@/lib/parseRouteMasterList";
import { parseRouteImport, rowsToCsvText, unresolvedRequiredFields } from "@/lib/parseRouteImport";
import { PLACEHOLDER_DISTANCE, PLACEHOLDER_DRIVER_NAME } from "@/lib/placeholderMeta";
import { resolutionCounts, summarizeRouteResolution } from "@/lib/routeResolutionStatus";
import type { RowResolutionStatus } from "@/lib/routeResolutionStatus";
import { waypointCacheKey } from "@/lib/waypointCache";
import type { WaypointCache, WaypointCacheEntry } from "@/lib/waypointCache";
import type { Route, RouteStatus, SchoolLevel, TripType } from "@/lib/types";
import type { GeocodeResponseBody } from "@/app/api/geocode/route";

const SCHOOL_LEVEL_OPTIONS: { value: SchoolLevel; label: string }[] = [
  { value: "elementary", label: "Elementary" },
  { value: "middle", label: "Middle School" },
  { value: "high", label: "High School" },
];

const STEPS_PLACEHOLDER = `Paste stops (and turns, if you have them), or upload a file below. A few formats all work:

action,from_at,onto_at,rider_count,side,notes
Stop,Bill Stewart Blvd,Hidden Forest Ln,5,Right,

...or just a plain list, one stop per line, nothing else:
216 Lake Forest Dr
Bill Stewart Blvd & Hidden Forest Ln

...or stops and turns together, no header row at all:
Left, Rock Springs Rd
Stop, Bill Stewart Blvd, Hidden Forest Ln

Only the location itself is ever required - time, rider counts, side of street, and notes can all be left out.`;

const BLANK_ROW: RawRouteRow = { action: "Stop", fromAt: "", ontoAt: "", riderCount: "", side: "", notes: "" };

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none";
const labelClass = "text-xs font-semibold tracking-wide text-zinc-500 uppercase";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

/** The same text deriveWaypoints itself would send a geocoder - what a
 * row's resolution status shows for an unresolved/skipped stop, so a
 * human can tell what it's actually trying to look up. */
function waypointLabel(query: WaypointQuery): string {
  if (query.kind === "address") return query.text;
  if (query.kind === "intersection") return `${query.roadA} & ${query.roadB}`;
  return query.description;
}

/**
 * One editable stop/turn card - same card shape as StartScreen's own
 * "View All Stops" rows (numbered pin for a stop, turn arrow for a
 * turn), but every field is a live input instead of static text, plus
 * a resolution status line (green check + coordinates, red X, or a
 * skipped/greyed row for an `unresolvable` one) with its own "Fetch"
 * button, and a trash-can button to remove the row entirely. The
 * "type" select is what deriveWaypoints.ts actually reads as `action` -
 * changing it between Stop/Turn Left/Turn Right changes how this row's
 * own location gets resolved (a Stop's own address/cross-street vs. a
 * turn's destination road), not just how it displays.
 */
function EditableStepRow({
  row,
  stopNumber,
  waypoint,
  status,
  fetching,
  onChange,
  onRemove,
  onFetch,
}: {
  row: RawRouteRow;
  /** This row's own stop number (1-indexed), or null for a turn. */
  stopNumber: number | null;
  /** This row's own derived location, once every row in the route has
   * at least an action and a from_at (see EditRouteScreen's
   * `hasIncompleteRow`) - undefined until then, since deriveWaypoints
   * needs the whole list to track "current road" across rows. */
  waypoint: WaypointQuery | undefined;
  status: RowResolutionStatus | undefined;
  fetching: boolean;
  onChange: (patch: Partial<RawRouteRow>) => void;
  onRemove: () => void;
  onFetch: () => void;
}) {
  const isStop = stopNumber !== null;
  const direction = row.action.toLowerCase() === "left" ? "left" : "right";

  return (
    <div className="border-b border-zinc-200 py-3 text-left last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading flex items-center gap-1.5 text-base font-black">
          {isStop ? (
            <>
              <MapPinIcon className="h-4 w-4 shrink-0 text-red-500" />
              Stop {stopNumber}
            </>
          ) : (
            <>
              <TurnArrow direction={direction} className="h-4 w-4 shrink-0" />
              Turn
            </>
          )}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove step"
          className="text-zinc-400 active:text-red-600"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <select
          className={inputClass}
          value={row.action}
          onChange={(e) => onChange({ action: e.target.value })}
        >
          <option value="Stop">Stop</option>
          <option value="Left">Turn Left</option>
          <option value="Right">Turn Right</option>
        </select>
        {isStop ? (
          <select
            className={inputClass}
            value={row.side}
            onChange={(e) => onChange({ side: e.target.value })}
          >
            <option value="">Side (none)</option>
            <option value="Left">Left</option>
            <option value="Right">Right</option>
          </select>
        ) : (
          <span />
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          className={inputClass}
          placeholder="From"
          value={row.fromAt}
          onChange={(e) => onChange({ fromAt: e.target.value })}
        />
        <input
          className={inputClass}
          placeholder="Onto / cross street"
          value={row.ontoAt}
          onChange={(e) => onChange({ ontoAt: e.target.value })}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {isStop && (
          <input
            className={inputClass}
            placeholder="Riders"
            inputMode="numeric"
            value={row.riderCount}
            onChange={(e) => onChange({ riderCount: e.target.value })}
          />
        )}
        <input
          className={`${inputClass} ${isStop ? "" : "col-span-2"}`}
          placeholder="Notes"
          value={row.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      {waypoint && status && (
        <div className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-1.5">
            {status.status === "resolved" ? (
              <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-600" />
            ) : status.status === "skipped" ? (
              <span className="h-4 w-4 shrink-0 text-center leading-4 text-zinc-400">–</span>
            ) : (
              <XCircleIcon className="h-4 w-4 shrink-0 text-red-500" />
            )}
            <span className="truncate text-zinc-500">
              {status.status === "resolved"
                ? `${waypointLabel(waypoint)} (${status.lat.toFixed(5)}, ${status.lon.toFixed(5)})`
                : status.status === "skipped"
                  ? `Skipped: ${status.reason}`
                  : status.reason}
            </span>
          </span>
          {status.status !== "skipped" && (
            <button
              type="button"
              onClick={onFetch}
              disabled={fetching}
              className="shrink-0 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 disabled:opacity-50"
            >
              {fetching ? "Fetching…" : "Fetch"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The admin-only Add Route / Edit Route screen - reached via
 * RouteListScreen's "Edit Mode" toggle (a new route, or clicking a
 * draft one) or StartScreen's "Edit Route" link. Builds a Route from a
 * pasted/uploaded stops list (via parseRouteImport's graceful
 * column/header matching - a plain list of stops, stops and turns with
 * no other columns, or the app's own full schema all work) plus a
 * small metadata form.
 *
 * Adding a new route is deliberately two steps, not one: this screen's
 * `mode: "add"` only ever offers Save (no validation, no per-row
 * review, no publish control - there's no point reviewing coordinates
 * for a route that doesn't exist as a saved entity yet), which creates
 * the route as "draft" and hands control straight back to page.tsx,
 * which immediately reopens this same screen in `mode: "edit"` for it.
 *
 * Editing is where the real review lives, and it stops showing raw
 * text at that point - the stops list becomes a structured, editable
 * card per stop/turn (EditableStepRow above, styled like StartScreen's
 * "View All Stops"), each with a live resolution status (via
 * routeResolutionStatus.ts) against whatever's already geocoded, its
 * own "Fetch" button, and a "Fetch All Locations" button for the whole
 * route - all three calling /api/geocode for real (server-side, so
 * ORS_API_KEY never reaches the browser). "Make Active" is replaced by
 * a warning until every geocodable stop actually resolves.
 *
 * Session-only for now: `onSave` hands the built Route back up to
 * page.tsx's in-memory admin-route store, not a real committed file -
 * same "real workflow, no persistence yet" honesty this app already
 * uses for rider check-in state (see useRiderRoster.ts). A freshly
 * fetched coordinate here lives in this screen's own state too, not a
 * committed sidecar cache file - RouteMap.tsx still reads only the
 * real, committed one, so "Fetch Location" is for review here, not yet
 * what actually puts a pin on the map.
 */
export function EditRouteScreen({
  mode,
  route,
  rawStepsText,
  initialWaypointCache,
  schoolAddresses,
  onCancel,
  onSave,
}: {
  mode: "add" | "edit";
  /** The route being edited, or null when adding a brand-new one. */
  route: Route | null;
  /** The route's own current steps text - pre-fills `mode: "add"`'s
   * textarea directly, and seeds `mode: "edit"`'s structured row list
   * once on mount (see the `rows` useState below) - always "" for
   * `mode: "add"`. */
  rawStepsText: string;
  /** A previous edit session's own fetched cache for this exact route,
   * if page.tsx has one - takes priority over fetching the real
   * committed sidecar file, so coordinates fetched and saved earlier
   * this session aren't lost the next time this route is reopened
   * (see page.tsx's adminWaypointCaches). Undefined for `mode: "add"`
   * and for a route that's never had one fetched. */
  initialWaypointCache?: WaypointCache;
  /** School name -> address, from schools.csv - offered as a one-click
   * fill-in for the school address field rather than auto-overwriting
   * whatever the admin already typed. */
  schoolAddresses: Record<string, string>;
  onCancel: () => void;
  /** `rawStepsText` here is always the *current* content - `mode:
   * "add"`'s pasted/uploaded text as-is, or `mode: "edit"`'s edited row
   * list serialized back to the same CSV shape (rowsToCsvText) so
   * page.tsx's storage doesn't need its own separate structured-row
   * format. `cache` is this session's complete waypoint cache for the
   * route (whatever was loaded plus anything freshly fetched) - kept
   * alongside the route itself so a later re-open of this same route
   * (or the list's own "Publish" readiness check) sees it too, instead
   * of every fetched coordinate vanishing the moment this screen
   * closes. */
  onSave: (route: Route, rawStepsText: string, cache: WaypointCache) => void;
}) {
  const [routeNumber, setRouteNumber] = useState(route?.routeNumber ?? "");
  const [busNumber, setBusNumber] = useState(route?.busNumber ?? "");
  const [schoolName, setSchoolName] = useState(route?.schoolName ?? "");
  const [schoolAddress, setSchoolAddress] = useState(route?.schoolAddress ?? "");
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>(route?.schoolLevel ?? "elementary");
  const [tripType, setTripType] = useState<TripType>(route?.tripType ?? "pickup");
  const [departureTime, setDepartureTime] = useState(route?.departureTime ?? "");
  const [durationMinutes, setDurationMinutes] = useState(
    route?.durationMinutes != null ? String(route.durationMinutes) : "",
  );
  const [driverName, setDriverName] = useState(route?.driverName ?? PLACEHOLDER_DRIVER_NAME);
  const [distance, setDistance] = useState(route?.distance ?? PLACEHOLDER_DISTANCE);
  // mode "add" only - the paste/upload box. mode "edit" never reads
  // this again after its own one-time seed below; it's the structured
  // `rows` state that's authoritative from then on.
  const [stepsText, setStepsText] = useState(rawStepsText);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // mode "edit" only - seeded once from rawStepsText (whatever CSV
  // shape it came in as, real committed file or a prior edit's own
  // rowsToCsvText output - parseRouteImport reads either fine), then
  // edited structurally (add/remove/change a row) from here on, never
  // re-derived from text again.
  const [rows, setRows] = useState<RawRouteRow[]>(() => parseRouteImport(rawStepsText).rows);
  const [showTurns, setShowTurns] = useState(false);
  // A brand-new route always starts "draft" - readiness to publish is
  // checked live (canPublish below), not tracked as a separate status
  // of its own.
  const [status, setStatus] = useState<RouteStatus>(route?.status ?? "draft");
  // Seeded straight from initialWaypointCache when there is one (this
  // exact route's own cache from an earlier edit this session) - a
  // lazy initializer, not an effect, so there's no real network fetch
  // to skip in that case at all, only a genuine cache miss ever
  // reaches the effect below.
  const [cache, setCache] = useState<WaypointCache>(() => initialWaypointCache ?? {});
  const [message, setMessage] = useState<string | null>(null);

  // The school's own geocoded point, once known - reused across every
  // "Fetch"/"Fetch All" call in this edit session instead of
  // re-geocoding the school address on every single click (see
  // /api/geocode's own doc comment for why that specific repeat is
  // worse than merely wasteful - it's what actually triggered a live
  // 403 in production).
  const [schoolAnchor, setSchoolAnchor] = useState<{ lat: number; lon: number } | null>(null);
  const [fetchingStepIds, setFetchingStepIds] = useState<ReadonlySet<number>>(new Set());
  const [fetchAllRunning, setFetchAllRunning] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Whatever's already geocoded for this exact route number/trip/level
  // combination, if anything - a real route's committed sidecar cache
  // once one exists, or nothing at all for a brand-new one (a 404
  // resolves to an empty cache, same as RouteMap.tsx's own fetch).
  useEffect(() => {
    // initialWaypointCache already seeded `cache` above (see its
    // useState initializer), so there's no fetch to do for the route
    // this screen originally opened for. Accepted simplification: if
    // the admin then edits routeNumber/tripType/schoolLevel mid-edit
    // (changing which route this actually is), this still won't fetch
    // that new identity's own cache until a fresh mount (e.g. saving
    // and reopening) - a narrow, rare enough case not to add a second
    // piece of ref-tracked state for.
    if (initialWaypointCache) return;

    let cancelled = false;
    // No route number yet - nothing to look up. Left as whatever cache
    // was already loaded rather than reset here (a direct setState
    // inside an effect body, not a subscription callback) - harmless,
    // since an empty route number can't be saved anyway (see
    // buildMeta), so a stale cache value never affects a real save.
    if (!routeNumber) return;

    const baseName = stepsCsvBaseName({ routeNumber, tripType, schoolLevel });
    fetch(`/data/${baseName}-waypoints.json`)
      .then((res): Promise<WaypointCache> | WaypointCache => (res.ok ? res.json() : {}))
      .catch(() => ({}) as WaypointCache)
      .then((data) => {
        if (!cancelled) setCache(data);
      });
    return () => {
      cancelled = true;
    };
  }, [routeNumber, tripType, schoolLevel, initialWaypointCache]);

  // mode "add" only - parses the paste/upload box's raw text.
  const parseResult = useMemo(() => parseRouteImport(stepsText), [stepsText]);
  const missingRequired = useMemo(
    () => unresolvedRequiredFields(parseResult.mapping),
    [parseResult],
  );

  // mode "edit" only - every row needs at least an action and a
  // from_at before deriveWaypoints can make sense of any of them (it
  // tracks "current road" across the whole list in order).
  const hasIncompleteRow = useMemo(
    () => rows.some((r) => !r.action.trim() || !r.fromAt.trim()),
    [rows],
  );
  const waypoints = useMemo(() => {
    if (mode !== "edit" || hasIncompleteRow || !schoolAddress || rows.length === 0) return [];
    return deriveWaypoints(rows, schoolAddress);
  }, [mode, rows, hasIncompleteRow, schoolAddress]);
  const resolutionRows = useMemo(
    () => summarizeRouteResolution(waypoints, cache),
    [waypoints, cache],
  );
  const counts = useMemo(() => resolutionCounts(resolutionRows), [resolutionRows]);
  const canPublish =
    mode === "edit" && !hasIncompleteRow && rows.length > 0 && counts.unresolved === 0;
  // The readiness check only ever gates *publishing* - unpublishing an
  // already-published route (one that's live despite having unresolved
  // waypoints, e.g. before the real geocoding pipeline has ever run
  // against it) is always allowed, no warning needed for that
  // direction.
  const canToggleStatus = status === "published" || canPublish;

  const knownSchoolAddress = schoolAddresses[schoolName];

  function updateRow(index: number, patch: Partial<RawRouteRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function addRow() {
    setRows((prev) => [...prev, { ...BLANK_ROW }]);
  }

  function handleFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be re-selected later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setStepsText(reader.result);
    };
    reader.readAsText(file);
  }

  async function callGeocodeApi(queries: GeocodableQuery[]): Promise<GeocodeResponseBody> {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: queries,
        schoolAddress,
        anchor: schoolAnchor ?? undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
    return data as GeocodeResponseBody;
  }

  async function fetchLocation(waypoint: GeocodableQuery) {
    setFetchError(null);
    setFetchingStepIds((prev) => new Set(prev).add(waypoint.stepId));
    try {
      const data = await callGeocodeApi([waypoint]);
      if (data.anchor) setSchoolAnchor(data.anchor);
      const entry: WaypointCacheEntry | null = data.results[0];
      if (entry) {
        const key = waypointCacheKey(waypoint);
        setCache((prev) => ({ ...prev, [key]: entry }));
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingStepIds((prev) => {
        const next = new Set(prev);
        next.delete(waypoint.stepId);
        return next;
      });
    }
  }

  async function fetchAllLocations() {
    const toFetch = waypoints.filter(
      (w): w is GeocodableQuery => w.kind !== "unresolvable" && cache[waypointCacheKey(w)]?.status !== "ok",
    );
    if (toFetch.length === 0) return;

    setFetchError(null);
    setFetchAllRunning(true);
    setFetchingStepIds(new Set(toFetch.map((w) => w.stepId)));
    try {
      const data = await callGeocodeApi(toFetch);
      if (data.anchor) setSchoolAnchor(data.anchor);
      setCache((prev) => {
        const next = { ...prev };
        toFetch.forEach((w, i) => {
          const entry = data.results[i];
          if (entry) next[waypointCacheKey(w)] = entry;
        });
        return next;
      });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchAllRunning(false);
      setFetchingStepIds(new Set());
    }
  }

  function buildMeta(nextStatus: RouteStatus): RouteMeta | null {
    if (!routeNumber.trim() || !schoolName.trim() || !schoolAddress.trim()) {
      setMessage("Route number, school name, and school address are all required.");
      return null;
    }
    if (mode === "add") {
      if (missingRequired.length > 0) {
        setMessage(`Couldn't find a column for: ${missingRequired.join(", ")}. Every stop needs at least an action and a location.`);
        return null;
      }
      if (parseResult.rows.length === 0) {
        setMessage("Add at least one stop before saving.");
        return null;
      }
    } else {
      if (rows.length === 0) {
        setMessage("Add at least one stop before saving.");
        return null;
      }
      if (hasIncompleteRow) {
        setMessage("Every stop needs at least a type and a location.");
        return null;
      }
    }

    return {
      id: `${routeNumber}-${tripType}-${schoolLevel}`,
      status: nextStatus,
      name: `${schoolName} — ${tripType === "pickup" ? "Morning Pickup" : "Afternoon Drop Off"}`,
      routeNumber,
      driverName,
      busNumber,
      departureTime,
      schoolName,
      schoolAddress,
      schoolLevel,
      tripType,
      distance,
      durationMinutes: Number(durationMinutes) || 0,
      isFavorite: route?.isFavorite ?? false,
    };
  }

  function handleSave(nextStatus: RouteStatus = status) {
    const meta = buildMeta(nextStatus);
    if (!meta) return;
    const currentRows = mode === "add" ? parseResult.rows : rows;
    const built = buildRouteFromRows(currentRows, meta);
    const textToPersist = mode === "add" ? stepsText : rowsToCsvText(rows);
    setStatus(nextStatus);
    setMessage("Saved.");
    onSave(built, textToPersist, cache);
  }

  function handleToggleStatus() {
    handleSave(status === "published" ? "draft" : "published");
  }

  // Which rows to actually render below - every row when "Show turns"
  // is on, stops only otherwise (matching StartScreen's own "View All
  // Stops" default). Never affects the underlying `rows` state itself,
  // only what's currently displayed.
  const visibleRowIndices = rows
    .map((_, index) => index)
    .filter((index) => showTurns || rows[index].action.toLowerCase() === "stop");

  // Precomputed outside the JSX map below (not incremented inline in the
  // render callback) so React Compiler's per-item memoization doesn't see a
  // mutated closure variable - each stop row looks up its own number here.
  let stopCounter = 0;
  const stopNumbers = new Map<number, number>();
  for (const index of visibleRowIndices) {
    if (rows[index].action.toLowerCase() === "stop") stopNumbers.set(index, ++stopCounter);
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-10 pb-10 text-center landscape:pt-6">
      <Logo size="large" />

      <div className="flex w-full max-w-md items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="btn-glossy flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-zinc-300 text-zinc-900"
        >
          <BackArrowIcon className="h-5 w-5" />
        </button>
        <h1 className="font-heading text-2xl font-black tracking-tight">
          {mode === "add" ? "Add Route" : `Edit Route ${route?.routeNumber ?? ""}`}
        </h1>
        <span className="w-10" />
      </div>

      <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Route number">
            <input
              className={inputClass}
              value={routeNumber}
              onChange={(e) => setRouteNumber(e.target.value)}
              placeholder="125"
            />
          </Field>
          <Field label="Bus number">
            <input
              className={inputClass}
              value={busNumber}
              onChange={(e) => setBusNumber(e.target.value)}
              placeholder="125"
            />
          </Field>
          <Field label="Trip">
            <select
              className={inputClass}
              value={tripType}
              onChange={(e) => setTripType(e.target.value as TripType)}
            >
              <option value="pickup">AM Pickup</option>
              <option value="dropoff">PM Drop Off</option>
            </select>
          </Field>
          <Field label="School level">
            <select
              className={inputClass}
              value={schoolLevel}
              onChange={(e) => setSchoolLevel(e.target.value as SchoolLevel)}
            >
              {SCHOOL_LEVEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="School name">
            <input
              className={inputClass}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="Lavergne Lake Elementary"
              list="known-schools"
            />
            <datalist id="known-schools">
              {Object.keys(schoolAddresses).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="School address">
            <input
              className={inputClass}
              value={schoolAddress}
              onChange={(e) => setSchoolAddress(e.target.value)}
              placeholder="201 Davids Way, La Vergne, TN 37086"
            />
          </Field>
          {knownSchoolAddress && knownSchoolAddress !== schoolAddress && (
            <button
              type="button"
              onClick={() => setSchoolAddress(knownSchoolAddress)}
              className="mt-1 text-xs font-semibold text-blue-600 underline"
            >
              Use address on file: {knownSchoolAddress}
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Departure time">
            <input
              className={inputClass}
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              placeholder="6:30 AM"
            />
          </Field>
          <Field label="Duration (minutes)">
            <input
              className={inputClass}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              placeholder="25"
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Driver">
            <input className={inputClass} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          </Field>
          <Field label="Distance">
            <input className={inputClass} value={distance} onChange={(e) => setDistance(e.target.value)} />
          </Field>
        </div>
      </div>

      {mode === "add" ? (
        <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
          <span className={labelClass}>Stops</span>
          <textarea
            className={`${inputClass} mt-1 h-48 font-mono text-sm`}
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            placeholder={STEPS_PLACEHOLDER}
          />

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-glossy flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600"
            >
              <UploadIcon className="h-3.5 w-3.5" />
              Upload File
            </button>
            <span className="text-xs text-zinc-400">
              CSV or TSV, one file at a time - multiple files (one route each) is on the roadmap
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              onChange={handleFileChosen}
              className="hidden"
            />
          </div>

          {parseResult.headerless && parseResult.rows.length > 0 && (
            <p className="mt-2 text-xs text-zinc-500">
              No column header recognized - read as a plain list ({parseResult.rows.length} row
              {parseResult.rows.length === 1 ? "" : "s"}).
            </p>
          )}
          {parseResult.unmatchedSourceHeaders.length > 0 && (
            <p className="mt-2 text-xs text-zinc-500">
              Ignored column{parseResult.unmatchedSourceHeaders.length === 1 ? "" : "s"}:{" "}
              {parseResult.unmatchedSourceHeaders.join(", ")}
            </p>
          )}
        </div>
      ) : (
        <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>Stops</span>
            <ToggleSwitch checked={showTurns} onChange={setShowTurns} label="Show turns" />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-700">
              {counts.resolved} resolved, {counts.unresolved} need attention, {counts.skipped}{" "}
              skipped ({counts.total} total)
            </p>
            <button
              type="button"
              onClick={fetchAllLocations}
              disabled={fetchAllRunning || counts.unresolved === 0}
              className="btn-glossy shrink-0 rounded-lg border border-zinc-500 bg-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-50"
            >
              {fetchAllRunning ? "Fetching…" : "Fetch All Locations"}
            </button>
          </div>
          {hasIncompleteRow && (
            <p className="mt-1 text-xs text-red-600">
              Every stop needs at least a type and a location before locations can be checked.
            </p>
          )}
          {fetchError && <p className="mt-1 text-xs text-red-600">{fetchError}</p>}

          <div className="mt-1 max-h-96 overflow-y-auto">
            {visibleRowIndices.map((index) => {
              const row = rows[index];
              const isStop = row.action.toLowerCase() === "stop";
              const waypoint = waypoints[index];
              return (
                <EditableStepRow
                  key={index}
                  row={row}
                  stopNumber={isStop ? (stopNumbers.get(index) ?? null) : null}
                  waypoint={waypoint}
                  status={waypoint ? resolutionRows[index] : undefined}
                  fetching={waypoint ? fetchingStepIds.has(waypoint.stepId) : false}
                  onChange={(patch) => updateRow(index, patch)}
                  onRemove={() => removeRow(index)}
                  onFetch={() => waypoint && waypoint.kind !== "unresolvable" && fetchLocation(waypoint)}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="btn-glossy font-heading mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-2.5 text-base font-semibold text-zinc-900"
          >
            Add Step
          </button>
        </div>
      )}

      {message && <p className="text-sm text-zinc-500">{message}</p>}

      <div className="flex w-full max-w-md flex-col gap-2">
        <button
          type="button"
          onClick={() => handleSave()}
          className="btn-glossy font-heading flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-lg font-bold text-white"
        >
          <SaveIcon className="h-5 w-5" />
          {mode === "add" ? "Create Route" : "Save"}
        </button>

        {mode === "edit" &&
          (canToggleStatus ? (
            <button
              type="button"
              onClick={handleToggleStatus}
              className="btn-glossy font-heading flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-500 bg-zinc-300 py-3 text-base font-semibold text-zinc-900"
            >
              {status === "published" ? "Unpublish" : "Publish"}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 py-3 text-sm font-semibold text-amber-700">
              <WarningIcon className="h-5 w-5 shrink-0" />
              {rows.length === 0
                ? "Add stops before this route can be published."
                : `Can't publish yet - ${counts.unresolved} stop${counts.unresolved === 1 ? "" : "s"} still need${counts.unresolved === 1 ? "s" : ""} geocoding.`}
            </div>
          ))}
      </div>
    </div>
  );
}
