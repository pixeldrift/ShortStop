"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Logo } from "./Logo";
import { ToggleSwitch } from "./ToggleSwitch";
import {
  BackArrowIcon,
  CheckCircleIcon,
  EditIcon,
  MapPinIcon,
  PersonSolidIcon,
  RightArrowIcon,
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
import {
  PLACEHOLDER_DISTANCE,
  PLACEHOLDER_DRIVER_NAME,
  PLACEHOLDER_DURATION_MINUTES,
  SCHOOL_ADDRESS_NOT_YET_PROVIDED,
} from "@/lib/placeholderMeta";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import { resolutionCounts, summarizeRouteResolution } from "@/lib/routeResolutionStatus";
import type { RowResolutionStatus } from "@/lib/routeResolutionStatus";
import { waypointCacheKey } from "@/lib/waypointCache";
import type { WaypointCache, WaypointCacheEntry } from "@/lib/waypointCache";
import type { Route, RouteStatus, SchoolLevel, TripType } from "@/lib/types";
import type { GeocodeResponseBody } from "@/app/api/geocode/route";

// Short on purpose - this box starts small (see the textarea's own
// className below) and only grows with real content, so a long
// multi-example placeholder would just get clipped rather than
// actually helping. The fuller format explanation this used to hold
// (a properly-headered sheet, a plain one-stop-per-line list, or
// stops/turns together with no header at all) still applies exactly
// as before - parseRouteImport.ts does the real work - it's just not
// spelled out here anymore now that Upload File, above, is the
// primary path and this is the secondary one.
const STEPS_PLACEHOLDER =
  "One stop per line, or action,from_at,onto_at,rider_count,side,notes - only the location is ever required.";

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

/** A small resolved/unresolved/skipped indicator - shared between the
 * collapsed row's one-line summary and the expanded editor's own
 * fuller status line below. */
function ResolutionIcon({ status, className }: { status: RowResolutionStatus["status"]; className: string }) {
  if (status === "resolved") return <CheckCircleIcon className={`${className} text-green-600`} />;
  if (status === "skipped") return <span className={`${className} text-center leading-none text-zinc-400`}>–</span>;
  return <XCircleIcon className={`${className} text-red-500`} />;
}

/**
 * One stop/turn's collapsed row - the default view for every row in
 * the list, styled identically to StartScreen's own "View All Stops"
 * rows (numbered pin for a stop, turn arrow for a turn, rider count,
 * notes) so the edit list reads as the same at-a-glance ordered list,
 * not a form. A small resolution icon stands in for the fuller
 * status line the expanded editor shows, and a pencil icon on the far
 * right is the only thing this adds beyond that read-only view -
 * tapping it is the sole way into StepRowEditor below. Deliberately no
 * inputs and no trash can here - editing or deleting a row both only
 * ever happen one at a time, inside the expanded editor.
 */
function StepRowView({
  row,
  stopNumber,
  status,
  locked,
  onEdit,
}: {
  row: RawRouteRow;
  stopNumber: number | null;
  status: RowResolutionStatus | undefined;
  /** True while a different row's editor is open - this row's own
   * pencil is disabled rather than hidden, so it's still clear editing
   * is possible here, just not until the other row's Update/Cancel. */
  locked: boolean;
  onEdit: () => void;
}) {
  const isStop = stopNumber !== null;
  const direction = row.action.toLowerCase() === "left" ? "left" : "right";
  const subheading = row.ontoAt ? `${row.fromAt} & ${row.ontoAt}` : row.fromAt;

  return (
    <div className="flex items-start gap-2 border-b border-zinc-200 py-3 text-left last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
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
          {isStop && row.riderCount && (
            <span className="flex shrink-0 items-center gap-1 text-sm text-zinc-500">
              <PersonSolidIcon className="h-4 w-4" />
              {row.riderCount} rider{row.riderCount === "1" ? "" : "s"}
            </span>
          )}
        </div>
        <p className="truncate text-zinc-700">
          {subheading ? (
            <>
              {subheading}
              {row.side ? ` (${row.side})` : ""}
            </>
          ) : (
            <span className="text-zinc-400 italic">No location yet</span>
          )}
        </p>
        {row.notes && <p className="mt-0.5 text-sm text-zinc-500">{row.notes}</p>}
        {status && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
            <ResolutionIcon status={status.status} className="h-3.5 w-3.5 shrink-0" />
            {status.status === "resolved"
              ? "Geocoded"
              : status.status === "skipped"
                ? "Skipped"
                : "Needs attention"}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onEdit}
        disabled={locked}
        aria-label={isStop ? `Edit stop ${stopNumber}` : "Edit turn"}
        className="mt-0.5 shrink-0 text-zinc-400 active:text-blue-600 disabled:opacity-30"
      >
        <EditIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The expanded form for one row, in place of its collapsed
 * StepRowView - every field editable, plus the same resolution status/
 * Fetch line the old always-editable row had, and Delete/Cancel/Update
 * controls instead of committing every keystroke live. `row` here is a
 * local draft (see EditRouteScreen's `draftRow`), not the committed
 * `rows` entry - Cancel discards it, Update is the only thing that
 * writes it back. The "type" select is what deriveWaypoints.ts
 * actually reads as `action` - changing it between Stop/Turn Left/Turn
 * Right changes how this row's own location gets resolved, not just
 * how it displays.
 */
function StepRowEditor({
  row,
  stopNumber,
  waypoint,
  status,
  fetching,
  onChange,
  onFetch,
  onCancel,
  onDelete,
  onUpdate,
}: {
  row: RawRouteRow;
  stopNumber: number | null;
  /** This row's own last-*committed* location - still derived from
   * EditRouteScreen's real `rows`, not this draft, so Fetch here always
   * geocodes whatever's actually saved; a location edited in this same
   * draft only takes effect once Update commits it. */
  waypoint: WaypointQuery | undefined;
  status: RowResolutionStatus | undefined;
  fetching: boolean;
  onChange: (patch: Partial<RawRouteRow>) => void;
  onFetch: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onUpdate: () => void;
}) {
  const isStop = stopNumber !== null;

  return (
    <div className="border-b border-zinc-200 py-3 text-left last:border-b-0">
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
            <ResolutionIcon status={status.status} className="h-4 w-4 shrink-0" />
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

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete step"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-600 active:bg-red-50"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Delete
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 active:bg-zinc-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onUpdate}
          className="btn-glossy shrink-0 rounded-lg border border-zinc-500 bg-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-900"
        >
          Update
        </button>
      </div>
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
 * The only thing Save ever actually requires is a route number
 * (buildMeta below) - a stub with nothing else filled in yet is a
 * legitimate draft, not an error. `mode: "add"`'s own stops card leads
 * with Upload File, not the paste box - the box is the secondary path,
 * starts small, and grows with whatever ends up in it (typed or
 * uploaded) instead of being a large form field by default.
 *
 * Editing is where the real review lives, and it stops showing raw
 * text at that point - the stops list becomes an ordered list of
 * collapsed rows (StepRowView above), styled like StartScreen's "View
 * All Stops" and just as compact, each with only a resolution icon and
 * a pencil added. Tapping the pencil swaps that one row for its full
 * editor (StepRowEditor) - live resolution status (via
 * routeResolutionStatus.ts), its own "Fetch" button, and Delete/
 * Cancel/Update controls instead of committing every keystroke
 * directly, since real edits here are almost always "tweak one row" or
 * "add one new stop," not a whole form's worth at once. Only one row
 * is ever expanded at a time - every other row's pencil is disabled
 * meanwhile, not hidden, and "Add Step" appends a blank row already
 * expanded for its own first edit. A "Fetch All Locations" button
 * still covers the whole route in one call, and "Publish" is replaced
 * by a warning until every geocodable stop actually resolves.
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
  schools,
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
  /** School name -> address/level, from schools.csv - the school
   * picker below (`schoolOptions`) is built from this table's own keys
   * rather than free text, so a route's address and level are always
   * looked up here instead of typed or picked separately by an admin. */
  schools: Record<string, SchoolInfo>;
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
  // School address and level are never typed or picked separately -
  // both are looked up from `schools` (schools.csv) by whichever name
  // is selected here, below. Real address/level data belongs in that
  // one table, not duplicated into every route that references it.
  const [schoolName, setSchoolName] = useState(route?.schoolName ?? "");
  const schoolInfo: SchoolInfo | undefined = schools[schoolName];
  // A route already being edited whose school isn't in `schools` yet
  // (see schoolOptions below) keeps its own already-known address/
  // level instead of falling back to the generic placeholder/default -
  // picking a *different* school from the dropdown always overrides
  // this with that school's own real table entry.
  const isOriginalUnmatchedSchool = route != null && route.schoolName === schoolName && !schoolInfo;
  const schoolAddress =
    schoolInfo?.address ?? (isOriginalUnmatchedSchool ? route.schoolAddress : SCHOOL_ADDRESS_NOT_YET_PROVIDED);
  const schoolLevel: SchoolLevel =
    schoolInfo?.schoolLevel ?? (isOriginalUnmatchedSchool ? route.schoolLevel : "elementary");
  // Whether `schoolAddress` above is a real, geocodable address rather
  // than the generic "not yet provided" placeholder it falls back to
  // when nothing's selected - unlike that state-backed field before
  // this pass, `schoolAddress` is never actually blank anymore, so
  // gating on this instead of `schoolAddress.trim()` is what still
  // keeps waypoints/canPublish from treating an unselected school as
  // ready.
  const hasRealSchoolAddress = Boolean(schoolInfo) || isOriginalUnmatchedSchool;
  // Every known school, plus - only if it wouldn't otherwise be a real
  // option - whatever school this route already had, so re-opening an
  // existing route never silently drops or blanks out a school
  // schools.csv doesn't have a row for yet.
  const schoolOptions = useMemo(() => {
    const names = Object.keys(schools).sort((a, b) => a.localeCompare(b));
    if (schoolName && !schools[schoolName]) names.push(schoolName);
    return names;
  }, [schools, schoolName]);
  const [tripType, setTripType] = useState<TripType>(route?.tripType ?? "pickup");
  const [departureTime, setDepartureTime] = useState(route?.departureTime ?? "");
  const [driverName, setDriverName] = useState(route?.driverName ?? PLACEHOLDER_DRIVER_NAME);
  // mode "add" only - the paste/upload box. mode "edit" never reads
  // this again after its own one-time seed below; it's the structured
  // `rows` state that's authoritative from then on.
  const [stepsText, setStepsText] = useState(rawStepsText);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepsTextareaRef = useRef<HTMLTextAreaElement>(null);
  // mode "edit" only - seeded once from rawStepsText (whatever CSV
  // shape it came in as, real committed file or a prior edit's own
  // rowsToCsvText output - parseRouteImport reads either fine), then
  // edited structurally (add/remove/change a row) from here on, never
  // re-derived from text again.
  const [rows, setRows] = useState<RawRouteRow[]>(() => parseRouteImport(rawStepsText).rows);
  const [showTurns, setShowTurns] = useState(false);
  // Which row (an index into `rows`) currently has its full editor
  // open, if any - only ever one at a time, matching how this screen's
  // own editing actually happens ("tweak a few details, or add one new
  // waypoint"), not a form for every row at once. `draftRow` is that
  // row's own working copy while expanded - StepRowEditor's onChange
  // only ever touches this, never `rows` directly, so Cancel can
  // discard it and Update is the only path that actually commits it.
  // `newlyAddedIndex` remembers the one row `addRow` just appended (see
  // below) so this same Cancel button removes it outright instead of
  // leaving a blank orphaned row behind - any row that's ever been
  // Updated even once is no longer "new" for this purpose.
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [draftRow, setDraftRow] = useState<RawRouteRow | null>(null);
  const [newlyAddedIndex, setNewlyAddedIndex] = useState<number | null>(null);
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

  // mode "add" only - the paste box starts small (its own min-height,
  // see the textarea's className below) and grows with its content
  // instead of scrolling internally, so an upload or a long paste both
  // read the same way an actual textarea growing under a person's
  // typing would. Recomputed on every stepsText change, including the
  // one `handleFileChosen` makes, so an uploaded file's text expands
  // the box immediately rather than only once someone types into it.
  useEffect(() => {
    const el = stepsTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [stepsText]);

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
    if (mode !== "edit" || hasIncompleteRow || !hasRealSchoolAddress || rows.length === 0) return [];
    return deriveWaypoints(rows, schoolAddress);
  }, [mode, rows, hasIncompleteRow, hasRealSchoolAddress, schoolAddress]);
  const resolutionRows = useMemo(
    () => summarizeRouteResolution(waypoints, cache),
    [waypoints, cache],
  );
  const counts = useMemo(() => resolutionCounts(resolutionRows), [resolutionRows]);
  const canPublish =
    mode === "edit" &&
    !hasIncompleteRow &&
    rows.length > 0 &&
    hasRealSchoolAddress &&
    counts.unresolved === 0;
  // The readiness check only ever gates *publishing* - unpublishing an
  // already-published route (one that's live despite having unresolved
  // waypoints, e.g. before the real geocoding pipeline has ever run
  // against it) is always allowed, no warning needed for that
  // direction.
  const canToggleStatus = status === "published" || canPublish;

  // Opens row `index`'s full editor - always switches straight to it
  // even if a different row's editor is already open (that row's own
  // pencil is disabled while this is true instead, see the render
  // below, so in practice this only ever fires for the one unlocked
  // row). `draftRow` starts as a copy of the real committed row, not a
  // reference to it, so editing it can't touch `rows` until Update.
  function openRowEditor(index: number) {
    setExpandedIndex(index);
    setDraftRow({ ...rows[index] });
  }
  function handleDraftChange(patch: Partial<RawRouteRow>) {
    setDraftRow((prev) => (prev ? { ...prev, ...patch } : prev));
  }
  function handleUpdateRow() {
    if (expandedIndex === null || !draftRow) return;
    const index = expandedIndex;
    setRows((prev) => prev.map((r, i) => (i === index ? draftRow : r)));
    if (newlyAddedIndex === index) setNewlyAddedIndex(null);
    setExpandedIndex(null);
    setDraftRow(null);
  }
  // Discards the draft - for a row that already existed before this
  // edit, that's the whole story (the committed `rows` entry was never
  // touched). For the one row `addRow` just appended and nobody has
  // Updated yet, canceling removes it outright instead, so backing out
  // of adding a step doesn't leave a blank orphaned row in the list.
  function handleCancelRow() {
    if (expandedIndex === null) return;
    if (newlyAddedIndex === expandedIndex) {
      const index = expandedIndex;
      setRows((prev) => prev.filter((_, i) => i !== index));
      setNewlyAddedIndex(null);
    }
    setExpandedIndex(null);
    setDraftRow(null);
  }
  function handleDeleteRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    if (expandedIndex === index) {
      setExpandedIndex(null);
      setDraftRow(null);
    }
    if (newlyAddedIndex === index) setNewlyAddedIndex(null);
  }
  // Appends a blank row and opens it for editing immediately - a new
  // stop or turn always needs its details filled in right away, so
  // there's no point leaving it collapsed first. See handleCancelRow
  // above for what backing out of this specific row does differently
  // from canceling an edit to one that already existed.
  function addRow() {
    const index = rows.length;
    setRows((prev) => [...prev, { ...BLANK_ROW }]);
    setExpandedIndex(index);
    setDraftRow({ ...BLANK_ROW });
    setNewlyAddedIndex(index);
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

  // The only real requirement to save at all - a route number is what
  // gives a draft its own identity (see `id` below), and everything
  // else (school, stops, whether they're geocoded) can genuinely be
  // filled in later. This deliberately lets a stub with nothing but a
  // route number get saved - readiness for anything past that is
  // Publish's own concern (canPublish above), not Save's.
  function buildMeta(nextStatus: RouteStatus): RouteMeta | null {
    if (!routeNumber.trim()) {
      setMessage("Route number is required.");
      return null;
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
      // Real mileage/timing needs actual routing calculation, not an
      // admin's own guess - these stay flat placeholders here the same
      // way they already do for every route loaded from the master
      // list (see page.tsx), filled in for real on the backend later.
      distance: route?.distance ?? PLACEHOLDER_DISTANCE,
      durationMinutes: route?.durationMinutes ?? PLACEHOLDER_DURATION_MINUTES,
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
          {/* School level and address are never picked or typed
              separately - both come from whichever school is chosen
              here, looked up in `schools` (schools.csv). */}
          <Field label="School">
            <select
              className={inputClass}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
            >
              <option value="">Select a school</option>
              {schoolOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
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
        </div>

        {schoolName && (
          <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
            <MapPinIcon className="h-3 w-3 shrink-0 text-blue-500" />
            {schoolAddress}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Departure time">
            <input
              className={inputClass}
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              placeholder="6:30 AM"
            />
          </Field>
          <Field label="Driver">
            <input className={inputClass} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          </Field>
        </div>
      </div>

      {mode === "add" ? (
        <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
          <span className={labelClass}>Stops</span>

          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-glossy flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-500 bg-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-900"
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

          <p className="mt-3 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Or paste manually
          </p>
          {/* Starts small (min-h below) and grows with its own content
              (the height effect above) rather than scrolling internally -
              an uploaded file's text expands it the same way typing
              would, since this is meant to read as secondary either way,
              not a large form field of its own. */}
          <textarea
            ref={stepsTextareaRef}
            className={`${inputClass} mt-1 min-h-[3.5rem] resize-none overflow-hidden font-mono text-sm`}
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            placeholder={STEPS_PLACEHOLDER}
          />

          {missingRequired.length > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              Couldn&apos;t find a column for: {missingRequired.join(", ")} - stops won&apos;t come
              through until that&apos;s fixed, but the route can still be saved as a draft.
            </p>
          )}
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
              const stopNumber = isStop ? (stopNumbers.get(index) ?? null) : null;
              const waypoint = waypoints[index];

              if (expandedIndex === index && draftRow) {
                return (
                  <StepRowEditor
                    key={index}
                    row={draftRow}
                    stopNumber={stopNumber}
                    waypoint={waypoint}
                    status={waypoint ? resolutionRows[index] : undefined}
                    fetching={waypoint ? fetchingStepIds.has(waypoint.stepId) : false}
                    onChange={handleDraftChange}
                    onFetch={() => waypoint && waypoint.kind !== "unresolvable" && fetchLocation(waypoint)}
                    onCancel={handleCancelRow}
                    onDelete={() => handleDeleteRow(index)}
                    onUpdate={handleUpdateRow}
                  />
                );
              }
              return (
                <StepRowView
                  key={index}
                  row={row}
                  stopNumber={stopNumber}
                  status={waypoint ? resolutionRows[index] : undefined}
                  locked={expandedIndex !== null}
                  onEdit={() => openRowEditor(index)}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={addRow}
            disabled={expandedIndex !== null}
            className="btn-glossy font-heading mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-2.5 text-base font-semibold text-zinc-900 disabled:opacity-50"
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
          {mode === "add" ? (
            <>
              Create Route
              <RightArrowIcon className="h-5 w-5" />
            </>
          ) : (
            <>
              <SaveIcon className="h-5 w-5" />
              Save
            </>
          )}
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
