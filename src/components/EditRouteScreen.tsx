"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Logo } from "./Logo";
import { ToggleSwitch } from "./ToggleSwitch";
import {
  BackArrowIcon,
  CheckCircleIcon,
  CloseIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  MapPinIcon,
  PersonSolidIcon,
  PlusIcon,
  RightArrowIcon,
  RoundedTriangleIcon,
  SaveIcon,
  SpinnerIcon,
  TrashIcon,
  TriangleIcon,
  TurnArrow,
  UploadIcon,
  WarningIcon,
  XCircleIcon,
} from "./icons";
import { buildRouteFromRows } from "@/lib/parseRouteCsv";
import type { RawRouteRow, RouteMeta } from "@/lib/parseRouteCsv";
import { deriveWaypoints } from "@/lib/deriveWaypoints";
import type { WaypointQuery } from "@/lib/deriveWaypoints";
import type { ApiQuota, GeocodableQuery } from "@/lib/geocode";
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
import type { RouteResolutionCounts, RowResolutionStatus } from "@/lib/routeResolutionStatus";
import { waypointCacheKey } from "@/lib/waypointCache";
import type { WaypointCache } from "@/lib/waypointCache";
import type { Route, RouteStatus, SchoolLevel, TripType } from "@/lib/types";
import type { GeocodeResponseBody } from "@/app/api/geocode/route";

/** A failed "Fetch"/"Fetch Missing"/"Re-fetch All" call's own error -
 * `message` is this app's own explanation, `raw` (when there is one)
 * is the literal response body a real ORS/Overpass request came back
 * with, kept separate so ErrorDetailsModal can show them distinctly
 * instead of one blended string (see /api/geocode's own GeocodeResponseBody,
 * which carries the same split through its error response). */
interface FetchErrorInfo {
  message: string;
  raw?: string;
}

/** Thrown by callGeocodeApi below on a non-ok response - carries the
 * API's own `raw` field alongside the usual Error `message`, so a
 * catch block can turn it into a FetchErrorInfo without losing `raw`
 * the moment it becomes a thrown exception. */
class GeocodeApiError extends Error {
  raw?: string;
  constructor(message: string, raw?: string) {
    super(message);
    this.raw = raw;
  }
}

/** The single-row "Fetch" button's own cooldown after any one fetch
 * finishes, and the pause `runFetchAll` below waits *between* each
 * query in a batch - one shared value so a manual click and a batch
 * call pace themselves the same courteous amount against a free-tier
 * account either way (this used to be a separate RATE_LIMIT_MS the
 * server paced internally in one request; see runFetchAll's own doc
 * for why that moved to the client). */
const SINGLE_FETCH_COOLDOWN_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `runFetchAll`'s own live status - which query it's currently on,
 * out of how many, so the Fetch Coordinates modal can show real
 * progress instead of one indefinite spinner across the whole batch
 * (see its own doc for why "was it stuck?" needed an actual answer). */
interface BatchProgress {
  completed: number;
  total: number;
  currentLabel: string;
}

// Short on purpose - this box starts small (see the textarea's own
// className below) and only grows with real content, so a long
// multi-example placeholder would just get clipped rather than
// actually helping. The fuller format explanation this used to hold
// (a properly-headered sheet, a plain one-stop-per-line list, or
// stops/turns together with no header at all) still applies exactly
// as before - parseRouteImport.ts does the real work - it's just not
// spelled out here anymore now that Upload File, above, is the
// primary path and this is the secondary one.
const STEPS_PLACEHOLDER = "One stop or turn per line, or delimited fields with headers.";

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

/** A titled card that can fold its own body away - wraps the Route
 * Details and Stops/Turns cards below, each getting its own header
 * (replacing what used to be a plain label inside the card) with a
 * chevron that twirls from pointing right to pointing down as it
 * opens, same direction convention RouteListScreen's own View dropdown
 * caret already uses. Starts open - collapsing is for a long route
 * review where one card is already done and just in the way, not the
 * default first look at either. */
function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="w-full max-w-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-1 pb-1.5"
      >
        <TriangleIcon
          direction="right"
          className={`h-2.5 w-2.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className={labelClass}>{title}</span>
      </button>
      {open && children}
    </div>
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
  // A stop's own from/onto pair reads as an intersection ("Main St &
  // Oak Ave"); a turn's reads as the maneuver itself ("Main St onto
  // Oak Ave") - same shape, different connector word, both set apart
  // from the road names themselves (smaller, gray, italic) so neither
  // reads as though it were part of a name.
  const connector = isStop ? "&" : "onto";
  const subheading = row.ontoAt ? (
    <>
      {row.fromAt} <span className="text-sm font-normal text-zinc-400 italic">{connector}</span>{" "}
      {row.ontoAt}
    </>
  ) : (
    row.fromAt || null
  );

  return (
    <div className="flex items-start gap-2 py-2 text-left">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-heading flex items-center gap-1.5 text-base font-black">
            {isStop ? (
              <>
                <MapPinIcon className="h-4 w-4 shrink-0 text-red-500" />
                Stop {stopNumber}
                {row.side && (
                  <span className="flex items-center gap-0.5 text-sm font-semibold text-zinc-400">
                    (on {row.side.toLowerCase()}
                    <RoundedTriangleIcon
                      direction={row.side.toLowerCase() === "left" ? "left" : "right"}
                      className="h-3 w-3"
                    />
                    )
                  </span>
                )}
              </>
            ) : (
              <>
                <TurnArrow direction={direction} className="h-4 w-4 shrink-0" />
                Turn {direction === "left" ? "Left" : "Right"}
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
          {subheading || <span className="text-zinc-400 italic">No location yet</span>}
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
  fetchLocked,
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
  /** This row's own request is actually in flight right now - drives
   * the button's "Fetching…" label specifically. */
  fetching: boolean;
  /** True for `fetching` above *or* for the shared cooldown afterward
   * (see EditRouteScreen's own singleFetchCoolingDown) - drives the
   * button's disabled state, separately from its label, so it reads
   * "Fetch" (not "Fetching…") while merely cooling down. */
  fetchLocked: boolean;
  onChange: (patch: Partial<RawRouteRow>) => void;
  onFetch: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onUpdate: () => void;
}) {
  const isStop = stopNumber !== null;
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  return (
    <div className="py-2 text-left">
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
            {status.status === "unresolved" && status.detail ? (
              <span className="flex min-w-0 items-center gap-1 text-zinc-500">
                <span className="truncate">{status.reason}</span>
                <button
                  type="button"
                  onClick={() => setShowErrorDetail(true)}
                  className="shrink-0 font-semibold text-red-600 underline underline-offset-2"
                >
                  View Error
                </button>
              </span>
            ) : (
              <span className="truncate text-zinc-500">
                {status.status === "resolved"
                  ? `${waypointLabel(waypoint)} (${status.lat.toFixed(5)}, ${status.lon.toFixed(5)})`
                  : status.status === "skipped"
                    ? `Skipped: ${status.reason}`
                    : status.reason}
              </span>
            )}
          </span>
          {status.status !== "skipped" && (
            <button
              type="button"
              onClick={onFetch}
              disabled={fetchLocked}
              className="shrink-0 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 disabled:opacity-50"
            >
              {fetching ? "Fetching…" : "Fetch"}
            </button>
          )}
        </div>
      )}

      {showErrorDetail && status?.status === "unresolved" && status.detail && (
        <ErrorDetailsModal
          message={status.detail}
          raw={status.raw}
          onClose={() => setShowErrorDetail(false)}
        />
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

/** A slim "insert a step here" control - shown before the first row
 * and after every row below (not just once at the bottom), so a new
 * stop or turn can be dropped in anywhere along the route's real
 * order, not only appended past the last one. Disabled while a
 * different row's own editor is open, same as every other action here
 * that would move rows out from under it. */
function AddStepButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <div className="relative flex items-center justify-center py-1">
      <div className="absolute inset-x-0 border-t border-dashed border-zinc-200" />
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Add step here"
        className="btn-glossy relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-500 bg-zinc-300 text-zinc-900 disabled:opacity-30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The paste box's own quick reference - what column headers this
 * screen's import (parseRouteImport.ts) recognizes and a few example
 * rows, so a pasted/uploaded sheet's shape doesn't have to be guessed
 * at. Same modal shell as StartScreen's AllStopsModal (full-screen dim,
 * centered card, backdrop tap or the corner X to close). */
function StopsFormatModal({ onClose }: { onClose: () => void }) {
  const exampleRows: string[][] = [
    ["Stop", "Main St & Oak Ave", "", "3", "Right", ""],
    ["Left", "Main St", "Elm St", "", "", ""],
    ["Stop", "123 Maple Dr", "", "1", "Left", "Ring doorbell"],
  ];

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-[var(--background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="font-heading text-xl font-black tracking-tight">Stops Format</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 text-left">
          <p className="text-sm text-zinc-600">
            Only <code className="font-mono text-xs">action</code> and{" "}
            <code className="font-mono text-xs">from_at</code> are required - every other column
            can be left blank.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full min-w-[32rem] border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-100 text-zinc-500 uppercase">
                  {["action", "from_at", "onto_at", "rider_count", "side", "notes"].map((header) => (
                    <th
                      key={header}
                      className="border-b border-zinc-200 px-2 py-1.5 text-left font-semibold"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {exampleRows.map((row, i) => (
                  <tr key={i} className="odd:bg-white even:bg-zinc-50">
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-1.5 text-zinc-700">
                        {cell || <span className="text-zinc-300">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-zinc-600">
            No header row works too - one stop or turn per line, same as the paste box&apos;s own
            placeholder shows.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * This app's own explanation of a failed lookup ("OpenRouteService
 * geocoding returned 403 Forbidden for...", "No shared node found in
 * the search box") behind its own "View Error" popup, rather than
 * inline in the main interface where an admin is just trying to
 * review stops - the friendly line next to that button ("Oops, could
 * not look up coordinates.") is the only thing shown by default; this
 * is purely opt-in detail for troubleshooting *why*. Stacks above
 * whichever modal opened it (z-30, one above every other modal in this
 * screen's own z-20) since both call sites here - a row's own status
 * line, and the Fetch Coordinates modal - can trigger this while
 * already inside their own overlay.
 *
 * `raw`, when there is one, is the literal response body ORS/Overpass
 * itself sent back - not this app's own writing at all, unlike
 * `message` - so it's set apart in its own monospaced "Returned:"
 * block instead of blending into the same prose. Omitted entirely
 * when there's genuinely nothing to quote (an internal miss like "no
 * shared node," never a real HTTP response) rather than showing an
 * empty block.
 */
function ErrorDetailsModal({
  message,
  raw,
  onClose,
}: {
  message: string;
  raw?: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-black tracking-tight">Error Details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-sm text-zinc-600">{message}</p>
        {raw && (
          <>
            <p className="mt-3 text-sm text-zinc-600">Returned:</p>
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs whitespace-pre-wrap break-words text-zinc-700">
              {raw}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

/** OpenRouteService's own account-wide rate limit, drawn as a small
 * health-meter bar - green while there's plenty left, amber then red
 * as it runs low, the same "fuel gauge" reading any of those colors
 * already implies. Only ever rendered when a real quota is known (see
 * geocode.ts's own getLastKnownOrsQuota) - there's no "unknown" bar,
 * just no bar at all. */
function QuotaMeter({ quota }: { quota: ApiQuota }) {
  const fraction = quota.limit > 0 ? Math.max(0, Math.min(1, quota.remaining / quota.limit)) : 0;
  const barColor = fraction > 0.5 ? "bg-green-500" : fraction > 0.2 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
        <span>API quota remaining</span>
        <span>
          {quota.remaining} / {quota.limit}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
        <div
          className={`h-full rounded-full transition-[width] ${barColor}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Opens from the Stops card's "Fetch Coordinates…" button - shows
 * where the route's own waypoints currently stand (valid/missing/
 * skipped, the same counts that used to sit inline on the card itself)
 * and OpenRouteService's own rate limit if the last real request
 * happened to report one. "Fetch Missing" only spends calls on rows
 * that aren't already resolved (the old "Fetch All Locations"
 * button's own behavior); "Re-fetch All" deliberately re-spends a call
 * on every geocodable row, "ok" ones included, for when an admin
 * suspects a previously-resolved coordinate is actually wrong - both
 * live here now instead of a single button, since which one an admin
 * wants depends on exactly what this modal already shows them.
 */
function FetchCoordinatesModal({
  counts,
  quota,
  fetchRunning,
  batchProgress,
  fetchError,
  onFetchMissing,
  onRefetchAll,
  onDownload,
  onClose,
}: {
  counts: RouteResolutionCounts;
  quota: ApiQuota | null;
  fetchRunning: boolean;
  batchProgress: BatchProgress | null;
  fetchError: FetchErrorInfo | null;
  onFetchMissing: () => void;
  onRefetchAll: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-black tracking-tight">Fetch Coordinates</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-green-200 bg-green-50 py-3 text-center">
            <p className="font-heading text-2xl font-black text-green-700">{counts.resolved}</p>
            <p className="text-xs font-semibold tracking-wide text-green-700 uppercase">Valid</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 py-3 text-center">
            <p className="font-heading text-2xl font-black text-red-600">{counts.unresolved}</p>
            <p className="text-xs font-semibold tracking-wide text-red-600 uppercase">Missing</p>
          </div>
        </div>
        {counts.skipped > 0 && (
          <p className="mt-2 text-center text-xs text-zinc-400">
            {counts.skipped} skipped ({counts.total} total)
          </p>
        )}

        {quota && (
          <div className="mt-4">
            <QuotaMeter quota={quota} />
          </div>
        )}

        {/* Reserves its own height whether or not there's anything to
            show, so the buttons below don't jump up and down as a
            fetch starts/finishes. batchProgress (not just fetchRunning)
            gates the bar itself - real per-item progress, not a single
            indefinite spinner across the whole batch, is the whole
            point: an admin watching the count and label advance can
            tell it's genuinely working through the list, versus a
            plain spinner that looks identical whether it's on query 1
            or stuck dead. */}
        <div className="mt-4 flex min-h-[1.25rem] flex-col items-center justify-center gap-1.5 text-center">
          {fetchRunning && batchProgress ? (
            <>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-600">
                <SpinnerIcon className="h-4 w-4 animate-spin" />
                Fetching {Math.min(batchProgress.completed + 1, batchProgress.total)} of {batchProgress.total}…
              </p>
              <p className="max-w-full truncate text-xs text-zinc-400">{batchProgress.currentLabel}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width]"
                  style={{ width: `${(batchProgress.completed / batchProgress.total) * 100}%` }}
                />
              </div>
            </>
          ) : (
            fetchError && (
              <p className="flex items-center gap-1.5 text-sm text-red-600">
                Oops, could not look up coordinates.
                <button
                  type="button"
                  onClick={() => setShowErrorDetail(true)}
                  className="font-semibold underline underline-offset-2"
                >
                  View Error
                </button>
              </p>
            )
          )}
        </div>

        {showErrorDetail && fetchError && (
          <ErrorDetailsModal
            message={fetchError.message}
            raw={fetchError.raw}
            onClose={() => setShowErrorDetail(false)}
          />
        )}

        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={onRefetchAll}
            disabled={fetchRunning || counts.total === 0}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-50"
          >
            Re-fetch All
          </button>
          <button
            type="button"
            onClick={onFetchMissing}
            disabled={fetchRunning || counts.unresolved === 0}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Fetch Missing
          </button>
        </div>

        {/* A stopgap until there's a real place to persist this (see
            README) - hands the resolved coordinates over as a file
            shaped exactly like the real committed sidecar cache, ready
            to pass along and drop straight into public/data/. */}
        <button
          type="button"
          onClick={onDownload}
          disabled={counts.resolved === 0}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-zinc-500 underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
        >
          <SaveIcon className="h-4 w-4" />
          Download Coordinates
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
  // Defaults to on here (unlike StartScreen's own "View All Stops",
  // which defaults to stops-only) - reviewing a route for editing is
  // exactly when seeing every turn in its real place matters most.
  const [showTurns, setShowTurns] = useState(true);
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
  // mode "add" only - the paste box's own "Details" link, see
  // StopsFormatModal above.
  const [showFormatModal, setShowFormatModal] = useState(false);

  // The school's own geocoded point, once known - reused across every
  // "Fetch"/"Fetch All" call in this edit session instead of
  // re-geocoding the school address on every single click (see
  // /api/geocode's own doc comment for why that specific repeat is
  // worse than merely wasteful - it's what actually triggered a live
  // 403 in production).
  const [schoolAnchor, setSchoolAnchor] = useState<{ lat: number; lon: number } | null>(null);
  const [fetchingStepIds, setFetchingStepIds] = useState<ReadonlySet<number>>(new Set());
  // Blocks *every* single-row "Fetch" button, not just whichever row
  // was just fetched - only one row can be expanded/edited at a time,
  // but Cancel closes the editor without waiting for its own in-flight
  // fetch to finish, so a fast admin could otherwise cancel, open a
  // different row, and fire a second real ORS/Overpass call with zero
  // pacing between them. Set the moment a single fetch starts (not
  // just once it resolves) and held for SINGLE_FETCH_COOLDOWN_MS after
  // it finishes either way - "slow, then block," the same free-tier
  // courtesy runFetchAll's own RATE_LIMIT_MS already pays a batch, just
  // enforced by disabling the button instead of an internal sleep,
  // since nothing here is looping on its own to pace.
  const [singleFetchCoolingDown, setSingleFetchCoolingDown] = useState(false);
  const [fetchAllRunning, setFetchAllRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [fetchError, setFetchError] = useState<FetchErrorInfo | null>(null);
  const [showFetchModal, setShowFetchModal] = useState(false);
  // OpenRouteService's own account-wide rate limit, if the last batch
  // that made a real ORS call happened to report one - see geocode.ts's
  // own getLastKnownOrsQuota doc comment for why this isn't guaranteed.
  const [quota, setQuota] = useState<ApiQuota | null>(null);

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
  // Inserts a blank row at `index` (`rows.length` appends, same as the
  // old always-at-the-end behavior this replaces) and opens it for
  // editing immediately - a new stop or turn always needs its details
  // filled in right away, so there's no point leaving it collapsed
  // first. Only ever called while nothing else is expanded (every
  // "Add Step" control below is disabled otherwise), so inserting
  // partway through never has to shift an already-open row's own index
  // out from under it. See handleCancelRow above for what backing out
  // of this specific row does differently from canceling an edit to
  // one that already existed.
  function addRow(index: number) {
    setRows((prev) => {
      const next = [...prev];
      next.splice(index, 0, { ...BLANK_ROW });
      return next;
    });
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

  async function callGeocodeApi(query: GeocodableQuery): Promise<GeocodeResponseBody> {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        schoolAddress,
        anchor: schoolAnchor ?? undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new GeocodeApiError(data.error ?? `${res.status} ${res.statusText}`, data.raw);
    return data as GeocodeResponseBody;
  }

  async function fetchLocation(waypoint: GeocodableQuery) {
    if (singleFetchCoolingDown) return; // the button's own disabled state should already prevent this
    setFetchError(null);
    setSingleFetchCoolingDown(true);
    setFetchingStepIds((prev) => new Set(prev).add(waypoint.stepId));
    try {
      const data = await callGeocodeApi(waypoint);
      if (data.anchor) setSchoolAnchor(data.anchor);
      if (data.quota) setQuota(data.quota);
      const key = waypointCacheKey(waypoint);
      setCache((prev) => ({ ...prev, [key]: data.result }));
    } catch (err) {
      setFetchError({
        message: err instanceof Error ? err.message : String(err),
        raw: err instanceof GeocodeApiError ? err.raw : undefined,
      });
    } finally {
      setFetchingStepIds((prev) => {
        const next = new Set(prev);
        next.delete(waypoint.stepId);
        return next;
      });
      window.setTimeout(() => setSingleFetchCoolingDown(false), SINGLE_FETCH_COOLDOWN_MS);
    }
  }

  // Shared by both Fetch Coordinates modal buttons below - they only
  // differ in which waypoints they decide are worth spending a call
  // on. Loops one query at a time against the single-query endpoint
  // (rather than sending the whole list in one request, which is what
  // this used to do) specifically so batchProgress can update after
  // every real response - a single request-response round trip for
  // the whole batch has no way to show "3 of 12" partway through, or
  // to distinguish "still working" from "actually stuck," short of
  // building real server-side streaming for what's still an
  // admin-only tool (see /api/geocode's own doc on that tradeoff).
  // `cache`/`schoolAnchor` both update after each item lands too, so a
  // batch that fails partway through still keeps whatever it already
  // resolved rather than losing it with the rest.
  async function runFetchAll(toFetch: GeocodableQuery[]) {
    if (toFetch.length === 0) return;

    setFetchError(null);
    setFetchAllRunning(true);
    setFetchingStepIds(new Set(toFetch.map((w) => w.stepId)));
    setBatchProgress({ completed: 0, total: toFetch.length, currentLabel: waypointLabel(toFetch[0]) });
    try {
      for (const [index, waypoint] of toFetch.entries()) {
        setBatchProgress({ completed: index, total: toFetch.length, currentLabel: waypointLabel(waypoint) });
        if (index > 0) await sleep(SINGLE_FETCH_COOLDOWN_MS);

        const data = await callGeocodeApi(waypoint);
        if (data.anchor) setSchoolAnchor(data.anchor);
        if (data.quota) setQuota(data.quota);
        const key = waypointCacheKey(waypoint);
        setCache((prev) => ({ ...prev, [key]: data.result }));
        setFetchingStepIds((prev) => {
          const next = new Set(prev);
          next.delete(waypoint.stepId);
          return next;
        });
      }
      setBatchProgress((prev) => (prev ? { ...prev, completed: toFetch.length } : prev));
    } catch (err) {
      setFetchError({
        message: err instanceof Error ? err.message : String(err),
        raw: err instanceof GeocodeApiError ? err.raw : undefined,
      });
    } finally {
      setFetchAllRunning(false);
      setFetchingStepIds(new Set());
      setBatchProgress(null);
    }
  }

  // Only spends calls on what isn't already resolved - the Fetch
  // Coordinates modal's "Fetch Missing" button.
  function fetchMissingLocations() {
    return runFetchAll(
      waypoints.filter(
        (w): w is GeocodableQuery => w.kind !== "unresolvable" && cache[waypointCacheKey(w)]?.status !== "ok",
      ),
    );
  }

  // Deliberately re-spends a call on every geocodable row, "ok" ones
  // included - the modal's "Re-fetch All" button, for when an admin
  // suspects a previously-resolved coordinate is actually wrong.
  function refetchAllLocations() {
    return runFetchAll(waypoints.filter((w): w is GeocodableQuery => w.kind !== "unresolvable"));
  }

  // A stopgap until there's somewhere real to persist this (see
  // README - the whole admin flow is session-only in-memory right
  // now): saves the exact same shape a real `npm run geocode` run
  // would - only "ok" entries, only ones this route's current CSV
  // still references (mirroring geocodeRoute.ts's own pruning, so a
  // row edited away mid-session doesn't leave an orphaned entry in the
  // download) - named to match its real sidecar file exactly, so it
  // can be handed over and dropped straight into public/data/ with no
  // renaming.
  function downloadCacheFile() {
    const currentKeys = new Set(
      waypoints.filter((w): w is GeocodableQuery => w.kind !== "unresolvable").map(waypointCacheKey),
    );
    const toSave: WaypointCache = {};
    for (const key of currentKeys) {
      const entry = cache[key];
      if (entry?.status === "ok") toSave[key] = entry;
    }

    const baseName = stepsCsvBaseName({ routeNumber, tripType, schoolLevel });
    const blob = new Blob([JSON.stringify(toSave, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}-waypoints.json`;
    link.click();
    URL.revokeObjectURL(url);
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

      <CollapsibleSection title="Route Details">
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
      </CollapsibleSection>

      <CollapsibleSection title="Stops and Turns">
        {mode === "add" ? (
          <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-glossy flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-500 bg-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-900"
              >
                <UploadIcon className="h-3.5 w-3.5" />
                Upload File
              </button>
              <span className="text-xs text-zinc-400">CSV or TSV</span>
              <button
                type="button"
                onClick={() => setShowFormatModal(true)}
                className="text-xs font-semibold text-blue-600 underline underline-offset-2"
              >
                Details
              </button>
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
            <div className="flex items-center justify-between gap-3">
              <ToggleSwitch checked={showTurns} onChange={setShowTurns} label="Show turns" />
              <button
                type="button"
                onClick={() => setShowFetchModal(true)}
                className="btn-glossy flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-500 bg-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-900"
              >
                <GlobeIcon className="h-3.5 w-3.5" />
                Fetch Coordinates…
              </button>
            </div>
            {hasIncompleteRow && (
              <p className="mt-1 text-xs text-red-600">
                Every stop needs at least a type and a location before locations can be checked.
              </p>
            )}

            {/* An "Add Step" control before the first row and after
                every row, not just once at the bottom - a new stop or
                turn can be dropped in anywhere along the route's real
                order this way, not only appended past the last one. */}
            <div className="mt-1 max-h-96 overflow-y-auto">
              <AddStepButton onClick={() => addRow(0)} disabled={expandedIndex !== null} />
              {visibleRowIndices.map((index) => {
                const row = rows[index];
                const isStop = row.action.toLowerCase() === "stop";
                const stopNumber = isStop ? (stopNumbers.get(index) ?? null) : null;
                const waypoint = waypoints[index];

                return (
                  <div key={index}>
                    {expandedIndex === index && draftRow ? (
                      <StepRowEditor
                        row={draftRow}
                        stopNumber={stopNumber}
                        waypoint={waypoint}
                        status={waypoint ? resolutionRows[index] : undefined}
                        fetching={waypoint ? fetchingStepIds.has(waypoint.stepId) : false}
                        fetchLocked={singleFetchCoolingDown}
                        onChange={handleDraftChange}
                        onFetch={() => waypoint && waypoint.kind !== "unresolvable" && fetchLocation(waypoint)}
                        onCancel={handleCancelRow}
                        onDelete={() => handleDeleteRow(index)}
                        onUpdate={handleUpdateRow}
                      />
                    ) : (
                      <StepRowView
                        row={row}
                        stopNumber={stopNumber}
                        status={waypoint ? resolutionRows[index] : undefined}
                        locked={expandedIndex !== null}
                        onEdit={() => openRowEditor(index)}
                      />
                    )}
                    <AddStepButton onClick={() => addRow(index + 1)} disabled={expandedIndex !== null} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CollapsibleSection>

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
              {status === "published" ? (
                <EyeOffIcon className="h-5 w-5" />
              ) : (
                <EyeIcon className="h-5 w-5" />
              )}
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

      {showFormatModal && <StopsFormatModal onClose={() => setShowFormatModal(false)} />}
      {showFetchModal && (
        <FetchCoordinatesModal
          counts={counts}
          quota={quota}
          fetchRunning={fetchAllRunning}
          batchProgress={batchProgress}
          fetchError={fetchError}
          onFetchMissing={fetchMissingLocations}
          onRefetchAll={refetchAllLocations}
          onDownload={downloadCacheFile}
          onClose={() => setShowFetchModal(false)}
        />
      )}
    </div>
  );
}
