"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { ToggleSwitch } from "./ToggleSwitch";
import { TripTypeIcon } from "./TripTypeIcon";
import { PlaceCoordinatesModal } from "./PlaceCoordinatesModal";
import { LA_VERGNE_CENTER } from "./RouteMap";
import {
  ActionIcon,
  BackArrowIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  DragHandleIcon,
  EditIcon,
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
import {
  buildRouteFromRows,
  formatWaypointInstruction,
} from "@/lib/parseRouteCsv";
import type { RawRouteRow, RouteMeta } from "@/lib/parseRouteCsv";
import { deriveWaypointsWithContext } from "@/lib/deriveWaypoints";
import type { WaypointQuery } from "@/lib/deriveWaypoints";
import { downloadCsv, routeStepsToCsv } from "@/lib/exportCsv";
import type { GeocodableQuery } from "@/lib/geocode";
import {
  matchSchoolFromRows,
  parseRouteImport,
  RECOGNIZED_ACTIONS,
  unresolvedRequiredFields,
} from "@/lib/parseRouteImport";
import { parseRouteFilename } from "@/lib/parseRouteMasterList";
import {
  PLACEHOLDER_DISTANCE,
  PLACEHOLDER_DURATION_MINUTES,
  SCHOOL_ADDRESS_NOT_YET_PROVIDED,
} from "@/lib/placeholderMeta";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import {
  resolutionCounts,
  summarizeRouteResolution,
} from "@/lib/routeResolutionStatus";
import type {
  RouteResolutionCounts,
  RowResolutionStatus,
} from "@/lib/routeResolutionStatus";
import { tripTypeFullLabel } from "@/lib/tripType";
import { waypointCacheKey } from "@/lib/waypointCache";
import type { WaypointCache, WaypointCacheEntry } from "@/lib/waypointCache";
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
  /** True only for a real 429 from the geocoder - shown as its own
   * plain "you hit the limit" message rather than the generic
   * error+"View Error" treatment, since there's no useful detail to
   * dig into, just a wait-and-retry. */
  rateLimited?: boolean;
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

/** One coordinate value, typed either as a plain signed decimal
 * ("-86.54681") or with its own degree symbol and hemisphere letter
 * ("86.54681° W" - a common copy-paste format off a map app) - the
 * letter's sign wins over a redundant/contradictory leading "-", same
 * as how any map app itself would read "-86.54681° W" (still west).
 * Null if it doesn't look like a coordinate at all. */
function parseCoordinatePart(raw: string): number | null {
  const match = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const hemisphere = match[2]?.toUpperCase();
  if (hemisphere === "S" || hemisphere === "W") return -Math.abs(value);
  if (hemisphere === "N" || hemisphere === "E") return Math.abs(value);
  return value;
}

/** StepRowEditor's own Latitude/Longitude box, parsed - a comma
 * between the two values when one is present (needed so "86.54681°
 * W"'s own space, between the symbol and the hemisphere letter,
 * isn't mistaken for the lat/lon separator), otherwise split on
 * whitespace/tab same as a plain "36.05274 -86.54681" always has.
 * Null unless this resolves to exactly two real coordinate values. */
function parseLatLon(text: string): [number, number] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.includes(",")
    ? trimmed.split(",")
    : trimmed.split(/\s+/);
  if (parts.length !== 2) return null;
  const lat = parseCoordinatePart(parts[0]);
  const lon = parseCoordinatePart(parts[1]);
  return lat != null && lon != null ? [lat, lon] : null;
}

/** Icon + "full crossroads" text for one row - PlaceCoordinatesModal's
 * own context lines (the row being placed, plus its immediate
 * previous/next neighbors) need both roads of an intersection, not
 * just the one formatWaypointInstruction names for a turn ("Left onto
 * Rock Springs Rd," the destination road only - Stop/Depart/Arrive
 * already get both via their own "at {from} & {to}" phrasing, so this
 * only actually changes anything for a turn-kind action). Deliberately
 * its own function rather than a formatWaypointInstruction change -
 * that one still drives the real app (StepRowView's collapsed rows,
 * spoken turn-by-turn announcements), where this fuller phrasing was
 * never asked for and would read oddly out loud. */
function crossroadsLine(
  row: RawRouteRow,
  stopNumber: number | null,
  previousRoad: string | null,
  schools: Record<string, SchoolInfo>,
): { icon: React.ReactNode; text: string } {
  const actionLower = row.action.toLowerCase();
  const isStop = actionLower === "stop";
  const isSchoolAction = actionLower === "depart" || actionLower === "arrive";
  const isStopKind = isStop || isSchoolAction || actionLower === "complete";
  const turnDirection =
    actionLower === "left" ? "left" : actionLower === "right" ? "right" : null;

  const target = row.location.trim().toLowerCase();
  const matchedSchool = target
    ? Object.keys(schools).some((name) => name.trim().toLowerCase() === target)
    : false;
  const isPlainLocation = /^\d/.test(row.location.trim()) || matchedSchool;
  const effectiveFrom = isPlainLocation
    ? ""
    : row.fromLocation || previousRoad || "";

  const icon = isStop ? (
    <MapPinIcon className="h-4 w-4 shrink-0 text-red-500" />
  ) : isSchoolAction ? (
    <ActionIcon
      action={row.action}
      className="h-4 w-4 shrink-0 text-blue-600"
    />
  ) : turnDirection ? (
    <TurnArrow direction={turnDirection} className="h-4 w-4 shrink-0" />
  ) : (
    <ActionIcon action={row.action} className="h-4 w-4 shrink-0" />
  );

  const text =
    !isStopKind && effectiveFrom
      ? `${row.action || "Turn"} from ${effectiveFrom} onto ${row.location}`
      : formatWaypointInstruction(row, stopNumber, effectiveFrom);

  return { icon, text };
}

/** PlaceCoordinatesModal's own starting guess for a given row - the
 * nearest already-resolved waypoint walking outward from `index` in
 * each direction, averaged when both sides find one, a single side's
 * own point when only one does, null when neither has resolved yet
 * (the modal falls back to its own fixed default in that case). Walks
 * past `index` itself in both directions rather than stopping at the
 * immediate neighbor - an unresolved row right next to this one
 * shouldn't end the search early when a resolved one is only one
 * step further out. */
function nearestResolvedGuess(
  resolutionRows: RowResolutionStatus[],
  index: number,
): { lat: number; lon: number } | null {
  let before: { lat: number; lon: number } | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const row = resolutionRows[i];
    if (row?.status === "resolved") {
      before = { lat: row.lat, lon: row.lon };
      break;
    }
  }
  let after: { lat: number; lon: number } | null = null;
  for (let i = index + 1; i < resolutionRows.length; i++) {
    const row = resolutionRows[i];
    if (row?.status === "resolved") {
      after = { lat: row.lat, lon: row.lon };
      break;
    }
  }
  if (before && after) {
    return {
      lat: (before.lat + after.lat) / 2,
      lon: (before.lon + after.lon) / 2,
    };
  }
  return before ?? after;
}

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
const STEPS_PLACEHOLDER =
  "One stop or turn per line, or delimited fields with headers.";

// "Next Action" own third choice, alongside ending the trip
// (nextRouteId null) or chaining into a real other route (nextRouteId
// set to that route's own id) - stored in that same Route.nextRouteId
// field as a fixed string no real route id could ever collide with
// (every real one is `${routeNumber}-${tripType}-${schoolLevel}`,
// always hyphenated - see types.ts). See the Next Action field's own
// doc comment below for what this does and doesn't mean yet.
const DEPOT_NEXT_ACTION = "depot";

const BLANK_ROW: RawRouteRow = {
  action: "Stop",
  location: "",
  fromLocation: "",
  riderCount: "",
  side: "",
  notes: "",
  skip: false,
};

// placeholder:text-zinc-300 - much lighter than the browser/Tailwind
// default placeholder color, so a hint never reads as though it were
// an actual typed-in value at a glance (see each field's own
// placeholder text below, deliberately example-shaped rather than
// real-looking - "123", not "125", an actual route/bus number already
// in use elsewhere in this app's own real data).
const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base placeholder:text-zinc-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none";
const labelClass =
  "text-xs font-semibold tracking-wide text-zinc-500 uppercase";

// The exact values StepRowEditor's own Type <select> below offers, in
// display order - reused for that select's own value (falling back to
// "" for a value that isn't one of these, rather than a browser
// silently rendering no option highlighted at all) and for
// rowValidationIssue below, so neither can drift out of sync with what
// an admin can actually pick.
const WAYPOINT_TYPES = [
  "Stop",
  "Left",
  "Right",
  "Continue",
  "U-Turn",
  "Turn Around",
  "Proceed",
  "Pull Over",
  "Return",
  "Depart",
  "Arrive",
] as const;
const WAYPOINT_TYPE_SET = new Set<string>(WAYPOINT_TYPES);

/** A concrete reason a row's own raw data can't be trusted, or null
 * when it's fine - the main way a row actually ends up this way is a
 * loosely-typed import (a blank or misspelled action cell, a location
 * column that didn't map), but the check itself doesn't care how the
 * row got here. Read by StepRowView below to flag the row with a red
 * border and a warning triangle carrying this same message, so a bad
 * import surfaces immediately in the stops list rather than only once
 * an admin happens to expand that one row. */
function rowValidationIssue(row: RawRouteRow): string | null {
  if (!RECOGNIZED_ACTIONS.has(row.action.trim().toLowerCase())) {
    return row.action.trim()
      ? `Unrecognized waypoint type "${row.action}".`
      : "Missing a waypoint type.";
  }
  if (!row.location.trim()) return "Missing a location.";
  return null;
}

/** Same shape as inputClass, swapped to a red border/focus ring - a
 * required field (Route #, Trip, School - see requiredFieldErrors)
 * still blank the moment a submit attempt is actually made, so it's
 * obvious *which* of the three needs attention rather than just the
 * one summary message. Never shown before that first attempt (see
 * `showRequiredErrors`) - a blank required field on first paint isn't
 * an error yet, just unfilled. */
const errorInputClass =
  "w-full rounded-lg border border-red-500 bg-white px-3 py-2 text-base placeholder:text-zinc-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none";

function Field({
  label,
  required,
  children,
}: {
  label: React.ReactNode;
  /** Shows a red asterisk after the label - only while this field is
   * still genuinely unset, per the caller's own check (e.g.
   * `!routeNumber.trim()`), so it disappears the moment a value is
   * actually there rather than nagging permanently. */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>
        {label}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </span>
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
function ResolutionIcon({
  status,
  className,
}: {
  status: RowResolutionStatus["status"];
  className: string;
}) {
  if (status === "resolved")
    return <CheckCircleIcon className={`${className} text-green-600`} />;
  if (status === "skipped")
    return (
      <span className={`${className} text-center leading-none text-zinc-400`}>
        –
      </span>
    );
  return <XCircleIcon className={`${className} text-red-500`} />;
}

/**
 * One stop/turn's collapsed row - the default view for every row in
 * the list, styled identically to StartScreen's own "View All Stops"
 * rows (numbered pin for a stop, turn arrow for a turn, rider count,
 * notes) so the edit list reads as the same at-a-glance ordered list,
 * not a form. A small resolution icon stands in for the fuller
 * status line the expanded editor shows. Two tap targets sit on the
 * far right beyond that read-only view: a blue pencil (the sole way
 * into StepRowEditor below) and, right of it, a drag handle for
 * reordering the row within the route. Deliberately no inputs and no
 * trash can here - editing or deleting a row both only ever happen
 * one at a time, inside the expanded editor.
 */
function StepRowView({
  row,
  stopNumber,
  previousRoad,
  schools,
  status,
  locked,
  onEdit,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  row: RawRouteRow;
  stopNumber: number | null;
  /** The road deriveWaypoints.ts already has tracked as "current"
   * heading into this row - shown as this row's own effective from-
   * road whenever it doesn't have an explicit `fromLocation` of its
   * own, the same inferred value StepRowEditor's own placeholder
   * shows. */
  previousRoad: string | null;
  /** Every known school, by name - same lookup StepRowEditor uses, so
   * this collapsed row's own subheading agrees with the expanded
   * editor about whether `location` is a school (see isPlainLocation
   * below) rather than showing a stray "& <previous road>" next to a
   * school name the editor itself already treats as its own address. */
  schools: Record<string, SchoolInfo>;
  status: RowResolutionStatus | undefined;
  /** True while a different row's editor is open - this row's own
   * pencil (and drag handle) are disabled rather than hidden, so it's
   * still clear editing/reordering is possible here, just not until
   * the other row's Update/Cancel. */
  locked: boolean;
  onEdit: () => void;
  /** Pointer Events, not native HTML5 drag-and-drop - the native
   * `draggable` attribute this used at first never fires a single drag
   * event on a touch screen (no polyfill, and this app's own real
   * device is a tablet/phone, not a mouse), so reordering silently did
   * nothing there. Pointer Events fire identically for mouse and touch
   * input, so the same three handlers below drive the whole gesture on
   * either: onDragStart captures the pointer (so the handle keeps
   * getting events even once the finger/cursor moves off its own tiny
   * hit target), onDragMove reports the live pointer position up to
   * EditRouteScreen so it can tell which row is currently underneath
   * it, onDragEnd releases capture and commits whatever row that was.
   */
  onDragStart: (e: ReactPointerEvent) => void;
  onDragMove: (e: ReactPointerEvent) => void;
  onDragEnd: (e: ReactPointerEvent) => void;
}) {
  const isStop = stopNumber !== null;
  const issue = rowValidationIssue(row);
  const actionLower = row.action.toLowerCase();
  const isPlaceAction =
    actionLower === "stop" ||
    actionLower === "depart" ||
    actionLower === "arrive";
  // Only "Left"/"Right" actually have a direction (and the mirrored
  // TurnArrow to go with it) - every other action (Continue, U-Turn,
  // Turn Around, Proceed, Pull Over, Return, Depart, Arrive) gets its
  // own icon instead (ActionIcon, icons.tsx) rather than reading as
  // plain, icon-less text the way it used to, same as the real driving
  // screen now does too (StepContent's own doc comment).
  const turnDirection =
    actionLower === "left" ? "left" : actionLower === "right" ? "right" : null;
  // A place action's own from/location pair reads as an intersection
  // ("Main St & Oak Ave"); a turn's reads as the maneuver itself ("Main
  // St onto Oak Ave") - same shape, different connector word, both set
  // apart from the road names themselves (smaller, gray, italic) so
  // neither reads as though it were part of a name. `effectiveFrom`
  // falls back to the tracked `previousRoad` when this row has no
  // explicit `fromLocation` of its own, so the subheading previews the
  // real intersection this row will actually resolve to - except for a
  // plain address (a house number out front) or a location matching a
  // known school by name, neither of which has a "from" road to pair
  // with at all (same isPlainLocation reasoning as StepRowEditor's
  // own), so this never shows a stray "& <inherited road>" next to
  // what the expanded editor already treats as its own address.
  const isPlainLocation =
    /^\d/.test(row.location.trim()) ||
    Object.keys(schools).some(
      (name) => name.trim().toLowerCase() === row.location.trim().toLowerCase(),
    );
  const effectiveFrom = isPlainLocation
    ? null
    : row.fromLocation || previousRoad;
  const connector = isPlaceAction ? "&" : "onto";
  const subheading = effectiveFrom ? (
    <>
      {effectiveFrom}{" "}
      <span className="text-sm font-normal text-zinc-400 italic">
        {connector}
      </span>{" "}
      {row.location}
    </>
  ) : (
    row.location || null
  );

  return (
    <div
      className={`flex items-center gap-2 rounded-lg py-0.5 text-left ${
        issue ? "-mx-2 border border-red-400 bg-red-50 px-2" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-heading flex items-center gap-1.5 text-base font-black">
            {isStop ? (
              <>
                <MapPinIcon className="h-4 w-4 shrink-0 text-red-500" />
                Stop {stopNumber}
                {row.side && (
                  <span className="flex items-center gap-0.5 text-sm font-semibold text-zinc-400">
                    ({row.side.toLowerCase()}
                    <RoundedTriangleIcon
                      direction={
                        row.side.toLowerCase() === "left" ? "left" : "right"
                      }
                      className="h-3 w-3"
                    />
                    )
                  </span>
                )}
              </>
            ) : actionLower === "depart" || actionLower === "arrive" ? (
              <>
                <ActionIcon
                  action={row.action}
                  className="h-4 w-4 shrink-0 text-blue-600"
                />
                {row.action}
              </>
            ) : turnDirection ? (
              <>
                <TurnArrow
                  direction={turnDirection}
                  className="h-4 w-4 shrink-0"
                />
                Turn {turnDirection === "left" ? "Left" : "Right"}
              </>
            ) : (
              <>
                <ActionIcon action={row.action} className="h-4 w-4 shrink-0" />
                {row.action || "Turn"}
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
          {subheading || (
            <span className="text-zinc-400 italic">No location yet</span>
          )}
        </p>
        {/* A structurally bad row (see rowValidationIssue) takes
            priority over the geocoding status below - there's nothing
            meaningful to resolve yet when the action/location
            themselves are missing or unrecognized, so showing both
            would just be two ways of saying "this row is off." */}
        {issue ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-red-600">
            <WarningIcon className="h-3.5 w-3.5 shrink-0" />
            {issue}
          </p>
        ) : (
          /* The row's own real geocoding outcome - actual coordinates
             once resolved (green check), the specific miss/error reason
             otherwise (red X), or "- Instructions Only -" for a row
             deriveWaypoints.ts flagged as never needing a location at
             all (a driver instruction, not a real road). */
          status && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
              <ResolutionIcon
                status={status.status}
                className="h-3.5 w-3.5 shrink-0"
              />
              {status.status === "resolved"
                ? `${status.lat.toFixed(5)}, ${status.lon.toFixed(5)}`
                : status.status === "skipped"
                  ? "- Instructions Only -"
                  : status.reason}
            </p>
          )
        )}
        {/* Driver hints (wheelchair assistance, wait-inside notes, etc.)
            read last - after the row's own location is established, not
            competing with it for the reader's attention right under the
            cross streets. */}
        {row.notes && (
          <p className="mt-0.5 text-sm text-zinc-500">{row.notes}</p>
        )}
      </div>
      {/* -mr-2 pulls this pair in closer to the row's own right edge
          (half its old gap to the list's own px-4) than a plain
          shrink-0 flex would leave it - the pencil/handle read as
          hugging the edge, not floating a full padding-width in from
          it. items-center on the row itself (above) centers this
          group against the row's full height, whatever that ends up
          being once notes/coordinates add extra lines below the
          header. */}
      <div className="flex shrink-0 items-center gap-2 -mr-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={locked}
          aria-label={isStop ? `Edit stop ${stopNumber}` : "Edit turn"}
          className="text-blue-600 active:text-blue-800 disabled:opacity-30"
        >
          <EditIcon className="h-4 w-4" />
        </button>
        <span
          onPointerDown={locked ? undefined : onDragStart}
          onPointerMove={locked ? undefined : onDragMove}
          onPointerUp={locked ? undefined : onDragEnd}
          onPointerCancel={locked ? undefined : onDragEnd}
          aria-label={isStop ? `Reorder stop ${stopNumber}` : "Reorder turn"}
          role="button"
          style={{ touchAction: "none" }}
          className={`p-1 text-zinc-400 ${locked ? "opacity-30" : "cursor-grab active:cursor-grabbing"}`}
        >
          <DragHandleIcon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

/**
 * The expanded form for one row, in place of its collapsed
 * StepRowView - every field labeled and editable, plus a red-outlined
 * error line under the location box when it's unresolved, and Delete/
 * Cancel/Save controls instead of committing every keystroke live.
 * `row` here is a local draft (see EditRouteScreen's `draftRow`), not
 * the committed `rows` entry - Cancel discards it, Save is the only
 * thing that writes it back. The "type" select is what
 * deriveWaypoints.ts actually reads as `action` - changing it between
 * Stop/Turn Left/Turn Right changes how this row's own location gets
 * resolved, not just how it displays.
 *
 * Two real fields, not one: `location` (always required - this row's
 * own real position) and `fromLocation` (optional - the road it's
 * approached from, used to pair with `location` as an intersection).
 * `fromLocation` shows the tracked `previousRoad` as its own
 * placeholder whenever it's blank, so a road name a driver would
 * otherwise retype for every row is still implied rather than asked
 * for again - but unlike the single-box version this replaced, it's a
 * real, always-editable input, not a read-only label. That distinction
 * matters for real data: a district's own sheet can (and did - see
 * 120-AM-HS.csv's "David Way" for what should be "Davids Way") type an
 * explicit fromLocation with its own typo, which the old read-only
 * label had no way to ever fix.
 */
function StepRowEditor({
  row,
  stopNumber,
  previousRoad,
  schools,
  routeSchoolName,
  status,
  fetching,
  fetchLocked,
  placementGuess,
  routeContext,
  onChange,
  onFetch,
  onManualCoordinates,
  onCancel,
  onDelete,
  onUpdate,
}: {
  row: RawRouteRow;
  stopNumber: number | null;
  /** The road deriveWaypoints.ts already has tracked as "current"
   * heading into this row, from every row before it - null only for
   * the very first row, or when nothing earlier has named a real road
   * yet. */
  previousRoad: string | null;
  /** Every known school, by name - the same lookup the Route Details
   * form's own School <select> uses. Lets a Depart/Arrive row (or any
   * row whose typed location happens to match) show that school's real
   * address underneath, and offers a quick-pick shortcut for Depart/
   * Arrive rows instead of having to type a school's exact name. */
  schools: Record<string, SchoolInfo>;
  /** This route's own school (Route Details form) - defaults a fresh
   * Depart/Arrive row's location the moment its Type is picked, since
   * arriving at or departing from *some other* school is the rare case
   * (a field trip, say), not the default one. */
  routeSchoolName: string;
  status: RowResolutionStatus | undefined;
  /** This row's own request is actually in flight right now - drives
   * the globe button's spinner specifically. */
  fetching: boolean;
  /** True for `fetching` above *or* for the shared cooldown afterward
   * (see EditRouteScreen's own singleFetchCoolingDown) - drives the
   * globe button's disabled state, separately from its icon, so it
   * still shows a plain globe (not a spinner) while merely cooling
   * down. */
  fetchLocked: boolean;
  /** Where the "place manually" map should open centered - the nearest
   * already-resolved neighbor waypoint(s) either side of this row (see
   * the StepRowEditor call site below), averaged when both exist, null
   * when neither side has resolved yet (PlaceCoordinatesModal falls
   * back to a fixed default in that case). */
  placementGuess: { lat: number; lon: number } | null;
  /** Every already-resolved stop on this route, in order, school
   * included at whichever end it belongs (EditRouteScreen's own
   * routeContextPoints) - handed straight through to
   * PlaceCoordinatesModal so an admin placing a pin manually can see
   * the route's actual road-following line for spatial context, the
   * same line RouteMap.tsx draws while driving. Under two points (not
   * enough to draw a line between) still comes through as whatever
   * short array it is - PlaceCoordinatesModal itself is the one that
   * decides that's too few to bother drawing. */
  routeContext: { lat: number; lon: number }[];
  onChange: (patch: Partial<RawRouteRow>) => void;
  onFetch: () => void;
  /** A coordinate typed/pasted directly into the Latitude/Longitude
   * box, parsed and handed up on Save (see handleSave below) - writes
   * straight into the shared waypoint cache, the same place a real
   * Fetch would have, bypassing the geocoder entirely. */
  onManualCoordinates: (lat: number, lon: number) => void;
  onCancel: () => void;
  onDelete: () => void;
  onUpdate: () => void;
}) {
  // Live off the draft's own Type select, not the `stopNumber` prop
  // (only recomputed by the parent from the *committed* rows, see
  // EditRouteScreen's own StepRowEditor call site) - so switching Type
  // between Stop and Turn Left/Right here updates the Side/Riders
  // fields and the subtitle below immediately, not just after Update
  // commits the draft back.
  const actionLower = row.action.toLowerCase();
  const isStop = actionLower === "stop";
  const isSchoolAction = actionLower === "depart" || actionLower === "arrive";
  // Only "Left"/"Right" actually have a direction (and the mirrored
  // TurnArrow to go with it) - every other action (Continue, U-Turn,
  // Turn Around, Proceed, Pull Over, Return, Depart, Arrive) gets its
  // own icon instead (ActionIcon) in the subtitle below, same as
  // StepRowView's own identical derivation for the collapsed row.
  const turnDirection =
    actionLower === "left" ? "left" : actionLower === "right" ? "right" : null;

  // A school this row's own `location` text matches by name (exact,
  // case/space-insensitive) - true for a Depart/Arrive row defaulted or
  // quick-picked below, but checked for every action, not just those
  // two, so a plain Stop whose typed text happens to already name a
  // known school (an admin typing a route by hand, not importing one)
  // gets the same address-underneath confirmation for free. A matched
  // school reads as its own specific point, not part of an
  // intersection - same as a house-numbered address - so it also
  // suppresses the "From" field below the same way isPlainLocation
  // already does for one.
  const matchedSchool = useMemo(() => {
    const target = row.location.trim().toLowerCase();
    if (!target) return null;
    const entry = Object.entries(schools).find(
      ([name]) => name.trim().toLowerCase() === target,
    );
    return entry ? { name: entry[0], info: entry[1] } : null;
  }, [row.location, schools]);

  // A plain address (a house number out front) or a matched school
  // (see above) each name one specific point on their own - neither has
  // a "from road" concept the way an intersection does, so the From
  // field below stays hidden for either rather than asking for context
  // that wouldn't mean anything.
  const isPlainLocation =
    /^\d/.test(row.location.trim()) || matchedSchool !== null;

  function handleTypeChange(nextAction: string) {
    const nextIsSchoolAction =
      nextAction.toLowerCase() === "depart" ||
      nextAction.toLowerCase() === "arrive";
    // Defaults a fresh Depart/Arrive row straight to this route's own
    // school - overridable by picking a different one from the quick-
    // pick below or just typing over it - rather than opening on a
    // blank field for what's almost always the same one school every
    // time.
    if (nextIsSchoolAction && !row.location && routeSchoolName) {
      onChange({ action: nextAction, location: routeSchoolName });
    } else {
      onChange({ action: nextAction });
    }
  }

  // Latitude/Longitude - local text, seeded from whatever's already
  // resolved for this row (blank otherwise). parseLatLon (above) reads
  // it live on every keystroke - not just on Save - so a manually typed
  // coordinate shows its own green check immediately instead of only
  // after Save closes and reopens this editor. Accepts a plain decimal
  // pair (space/comma/tab-separated) or one with its own degree symbol
  // and hemisphere letter per value ("36.05274° N, 86.54681° W").
  const resolvedLat = status?.status === "resolved" ? status.lat : null;
  const resolvedLon = status?.status === "resolved" ? status.lon : null;
  const [coordsText, setCoordsText] = useState(() =>
    resolvedLat != null && resolvedLon != null
      ? `${resolvedLat}, ${resolvedLon}`
      : "",
  );
  const hasCoordsText = coordsText.trim() !== "";
  const manualCoords = useMemo(() => parseLatLon(coordsText), [coordsText]);

  // The "place manually" map popup - opened by its own button beside
  // Fetch, below. Its own on/off state rather than reusing `expandedIndex`
  // or similar: it's a popup on top of this one, not a replacement for it.
  const [showPlaceModal, setShowPlaceModal] = useState(false);

  // Re-syncs the box the moment a Fetch actually lands - `status` is
  // derived from the shared cache (EditRouteScreen's own `cache` state),
  // which fetchLocation already updates as soon as the response comes
  // back, but coordsText above only ever seeded itself once, on mount.
  // Without this, a successful fetch was invisible in this box until
  // Save closed and reopened the editor (Save reads straight from the
  // cache, not from coordsText, so the coordinates were never actually
  // lost - just not shown here yet). Adjusting state directly during
  // render (React's own documented pattern for this, guarded so it only
  // runs when the resolved value actually changed) rather than in a
  // `useEffect` - an effect here would still land the update, just one
  // extra render late, and set-state-in-effect is a real lint error in
  // this project. Tracking the coordinates themselves, not `status` as
  // a whole, means this only fires when a fetch (or another row's own
  // resolution) actually changes the real value - never on every
  // render, and never clobbering a coordinate the admin is still
  // mid-typing by hand.
  const [lastSyncedCoords, setLastSyncedCoords] = useState<
    [number, number] | null
  >(
    resolvedLat != null && resolvedLon != null
      ? [resolvedLat, resolvedLon]
      : null,
  );
  if (
    resolvedLat != null &&
    resolvedLon != null &&
    (lastSyncedCoords?.[0] !== resolvedLat ||
      lastSyncedCoords?.[1] !== resolvedLon)
  ) {
    setLastSyncedCoords([resolvedLat, resolvedLon]);
    setCoordsText(`${resolvedLat}, ${resolvedLon}`);
  }

  function handleSave() {
    if (hasCoordsText) {
      if (!manualCoords) return; // the box below already shows why, live
      onManualCoordinates(manualCoords[0], manualCoords[1]);
    }
    onUpdate();
  }

  // Same icon the collapsed StepRowView row above shows for this same
  // stop/turn (live off `isStop`/`turnDirection` - the draft's own Type
  // select, not a snapshot from when this editor opened), paired with
  // the exact instruction this row now produces ("Stop 1 at Lake Forest
  // Dr & Davids Way," "Left onto Main Street") instead of just its own
  // type/number - both update immediately as Type/destination change,
  // not only after Update commits. Reused as PlaceCoordinatesModal's
  // own title below, so that popup identifies the same waypoint the
  // same way rather than restating it in different words.
  const instructionLine = (
    <>
      {isStop ? (
        <MapPinIcon className="h-4 w-4 shrink-0 text-red-500" />
      ) : isSchoolAction ? (
        <ActionIcon
          action={row.action}
          className="h-4 w-4 shrink-0 text-blue-600"
        />
      ) : turnDirection ? (
        <TurnArrow direction={turnDirection} className="h-4 w-4 shrink-0" />
      ) : (
        <ActionIcon action={row.action} className="h-4 w-4 shrink-0" />
      )}
      {formatWaypointInstruction(
        row,
        stopNumber,
        isPlainLocation ? "" : row.fromLocation || previousRoad || "",
      )}
    </>
  );

  // The place-coordinates view's own header line, in place of
  // instructionLine above while it's showing - the full crossroads for
  // this row (both roads of the intersection, not just the destination
  // one a turn's own instructionLine names), since pinning down a
  // hard-to-place point needs the whole intersection, not half of it.
  const currentCrossroads = crossroadsLine(
    row,
    stopNumber,
    previousRoad,
    schools,
  );

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onCancel}
    >
      <div
        className="animate-popup-pop flex max-h-[85vh] w-full max-w-sm flex-col overflow-y-auto rounded-xl bg-[var(--background)] p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            {/* Same card, same size, whichever of the two views below
                is showing - "Place Coordinates" swaps in for "Edit
                Waypoint" entirely rather than opening as a second
                popup layered on top of this one. */}
            {showPlaceModal ? (
              <>
                <h2 className="font-heading text-xl font-black tracking-tight">
                  Place Coordinates
                </h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-zinc-500">
                  {currentCrossroads.icon}
                  {currentCrossroads.text}
                </p>
              </>
            ) : (
              <>
                <h2 className="font-heading text-xl font-black tracking-tight">
                  Edit Waypoint
                </h2>
                {/* Same icon the collapsed StepRowView row above shows for
                  this same stop/turn (live off `isStop`/`turnDirection` -
                  the draft's own Type select, not a snapshot from when
                  this editor opened), paired with the exact instruction
                  this row now produces ("Stop 1 at Lake Forest Dr &
                  Davids Way," "Left onto Main Street") instead of just
                  its own type/number - both update immediately as Type/
                  destination change, not only after Update commits. */}
                <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-zinc-500">
                  {instructionLine}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={showPlaceModal ? () => setShowPlaceModal(false) : onCancel}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {showPlaceModal ? (
          <PlaceCoordinatesModal
            // This row's own current coordinate (typed, or already
            // resolved) wins over the neighbor guess whenever it has
            // one - opening this map to fine-tune an existing point
            // should start on that point, not somewhere else nearby.
            // The neighbor guess (placementGuess) only ever matters for
            // a row with no coordinate of its own yet.
            initialCenter={
              (manualCoords && {
                lat: manualCoords[0],
                lon: manualCoords[1],
              }) ??
              (resolvedLat != null && resolvedLon != null
                ? { lat: resolvedLat, lon: resolvedLon }
                : null) ??
              placementGuess ?? {
                lat: LA_VERGNE_CENTER[0],
                lon: LA_VERGNE_CENTER[1],
              }
            }
            routeContext={routeContext}
            onCancel={() => setShowPlaceModal(false)}
            onSetCoordinates={(lat, lon) => {
              onManualCoordinates(lat, lon);
              setShowPlaceModal(false);
            }}
          />
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Type">
                <select
                  className={inputClass}
                  // Falls back to "" (the "- Unspecified -" option
                  // below) rather than passing an unrecognized
                  // row.action straight through as this select's own
                  // value - an imported row with a blank or misspelled
                  // action cell would otherwise leave no option
                  // actually selected, which a browser renders as if
                  // "Stop" (the first real option) were picked instead.
                  // The original value stays in `row` either way until
                  // an admin actually changes this select - only
                  // changing what's *shown*, not what's saved.
                  value={WAYPOINT_TYPE_SET.has(row.action) ? row.action : ""}
                  onChange={(e) => handleTypeChange(e.target.value)}
                >
                  <option value="">- Unspecified -</option>
                  <option value="Stop">Stop</option>
                  <option value="Left">Turn Left</option>
                  <option value="Right">Turn Right</option>
                  <option value="Continue">Continue</option>
                  <option value="U-Turn">U-Turn</option>
                  <option value="Turn Around">Turn Around</option>
                  <option value="Proceed">Proceed</option>
                  <option value="Pull Over">Pull Over</option>
                  <option value="Return">Return</option>
                  <option value="Depart">Depart</option>
                  <option value="Arrive">Arrive</option>
                </select>
              </Field>
              {isStop ? (
                <Field label="Side">
                  <select
                    className={inputClass}
                    value={row.side}
                    onChange={(e) => onChange({ side: e.target.value })}
                  >
                    <option value="">Side (none)</option>
                    <option value="Left">Left</option>
                    <option value="Right">Right</option>
                  </select>
                </Field>
              ) : (
                <span />
              )}
            </div>

            {/* Depart/Arrive's own quick-pick - fills Location with a
          chosen school's exact name (below) rather than requiring one
          typed out by hand. Left out for every other action - a turn
          or a plain stop names a road or address, never a school. */}
            {isSchoolAction && Object.keys(schools).length > 0 && (
              <div className="mt-2">
                <Field label="School">
                  <select
                    className={inputClass}
                    value={matchedSchool?.name ?? ""}
                    onChange={(e) => {
                      if (e.target.value)
                        onChange({ location: e.target.value });
                    }}
                  >
                    <option value="">
                      {matchedSchool
                        ? "— Other (type below) —"
                        : "— Not a listed school (type below) —"}
                    </option>
                    {Object.keys(schools)
                      .sort((a, b) => a.localeCompare(b))
                      .map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
            )}

            <div className="mt-2 flex flex-col gap-2">
              {/* Comes before Location, not after - reads in real driving
            order ("from Main St, onto Elm St"), and doubles as this
            row's only escape hatch for fixing a bad inference or an
            explicit typo (e.g. 120-AM-HS.csv's real "David Way," which
            should be "Davids Way") - the old single-box editor never
            exposed this at all, only a read-only label. Hidden for a
            plain address or a matched school (see isPlainLocation
            above) - neither is part of an intersection, so there's no
            "from" road to name. */}
              {!isPlainLocation && (
                <Field label="From (optional)">
                  <input
                    className={inputClass}
                    value={row.fromLocation}
                    onChange={(e) => onChange({ fromLocation: e.target.value })}
                    placeholder={previousRoad || "start of route"}
                  />
                </Field>
              )}
              <Field label="Location">
                <input
                  className={`${inputClass} ${
                    status?.status === "unresolved"
                      ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                      : ""
                  }`}
                  value={row.location}
                  onChange={(e) => onChange({ location: e.target.value })}
                  placeholder={
                    isSchoolAction
                      ? "LaVergne High School"
                      : /^\d/.test(row.location)
                        ? "123 Maple Dr"
                        : "Elm St"
                  }
                />
              </Field>
              {/* A location that matches a known school by name - typed by
            hand, quick-picked above, or defaulted from this route's
            own school - reads as linked to that real school entity,
            not just a text string a geocoder has to guess at: its
            actual street address shows right underneath as
            confirmation. */}
              {matchedSchool && (
                <p className="-mt-1 flex items-center gap-1 text-xs text-zinc-500">
                  <MapPinIcon className="h-3 w-3 shrink-0 text-blue-500" />
                  {matchedSchool.info.address}
                </p>
              )}
            </div>

            <div className="mt-2">
              <Field
                label={
                  <span className={row.skip ? "text-zinc-300" : undefined}>
                    Latitude, longitude
                  </span>
                }
              >
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputClass} flex-1 font-mono disabled:opacity-50 ${
                      (hasCoordsText && !manualCoords) ||
                      (!hasCoordsText && status?.status === "unresolved")
                        ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                        : manualCoords || status?.status === "resolved"
                          ? "border-green-400 focus:border-green-500 focus:ring-green-500"
                          : ""
                    }`}
                    value={coordsText}
                    onChange={(e) => setCoordsText(e.target.value)}
                    disabled={row.skip}
                  />
                  <button
                    type="button"
                    onClick={onFetch}
                    disabled={fetchLocked || row.skip}
                    aria-label="Fetch coordinates for this location"
                    className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900 disabled:opacity-50"
                  >
                    {fetching ? (
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <GlobeIcon className="h-4 w-4" />
                    )}
                  </button>
                  {/* The manual alternative to Fetch above - for a spot no
                geocoder will ever find (a bare curb, a driveway with no
                address of its own), not one it merely got wrong. Opens
                a map the admin drags into position themselves rather
                than typing coordinates by hand. */}
                  <button
                    type="button"
                    onClick={() => setShowPlaceModal(true)}
                    disabled={row.skip}
                    aria-label="Manually place coordinates on a map"
                    className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900 disabled:opacity-50"
                  >
                    <MapPinIcon className="h-4 w-4" />
                  </button>
                </div>
              </Field>
              {/* Every status message this row can have, right under the box
            it's actually about - a locally malformed manual entry
            takes priority over the row's own geocoded status (it's
            about to replace it the moment Save runs), and a locally
            *valid* one shows its own green check immediately rather
            than waiting on Save to reflect it. The real routing/
            geocoding failure (moved down here from the destination
            field above, where it used to sit disconnected from the
            coordinates it's actually about) is never truncated - a
            "No shared node found in the search box"-length explanation
            needs to be read whole, not guessed at from its first few
            words. */}
              {hasCoordsText && !manualCoords ? (
                <p className="mt-1 flex items-start gap-1 text-xs text-red-600">
                  <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Enter latitude and longitude, separated by a space, comma,
                    or tab.
                  </span>
                </p>
              ) : manualCoords ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-green-600">
                  <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
                  Verified coordinates
                </p>
              ) : status?.status === "unresolved" ? (
                <p className="mt-1 flex items-start gap-1 text-xs text-red-600">
                  <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{status.reason}</span>
                </p>
              ) : status?.status === "resolved" ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-green-600">
                  <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
                  Verified coordinates
                </p>
              ) : null}
              <label className="mt-1.5 flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={row.skip}
                  onChange={(e) => onChange({ skip: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                Instructions only - no location coordinates
              </label>
            </div>

            {/* Notes ahead of Riders - a driver reads this box top to bottom,
          and the note (a special instruction) matters regardless of
          whether this row even has riders, so it shouldn't sit below a
          field that sometimes isn't even shown at all. */}
            <div className="mt-2">
              <Field label="Driver Notes">
                <input
                  className={inputClass}
                  value={row.notes}
                  onChange={(e) => onChange({ notes: e.target.value })}
                />
              </Field>
            </div>

            {/* Riders only really means anything for a stop (a turn has no
          one boarding/leaving at it) - live off `isStop` above, so
          switching Type away from Stop fades it immediately rather
          than leaving it looking just as active as every other field.
          Faded rather than hidden outright (unlike Side, above,
          which still disappears) - a non-stop row can still carry a
          leftover count from before its Type changed, and hiding the
          field entirely would hide that stale value too, instead of
          showing it grayed out as the "this isn't being read for this
          row" it now is. Its own full-width line, not sharing a row
          with Driver Notes - the two aren't related enough to read as
          a pair, and Driver Notes needs the room on longer entries. */}
            <div className={`mt-2 ${isStop ? "" : "opacity-40"}`}>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    <PersonSolidIcon className="h-3.5 w-3.5" /># of Riders
                  </span>
                }
              >
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={row.riderCount}
                  onChange={(e) =>
                    onChange({ riderCount: e.target.value.replace(/\D/g, "") })
                  }
                  disabled={!isStop}
                />
              </Field>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete step"
                className="btn-glossy-red flex shrink-0 items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                Delete
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onCancel}
                className="btn-glossy-light shrink-0 rounded-lg bg-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="btn-glossy-blue shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Save
              </button>
            </div>
          </>
        )}
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
function AddStepButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <div className="relative flex items-center justify-center py-1">
      <div className="absolute inset-x-0 border-t border-dashed border-zinc-200" />
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Add step here"
        className="btn-glossy-light relative z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900 disabled:opacity-30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The paste box's own quick reference - what column headers this
 * screen's import (parseRouteImport.ts) recognizes and a few example
 * rows, so a pasted/uploaded sheet's shape doesn't have to be guessed
 * at. Leads with `location` alone (one road per row, action or
 * direction first) - the road it crosses is figured out from whichever
 * road the route was already on, the same "current road" tracking
 * deriveWaypoints.ts always did - and calls out the optional
 * `from_location` column for spelling out both sides of an
 * intersection by hand instead. Same modal shell as StartScreen's
 * AllStopsModal (full-screen dim, centered card, backdrop tap or the
 * corner X to close). */
function StopsFormatModal({ onClose }: { onClose: () => void }) {
  const exampleRows: string[][] = [
    ["Stop", "123 Maple Dr", "1", "Left", "Ring doorbell"],
    ["Left", "Oak Ave", "", "", ""],
    ["Stop", "Elm St", "3", "Right", ""],
  ];

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="animate-popup-pop flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-[var(--background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="font-heading text-xl font-black tracking-tight">
            Stops Format
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 text-left">
          <p className="text-sm text-zinc-600">
            Only <code className="font-mono text-xs">action</code> and{" "}
            <code className="font-mono text-xs">location</code> are required -
            every other column can be left blank. Each row names the one road
            that action or direction happens on; anything else (the road it
            crosses, say) is figured out from whichever road the route was
            already on.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full min-w-[28rem] border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-100 text-zinc-500 uppercase">
                  {["action", "location", "rider_count", "side", "notes"].map(
                    (header) => (
                      <th
                        key={header}
                        className="border-b border-zinc-200 px-2 py-1.5 text-left font-semibold"
                      >
                        {header}
                      </th>
                    ),
                  )}
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
            Prefer to spell out both sides of every intersection yourself? Add a{" "}
            <code className="font-mono text-xs">from_location</code> column
            alongside <code className="font-mono text-xs">location</code> (e.g.{" "}
            <code className="font-mono text-xs">Stop, Main St, Oak Ave, 3</code>
            ) - only needed where the road can&apos;t already be figured out
            from context.
          </p>
          <p className="mt-3 text-sm text-zinc-600">
            No header row works too - one stop or turn per line, same as the
            paste box&apos;s own placeholder shows.
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
        className="animate-popup-pop w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-black tracking-tight">
            Error Details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-100"
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

// Solid HSL red-to-green interpolation (0% = red, 100% = green) - the
// same "how close to done" reading a green/red fuel gauge already
// gives, just driven by progress instead of a remaining quota. Shared
// by GeocodeRatioBar and FetchCoordinatesModal's own batch-progress
// fill below, so a route's overall geocode ratio and one in-flight
// batch's progress both use the same color language.
function progressColor(fraction: number): string {
  const hue = Math.max(0, Math.min(1, fraction)) * 120;
  return `hsl(${hue}, 70%, 45%)`;
}

/** A thin at-a-glance ratio of resolved vs. not - a solid red track
 * with a green fill scaled to `percent`, so it reads correctly (a
 * sliver of green, mostly red) well before anyone reads the count
 * next to it. Styled like the app's own glossy buttons (the same
 * white sheen highlight) but with an inset shadow instead of a raised
 * one, so it reads as a groove the fill sits inside rather than
 * another button. */
function GeocodeRatioBar({
  percent,
  className = "h-1",
}: {
  percent: number;
  className?: string;
}) {
  return (
    <div
      className={`meter-track w-full overflow-hidden rounded-full bg-red-400 ${className}`}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{
          width: `${percent}%`,
          backgroundColor: progressColor(percent / 100),
        }}
      />
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
  fetchRunning,
  batchProgress,
  fetchError,
  onFetchMissing,
  onRefetchAll,
  onClose,
}: {
  counts: RouteResolutionCounts;
  fetchRunning: boolean;
  batchProgress: BatchProgress | null;
  fetchError: FetchErrorInfo | null;
  onFetchMissing: () => void;
  onRefetchAll: () => void;
  onClose: () => void;
}) {
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="animate-popup-pop w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-black tracking-tight">
            Fetch Coordinates
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-red-200 bg-red-50 py-3 text-center">
            <p className="font-heading text-2xl font-black text-red-600">
              {counts.unresolved}
            </p>
            <p className="text-xs font-semibold tracking-wide text-red-600 uppercase">
              Missing
            </p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 py-3 text-center">
            <p className="font-heading text-2xl font-black text-green-700">
              {counts.resolved}
            </p>
            <p className="text-xs font-semibold tracking-wide text-green-700 uppercase">
              Valid
            </p>
          </div>
        </div>
        {counts.skipped > 0 && (
          <p className="mt-2 text-center text-xs text-zinc-400">
            {counts.skipped} skipped ({counts.total} total)
          </p>
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
                Fetching{" "}
                {Math.min(
                  batchProgress.completed + 1,
                  batchProgress.total,
                )} of {batchProgress.total}…
              </p>
              <p className="max-w-full truncate text-xs text-zinc-400">
                {batchProgress.currentLabel}
              </p>
              <GeocodeRatioBar
                percent={(batchProgress.completed / batchProgress.total) * 100}
                className="h-1.5"
              />
            </>
          ) : (
            fetchError &&
            (fetchError.rateLimited ? (
              <p className="text-sm text-amber-600">{fetchError.message}</p>
            ) : (
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
            ))
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
            className="btn-glossy-light font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-300 py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-50"
          >
            Re-fetch All
          </button>
          <button
            type="button"
            onClick={onFetchMissing}
            disabled={fetchRunning || counts.unresolved === 0}
            className="btn-glossy-blue font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Fetch Missing
          </button>
        </div>
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
 * Save/Create Route/Publish all go through handleSave below, which
 * POSTs to /api/routes (the route's own row and its full RouteStep
 * list, replacing whatever was there) before ever calling `onSave` -
 * page.tsx's in-memory admin-route store is still updated too (for
 * this session's own immediate UI, same as ever), but the real
 * database row is what a page reload now actually reflects. A freshly
 * fetched coordinate here is persisted the moment it resolves
 * (persistWaypoint below, POSTing to /api/waypoints), independent of
 * whether the rest of the edit ever gets saved at all.
 */
export function EditRouteScreen({
  mode,
  route,
  routes,
  initialSteps,
  initialWaypointCache,
  schools,
  onCancel,
  onSave,
}: {
  mode: "add" | "edit";
  /** The route being edited, or null when adding a brand-new one. */
  route: Route | null;
  /** Every other route (real and demo) - only real, non-demo ones
   * (anything but `status: "demo"`) are ever eligible "Next Action"
   * targets below, but this is the same full list RouteListScreen
   * itself gets, not pre-filtered, so this screen doesn't need its own
   * separate real-routes-only prop just for this one field. */
  routes: Route[];
  /** The route's own current steps, straight from Postgres (or a prior
   * edit this session) - seeds `mode: "edit"`'s structured row list
   * once on mount (see the `rows` useState below). Always `[]` for
   * `mode: "add"`, which starts from its own empty paste/upload box
   * instead (see `stepsText`). */
  initialSteps: RawRouteRow[];
  /** A previous edit session's own fetched cache for this exact route,
   * if page.tsx has one - takes priority over fetching the real
   * committed sidecar file, so coordinates fetched and saved earlier
   * this session aren't lost the next time this route is reopened
   * (see page.tsx's adminWaypointCaches). Undefined for `mode: "add"`
   * and for a route that's never had one fetched. */
  initialWaypointCache?: WaypointCache;
  /** School name -> address/level, from Postgres - the school picker
   * below (`schoolOptions`) is built from this table's own keys rather
   * than free text, so a route's address and level are always looked
   * up here instead of typed or picked separately by an admin. */
  schools: Record<string, SchoolInfo>;
  onCancel: () => void;
  /** `steps` here is always the *current* row list - `mode: "add"`'s
   * pasted/uploaded rows as parsed, or `mode: "edit"`'s edited row list
   * as-is - so page.tsx's own storage stays the same structured shape
   * this screen already edits, with no CSV text round-trip in between.
   * `cache` is this session's complete waypoint cache for the route
   * (whatever was loaded plus anything freshly fetched) - kept
   * alongside the route itself so a later re-open of this same route
   * (or the list's own "Publish" readiness check) sees it too, instead
   * of every fetched coordinate vanishing the moment this screen
   * closes. */
  onSave: (route: Route, steps: RawRouteRow[], cache: WaypointCache) => void;
}) {
  const [routeNumber, setRouteNumber] = useState(route?.routeNumber ?? "");
  const [busNumber, setBusNumber] = useState(route?.busNumber ?? "");
  // School address and level are never typed or picked separately -
  // both are looked up from `schools` (Postgres, via /api/schools) by
  // whichever name is selected here, below. Real address/level data
  // belongs in that one table, not duplicated into every route that
  // references it.
  const [schoolName, setSchoolName] = useState(route?.schoolName ?? "");
  const schoolInfo: SchoolInfo | undefined = schools[schoolName];
  // A route already being edited whose school isn't in `schools` yet
  // (see schoolOptions below) keeps its own already-known address/
  // level instead of falling back to the generic placeholder/default -
  // picking a *different* school from the dropdown always overrides
  // this with that school's own real table entry.
  const isOriginalUnmatchedSchool =
    route != null && route.schoolName === schoolName && !schoolInfo;
  const schoolAddress =
    schoolInfo?.address ??
    (isOriginalUnmatchedSchool
      ? route.schoolAddress
      : SCHOOL_ADDRESS_NOT_YET_PROVIDED);
  const schoolLevel: SchoolLevel =
    schoolInfo?.schoolLevel ??
    (isOriginalUnmatchedSchool ? route.schoolLevel : "elementary");
  const schoolLat =
    schoolInfo?.lat ?? (isOriginalUnmatchedSchool ? route.schoolLat : null);
  const schoolLon =
    schoolInfo?.lon ?? (isOriginalUnmatchedSchool ? route.schoolLon : null);
  // Whether `schoolAddress` above is a real, geocodable address rather
  // than the generic "not yet provided" placeholder it falls back to
  // when nothing's selected - unlike that state-backed field before
  // this pass, `schoolAddress` is never actually blank anymore, so
  // gating on this instead of `schoolAddress.trim()` is what still
  // keeps `waypoints` from treating an unselected school as ready.
  const hasRealSchoolAddress = Boolean(schoolInfo) || isOriginalUnmatchedSchool;
  // Every known school, plus - only if it wouldn't otherwise be a real
  // option - whatever school this route already had, so re-opening an
  // existing route never silently drops or blanks out a school the
  // schools table doesn't have a row for yet.
  const schoolOptions = useMemo(() => {
    const names = Object.keys(schools).sort((a, b) => a.localeCompare(b));
    if (schoolName && !schools[schoolName]) names.push(schoolName);
    return names;
  }, [schools, schoolName]);
  // Blank (never "pickup" by default) for a brand-new route - Trip is
  // one of the three fields this screen actually requires (see
  // requiredFieldErrors below), so it needs a genuine "not chosen yet"
  // state to require *into*, the same way School already has one via
  // its own blank "Select a school" option.
  const [tripType, setTripType] = useState<TripType | "">(
    route?.tripType ?? "",
  );
  // Every other real route this bus could plausibly hand off to once
  // this one's done - same bus (a chain is one bus driving more than
  // one leg back-to-back) and same trip type (an AM route handing off
  // into a PM one, or vice versa, would mean the bus sits idle for
  // hours mid-"trip"), excluding this route itself and every demo/
  // fabricated filler route (chaining only ever makes sense between
  // real, scheduled routes - see Route.nextRouteId's own doc comment
  // in types.ts).
  const nextRouteOptions = useMemo(
    () =>
      routes.filter(
        (r) =>
          r.status !== "demo" &&
          r.id !== route?.id &&
          r.busNumber === busNumber &&
          r.tripType === tripType,
      ),
    [routes, route?.id, busNumber, tripType],
  );
  // The dropdown's own default the first time this route's editor opens
  // (a brand-new route, or an existing one that's never had this field
  // set by hand) - whichever eligible route above runs the next school
  // level up from this one (elementary -> middle -> high), if exactly
  // the kind of route this bus would obviously hand off to next. High
  // school has nowhere further to go, so it never gets a default -
  // "smartly infer where possible, or none if it's high school." Only
  // ever computed once, from this route's *initial* school level - not
  // re-decided while editing, same "decided once from initial content"
  // convention every other inferred-from-context field in this screen
  // already follows (see StepRowEditor's own isPlainAddress).
  const [nextRouteId, setNextRouteId] = useState<string | null>(() => {
    // A real, already-linked route keeps exactly that - an admin's own
    // explicit choice always wins over guessing again. Null covers both
    // "never set" and "explicitly set to None" (the database can't tell
    // those apart once saved) - re-suggesting the inferred default in
    // that second case is an accepted tradeoff for actually being
    // useful in the far more common first one.
    if (route?.nextRouteId) return route.nextRouteId;
    const nextLevel: SchoolLevel | null =
      schoolLevel === "elementary"
        ? "middle"
        : schoolLevel === "middle"
          ? "high"
          : null;
    if (!nextLevel) return null;
    return (
      nextRouteOptions.find((r) => r.schoolLevel === nextLevel)?.id ?? null
    );
  });
  const [departureTime, setDepartureTime] = useState(
    route?.departureTime ?? "",
  );
  // Read-only here now - no form field sets this anymore (see
  // routeDetailsForm's own doc comment on why "Driver" is gone): a
  // driver is a person to assign to a route, not a property of the
  // route itself, so there's nothing for this screen to edit until
  // there's a real user entity to assign. Still carried straight
  // through on save (buildMetaFields below) so an existing route's own
  // driverName - however it got set - is never silently dropped.
  const driverName = route?.driverName ?? "";
  // mode "add" only - the paste/upload box, the one place this screen
  // still deals in CSV/TSV text at all (a human pasting or uploading a
  // route sheet - see parseRouteImport.ts). mode "edit" never reads
  // this; it's the structured `rows` state that's authoritative there.
  const [stepsText, setStepsText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepsTextareaRef = useRef<HTMLTextAreaElement>(null);
  // mode "edit" only - seeded once from initialSteps (the route's own
  // already-structured rows, straight from Postgres or a prior edit
  // this session), then edited structurally (add/remove/change a row)
  // from here on, never re-derived from initialSteps again.
  const [rows, setRows] = useState<RawRouteRow[]>(initialSteps);
  // Which row (a real index into `rows`, not the filtered
  // `visibleRowIndices` position) a drag-handle-initiated reorder
  // started from - null whenever nothing's being dragged. See
  // handleReorderRow below for what a drop actually does with it.
  // dragOverIndex tracks whichever row the pointer is currently over
  // mid-drag (updated from document.elementFromPoint on every
  // pointermove, since Pointer Capture keeps routing move/up events to
  // the handle itself regardless of where the finger/cursor actually
  // is) - that's what a release actually reorders to.
  const [dragRowIndex, setDragRowIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Defaults to on here (unlike StartScreen's own "View All Stops",
  // which defaults to stops-only) - reviewing a route for editing is
  // exactly when seeing every turn in its real place matters most.
  const [showTurns, setShowTurns] = useState(true);
  // Narrows the list to only what still needs a coordinate - "Jump to
  // next unverified" below is the other way to reach the same rows
  // without leaving the full list.
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);
  // The scrollable rows container - jumpToNextUnverified below scrolls
  // within this specifically, not the whole page (see subScreen
  // "stops"'s own layout: this list is its own internal scroll region).
  const stopsListRef = useRef<HTMLDivElement>(null);
  // Which row "Jump to next unverified" landed on last, so a repeated
  // click advances to the *next* one instead of re-landing on the same
  // first unresolved row every time. Cleared (via the timeout below)
  // shortly after each jump, purely to drop the temporary highlight -
  // the jump sequence itself is tracked separately, right below.
  const [highlightedRowIndex, setHighlightedRowIndex] = useState<number | null>(
    null,
  );
  const [lastJumpedRowIndex, setLastJumpedRowIndex] = useState<number | null>(
    null,
  );
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
  // A brand-new route always starts "draft" - publishing itself now
  // only ever happens from the route list screen, not here.
  const [status, setStatus] = useState<RouteStatus>(route?.status ?? "draft");
  // Seeded straight from initialWaypointCache when there is one (this
  // exact route's own cache from an earlier edit this session) - a
  // lazy initializer, not an effect, so there's no real network fetch
  // to skip in that case at all, only a genuine cache miss ever
  // reaches the effect below.
  const [cache, setCache] = useState<WaypointCache>(
    () => initialWaypointCache ?? {},
  );
  // Only ever holds an error now ("Route number is required.", "Couldn't
  // save: …") - a successful save used to also flash "Saving…"/"Saved."
  // through here, but `dirty` below (going false the moment Save
  // actually lands) is the real answer to "did that work," not a
  // transient status line that's gone again a moment later.
  const [message, setMessage] = useState<string | null>(null);
  // Guards the Save/Create Route/Publish buttons against a second tap
  // firing a second /api/routes request while the first is still in
  // flight - same "one at a time" guard fetchLocation's own
  // singleFetchCoolingDown already uses for Fetch Location.
  const [saving, setSaving] = useState(false);
  // True once a Save/Create Route attempt has actually been blocked by
  // a missing required field - a blank Route #/Trip/School isn't an
  // error on first paint, only once someone's tried to submit past it
  // (see handleSave and requiredFieldErrors below, and each field's own
  // `required`/errorInputClass use of these).
  const [showRequiredErrors, setShowRequiredErrors] = useState(false);
  // Whether mode "edit" has any real change since this screen opened
  // (or since the last successful Save) - every Details field's own
  // onChange, plus adding/updating/deleting a stop, sets this true;
  // Save itself clears it back to false on success. Drives Save's own
  // disabled state below, so there's always a plain, current answer to
  // "is there anything to save right now" instead of a "Saved."
  // message that's already stale the instant something else changes.
  // mode "add" doesn't read this at all - Create Route has no prior
  // saved state to be dirty against.
  const [dirty, setDirty] = useState(false);
  // mode "add" only - the paste box's own "Details" link, see
  // StopsFormatModal above.
  const [showFormatModal, setShowFormatModal] = useState(false);
  // mode "edit" only - which of the two screens this whole component is
  // currently showing: the hub (the Route Details form itself, plus an
  // "Edit Stops" button down to the second screen) or the Stops and
  // Turns table (still the one that owns its own Save/Cancel/Download
  // too, per its own JSX below - Save there and the hub's own Save
  // both call the same handleSave, so either screen can commit
  // whatever's changed on both, not just whichever one is showing).
  // Both share this one component's state directly rather than being
  // separately-mounted screens/routes, so nothing typed into Details is
  // ever lost switching over to Stops, or back. mode "add" never reads
  // this - it stays the single combined screen it always was, since a
  // route that doesn't exist yet has no stops of its own to split off
  // into a second screen.
  const [subScreen, setSubScreen] = useState<"hub" | "stops">("hub");

  // The school's own geocoded point, once known - reused across every
  // "Fetch"/"Fetch All" call in this edit session instead of
  // re-geocoding the school address on every single click (see
  // /api/geocode's own doc comment for why that specific repeat is
  // worse than merely wasteful - it's what actually triggered a live
  // 403 in production).
  const [schoolAnchor, setSchoolAnchor] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [fetchingStepIds, setFetchingStepIds] = useState<ReadonlySet<number>>(
    new Set(),
  );
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
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(
    null,
  );
  const [fetchError, setFetchError] = useState<FetchErrorInfo | null>(null);
  const [showFetchModal, setShowFetchModal] = useState(false);

  // Whatever's already geocoded, if anything - the shared Postgres
  // cache (src/app/api/waypoints), covering every route at once now
  // that it's no longer split into a sidecar file per route. That also
  // means, unlike the old per-route file fetch, this doesn't need to
  // re-run if the admin edits routeNumber/tripType/schoolLevel mid-edit
  // (changing which route this actually is) - the same one fetch
  // already has whatever that new identity's own stops would look up.
  useEffect(() => {
    // initialWaypointCache already seeded `cache` above (see its
    // useState initializer), so there's no fetch to do on mount here.
    if (initialWaypointCache) return;

    let cancelled = false;
    fetch("/api/waypoints")
      .then((res): Promise<WaypointCache> | WaypointCache =>
        res.ok ? res.json() : {},
      )
      .catch(() => ({}) as WaypointCache)
      .then((data) => {
        if (!cancelled) setCache(data);
      });
    return () => {
      cancelled = true;
    };
  }, [initialWaypointCache]);

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
  // unresolvedRequiredFields gives back ImportColumnField's own
  // camelCase identifiers ("fromLocation") - meaningless to someone
  // looking at their own sheet's header row, so this maps each one to
  // the actual column name they'd need to add instead (see
  // StopsFormatModal for the sheet's own real header names).
  const missingRequired = useMemo(
    () =>
      unresolvedRequiredFields(parseResult.mapping).map((field) =>
        field === "fromLocation" ? "from_location" : field,
      ),
    [parseResult],
  );

  // mode "edit" only - every row needs at least an action and a
  // location before deriveWaypoints can make sense of any of them (it
  // tracks "current road" across the whole list in order).
  const hasIncompleteRow = useMemo(
    () => rows.some((r) => !r.action.trim() || !r.location.trim()),
    [rows],
  );
  const { waypoints, previousRoads } = useMemo(() => {
    if (
      mode !== "edit" ||
      hasIncompleteRow ||
      !hasRealSchoolAddress ||
      rows.length === 0
    ) {
      return {
        waypoints: [] as WaypointQuery[],
        previousRoads: [] as (string | null)[],
      };
    }
    return deriveWaypointsWithContext(rows, schoolAddress);
  }, [mode, rows, hasIncompleteRow, hasRealSchoolAddress, schoolAddress]);
  const resolutionRows = useMemo(
    () => summarizeRouteResolution(waypoints, cache),
    [waypoints, cache],
  );
  const counts = useMemo(
    () => resolutionCounts(resolutionRows),
    [resolutionRows],
  );
  // Every already-resolved stop, in route order, with the school
  // spliced into whichever end tripType puts it - RouteMap.tsx's own
  // orderedWaypointsRef does the same splice for the same reason (the
  // school is a real leg of the trip but never one of `waypoints`
  // itself). PlaceCoordinatesModal's own context line reuses this list
  // to draw the actual route while an admin is placing a pin, so a
  // route with under two resolved points (nothing to draw a line
  // between yet) is left as an empty array rather than a special case
  // that component needs to know about.
  const routeContextPoints = useMemo(() => {
    const resolved = resolutionRows
      .filter((r) => r.status === "resolved")
      .map((r) => ({ lat: r.lat, lon: r.lon }));
    if (schoolLat == null || schoolLon == null) return resolved;
    const school = { lat: schoolLat, lon: schoolLon };
    return tripType === "dropoff"
      ? [school, ...resolved]
      : [...resolved, school];
  }, [resolutionRows, schoolLat, schoolLon, tripType]);

  // The row currently open in StepRowEditor's own waypoint, re-derived
  // from `draftRow` rather than read off `waypoints[expandedIndex]`
  // above - that array only ever reflects the last *committed* rows,
  // so a destination typed here but not yet saved via Update would
  // otherwise still fetch/show status for whatever this row used to
  // say. Recomputing the whole list (rather than just this one row) is
  // what deriveWaypointsWithContext already does for free, and it's
  // the only way to get this row's own `previousRoad` context exactly
  // right too. Same guard as `waypoints` above, so this stays undefined
  // in exactly the situations that array would have been empty in.
  const draftWaypoint = useMemo(() => {
    if (expandedIndex === null || !draftRow) return undefined;
    if (
      mode !== "edit" ||
      hasIncompleteRow ||
      !hasRealSchoolAddress ||
      rows.length === 0
    )
      return undefined;
    const draftRows = rows.map((r, i) => (i === expandedIndex ? draftRow : r));
    return deriveWaypointsWithContext(draftRows, schoolAddress).waypoints[
      expandedIndex
    ];
  }, [
    expandedIndex,
    draftRow,
    rows,
    schoolAddress,
    mode,
    hasIncompleteRow,
    hasRealSchoolAddress,
  ]);
  const draftStatus = useMemo(
    () =>
      draftWaypoint
        ? summarizeRouteResolution([draftWaypoint], cache)[0]
        : undefined,
    [draftWaypoint, cache],
  );

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
    setDirty(true);
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
    setDirty(true);
  }
  // Moves the row at `from` to sit at `to`, both real `rows` indices -
  // works the same regardless of "Show turns" (visibleRowIndices only
  // changes which rows are *offered* as a drop target here, never
  // what index dropping one actually moves to). No-op past the drag
  // handle's own `locked` guard when nothing dragged, or a drop back
  // onto its own starting row.
  function handleReorderRow(from: number, to: number) {
    if (from === to) return;
    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDirty(true);
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
    // fromLocation starts blank, same as every other new row - the
    // road already tracked heading into this exact position shows
    // live as StepRowEditor's own "From" placeholder (its own
    // `previousRoad` prop), so there's nothing to pre-fill into the
    // row's real data just to avoid a moment of "no context shown."
    setRows((prev) => {
      const next = [...prev];
      next.splice(index, 0, BLANK_ROW);
      return next;
    });
    setExpandedIndex(index);
    setDraftRow(BLANK_ROW);
    setNewlyAddedIndex(index);
    setDirty(true);
  }

  function handleFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be re-selected later
    if (!file) return;
    const filename = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setStepsText(reader.result);
      prefillFromImport(filename, reader.result);
    };
    reader.readAsText(file);
  }

  // Only ever called right after a real file upload (this screen's own
  // "Or paste manually" box has no filename of its own to read) - fills
  // in whichever of Route #/Trip this screen doesn't already have a
  // real value for from the filename itself, this district's own
  // "<routeNumber>-<AM/PM/FT/OT>-<school level>" naming convention (see
  // parseRouteFilename), then School from the sheet's own Depart/Arrive
  // rows (matchSchoolFromRows) - the school's own name or address
  // there is far more reliable than trusting the filename's own school-
  // level segment for that, and picking School this way already brings
  // schoolLevel along with it (schoolInfo lookup above, not a field of
  // its own). Never overwrites a field an admin already filled in by
  // hand before choosing a file.
  function prefillFromImport(filename: string, text: string) {
    const parsedName = parseRouteFilename(filename);
    if (parsedName.routeNumber && !routeNumber)
      setRouteNumber(parsedName.routeNumber);
    if (parsedName.tripType && !tripType) setTripType(parsedName.tripType);

    if (!schoolName) {
      const matchedSchool = matchSchoolFromRows(
        parseRouteImport(text).rows,
        schools,
      );
      if (matchedSchool) setSchoolName(matchedSchool);
    }
  }

  async function callGeocodeApi(
    query: GeocodableQuery,
  ): Promise<GeocodeResponseBody> {
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
    if (!res.ok)
      throw new GeocodeApiError(
        data.error ?? `${res.status} ${res.statusText}`,
        data.raw,
      );
    return data as GeocodeResponseBody;
  }

  // Real persistence for a resolved coordinate - the shared Postgres
  // cache (src/app/api/waypoints), not just this session's own `cache`
  // state. Best-effort: a failed write here doesn't interrupt the
  // fetch flow (the coordinate is still shown/usable this session
  // either way, from `cache`) or get surfaced as a fetch error, since
  // it isn't one - it'll simply need re-fetching (and re-persisting)
  // next time, same as a coordinate that was never geocoded at all.
  function persistWaypoint(key: string, entry: WaypointCacheEntry) {
    if (entry.status !== "ok") return;
    fetch("/api/waypoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, entry }),
    }).catch((err) => console.warn(`Couldn't persist waypoint "${key}":`, err));
  }

  // callGeocodeApi's own `anchorEntry` is only ever set when that exact
  // call is what freshly resolved the school's own address (see
  // fetchOneLocation's doc comment) - every other call (a plain address
  // query, or an intersection query reusing this session's own
  // `schoolAnchor`) sends null, so this is a no-op then. Without this,
  // the interactive Fetch Location/Fetch All flow could resolve the
  // school's own anchor point (needed to search for an intersection)
  // and reuse it all session via `schoolAnchor` state, yet never
  // actually save it anywhere real - only scripts/geocodeRoute.ts's own
  // batch pipeline did that.
  function persistSchoolAnchorIfFresh(anchorEntry: WaypointCacheEntry | null) {
    if (!anchorEntry) return;
    persistWaypoint(
      waypointCacheKey({ stepId: -1, kind: "address", text: schoolAddress }),
      anchorEntry,
    );
  }

  // A coordinate typed/pasted directly into StepRowEditor's own
  // Latitude/Longitude box - bypasses the geocoder entirely (there's
  // no query to send, no provider that resolved it), but still lands
  // in the exact same shared cache a real "Fetch" would, so the row
  // reads as resolved everywhere else that checks it (the collapsed
  // row's own green check, Publish's readiness count) the same way
  // either path got there.
  function setManualCoordinates(
    waypoint: GeocodableQuery,
    lat: number,
    lon: number,
  ) {
    const key = waypointCacheKey(waypoint);
    const entry: WaypointCacheEntry = {
      status: "ok",
      lat,
      lon,
      displayName: waypointLabel(waypoint),
      source: waypointLabel(waypoint),
      provider: "manual",
    };
    setCache((prev) => ({ ...prev, [key]: entry }));
    persistWaypoint(key, entry);
  }

  async function fetchLocation(waypoint: GeocodableQuery) {
    if (singleFetchCoolingDown) return; // the button's own disabled state should already prevent this
    setFetchError(null);
    setSingleFetchCoolingDown(true);
    setFetchingStepIds((prev) => new Set(prev).add(waypoint.stepId));
    try {
      const data = await callGeocodeApi(waypoint);
      if (data.anchor) setSchoolAnchor(data.anchor);
      persistSchoolAnchorIfFresh(data.anchorEntry);
      const key = waypointCacheKey(waypoint);
      setCache((prev) => ({ ...prev, [key]: data.result }));
      persistWaypoint(key, data.result);
      if (data.result.status === "error" && data.result.rateLimited) {
        setFetchError({
          message:
            "OpenRouteService's rate limit was reached - wait a bit before trying again.",
          rateLimited: true,
        });
      }
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
      window.setTimeout(
        () => setSingleFetchCoolingDown(false),
        SINGLE_FETCH_COOLDOWN_MS,
      );
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
    setBatchProgress({
      completed: 0,
      total: toFetch.length,
      currentLabel: waypointLabel(toFetch[0]),
    });
    try {
      for (const [index, waypoint] of toFetch.entries()) {
        setBatchProgress({
          completed: index,
          total: toFetch.length,
          currentLabel: waypointLabel(waypoint),
        });
        if (index > 0) await sleep(SINGLE_FETCH_COOLDOWN_MS);

        let data: GeocodeResponseBody;
        try {
          data = await callGeocodeApi(waypoint);
        } catch (err) {
          // A single waypoint's own request failing outright (a real
          // HTTP error - see WaypointCacheEntry's own doc on how that's
          // distinct from a normal "queried fine, found nothing" miss)
          // shouldn't take down every waypoint after it in the same
          // batch. Most often this is the school-address anchor lookup
          // an intersection query needs (ensureAnchor,
          // resolveWaypoint.ts) failing - only that one row's own
          // attempt actually needed it, and a later row (a plain
          // address, say, or a repeat intersection query once the
          // anchor genuinely does resolve) can still succeed on its own
          // merits. Recorded as this row's own "error" cache entry, the
          // same shape a genuine not-found already gets, so it shows up
          // exactly like any other miss - a red X and this message -
          // rather than silently stopping partway through with nothing
          // to show for every row after it.
          const key = waypointCacheKey(waypoint);
          const entry: WaypointCacheEntry = {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
            raw: err instanceof GeocodeApiError ? err.raw : undefined,
            source: waypointLabel(waypoint),
            provider: "none",
          };
          setCache((prev) => ({ ...prev, [key]: entry }));
          setFetchingStepIds((prev) => {
            const next = new Set(prev);
            next.delete(waypoint.stepId);
            return next;
          });
          continue;
        }
        if (data.anchor) setSchoolAnchor(data.anchor);
        persistSchoolAnchorIfFresh(data.anchorEntry);
        const key = waypointCacheKey(waypoint);
        setCache((prev) => ({ ...prev, [key]: data.result }));
        persistWaypoint(key, data.result);
        setFetchingStepIds((prev) => {
          const next = new Set(prev);
          next.delete(waypoint.stepId);
          return next;
        });
        // Stop the batch here rather than burning through - and
        // failing on - every remaining query the same way: once the
        // rate limit is hit it isn't coming back within this run.
        if (data.result.status === "error" && data.result.rateLimited) {
          setFetchError({
            message:
              "OpenRouteService's rate limit was reached - wait a bit before fetching more.",
            rateLimited: true,
          });
          return;
        }
      }
      setBatchProgress((prev) =>
        prev ? { ...prev, completed: toFetch.length } : prev,
      );
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
        (w): w is GeocodableQuery =>
          w.kind !== "unresolvable" &&
          cache[waypointCacheKey(w)]?.status !== "ok",
      ),
    );
  }

  // Deliberately re-spends a call on every geocodable row, "ok" ones
  // included - the modal's "Re-fetch All" button, for when an admin
  // suspects a previously-resolved coordinate is actually wrong.
  function refetchAllLocations() {
    return runFetchAll(
      waypoints.filter((w): w is GeocodableQuery => w.kind !== "unresolvable"),
    );
  }

  // Every field a RouteMeta needs, straight off this screen's own
  // current form state - shared by handleSave (building the route to
  // actually persist) and exportableRoute below (a live snapshot for
  // the download button, independent of whether it's been saved yet).
  // useCallback rather than a plain function so exportableRoute's own
  // useMemo can depend on it without recomputing on every unrelated
  // render.
  const buildMetaFields = useCallback(
    (nextStatus: RouteStatus): RouteMeta => {
      // Trip is required (see requiredFieldErrors below), so by the
      // time handleSave actually calls this, it's always a real
      // TripType - this fallback only ever shows up in exportableRoute's
      // own live preview of a still-incomplete form, never in anything
      // that actually gets saved.
      const effectiveTripType: TripType = tripType || "pickup";
      return {
        id: `${routeNumber}-${effectiveTripType}-${schoolLevel}`,
        status: nextStatus,
        name: `${schoolName} — ${tripTypeFullLabel(effectiveTripType)}`,
        routeNumber,
        driverName,
        busNumber,
        departureTime,
        schoolName,
        schoolAddress,
        schoolLevel,
        schoolLat,
        schoolLon,
        tripType: effectiveTripType,
        // Real mileage/timing needs actual routing calculation, not an
        // admin's own guess - these stay flat placeholders here the
        // same way they already do for every route loaded from the
        // master list (see page.tsx), filled in for real on the
        // backend later.
        distance: route?.distance ?? PLACEHOLDER_DISTANCE,
        durationMinutes: route?.durationMinutes ?? PLACEHOLDER_DURATION_MINUTES,
        isFavorite: route?.isFavorite ?? false,
        nextRouteId,
      };
    },
    [
      routeNumber,
      tripType,
      schoolLevel,
      schoolName,
      schoolAddress,
      schoolLat,
      schoolLon,
      departureTime,
      driverName,
      busNumber,
      route,
      nextRouteId,
    ],
  );

  // The only three fields this screen actually requires - a route
  // number (what gives a draft its own identity, see `id` above), a
  // trip type, and a school - everything else (bus number, driver,
  // start time, stops, whether they're geocoded) can genuinely be
  // filled in later. This deliberately lets a stub with just these
  // three get saved - readiness/publishing is the route list screen's
  // own concern now, not Save's.
  const routeNumberMissing = !routeNumber.trim();
  const tripTypeMissing = !tripType;
  const schoolNameMissing = !schoolName.trim();

  async function handleSave(nextStatus: RouteStatus = status) {
    if (routeNumberMissing || tripTypeMissing || schoolNameMissing) {
      setShowRequiredErrors(true);
      setMessage("Route #, Trip, and School are required.");
      return;
    }
    if (saving) return;
    const currentRows = mode === "add" ? parseResult.rows : rows;
    const built = buildRouteFromRows(currentRows, buildMetaFields(nextStatus));

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: built.id,
          // Only set in "edit" mode - a brand-new route (mode "add")
          // has no previous row to clean up after, even if its own
          // freshly-typed routeNumber/tripType/schoolLevel happen to
          // collide with something already saved (a real id collision,
          // not a rename - the upsert below already handles that case
          // correctly on its own).
          previousId: mode === "edit" ? (route?.id ?? null) : null,
          status: nextStatus,
          routeNumber: built.routeNumber,
          busNumber: built.busNumber,
          schoolName: built.schoolName,
          schoolLevel: built.schoolLevel,
          tripType: built.tripType,
          startTime: built.departureTime,
          nextRouteId: built.nextRouteId,
          steps: currentRows,
        }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        setMessage(`Couldn't save: ${data.error ?? res.statusText}`);
        return;
      }
    } catch (err) {
      setMessage(
        `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    } finally {
      setSaving(false);
    }

    setStatus(nextStatus);
    setDirty(false);
    onSave(built, currentRows, cache);
  }

  // A live snapshot of the route as currently edited (not just as last
  // saved) for the download button below - null while there's nothing
  // meaningful to export yet (same "route number required" floor
  // Save itself has), so the button can just hide instead of exporting
  // an unidentifiable route.
  const exportableRoute = useMemo(() => {
    if (!routeNumber.trim()) return null;
    const currentRows = mode === "add" ? parseResult.rows : rows;
    return buildRouteFromRows(currentRows, buildMetaFields(status));
  }, [routeNumber, mode, parseResult.rows, rows, status, buildMetaFields]);

  function handleDownloadCsv() {
    if (!exportableRoute) return;
    downloadCsv(
      `${exportableRoute.id}-stops.csv`,
      routeStepsToCsv(exportableRoute, cache),
    );
  }

  // Which rows to actually render below - every row when "Show turns"
  // is on, stops only otherwise (matching StartScreen's own "View All
  // Stops" default), further narrowed to just the unresolved ones when
  // "Unverified only" is on. Never affects the underlying `rows` state
  // itself, only what's currently displayed.
  const visibleRowIndices = rows
    .map((_, index) => index)
    .filter((index) => showTurns || rows[index].action.toLowerCase() === "stop")
    .filter(
      (index) =>
        !showUnverifiedOnly || resolutionRows[index]?.status === "unresolved",
    );

  // "Jump to next unverified"'s own target list - every *currently
  // visible* unresolved row (so it never lands on one hidden by "Show
  // turns" being off), independent of "Unverified only" itself (that
  // button's only ever shown while this list is the full one, not
  // already narrowed to just these rows - see its own render below).
  const unverifiedRowIndices = rows
    .map((_, index) => index)
    .filter((index) => showTurns || rows[index].action.toLowerCase() === "stop")
    .filter((index) => resolutionRows[index]?.status === "unresolved");

  function jumpToNextUnverified() {
    if (unverifiedRowIndices.length === 0) return;
    const currentPos =
      lastJumpedRowIndex != null
        ? unverifiedRowIndices.indexOf(lastJumpedRowIndex)
        : -1;
    const nextIndex =
      unverifiedRowIndices[(currentPos + 1) % unverifiedRowIndices.length];
    setLastJumpedRowIndex(nextIndex);
    setHighlightedRowIndex(nextIndex);
    stopsListRef.current
      ?.querySelector(`[data-row-index="${nextIndex}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(
      () =>
        setHighlightedRowIndex((prev) => (prev === nextIndex ? null : prev)),
      1500,
    );
  }

  // Precomputed outside the JSX map below (not incremented inline in the
  // render callback) so React Compiler's per-item memoization doesn't see a
  // mutated closure variable - each stop row looks up its own number here.
  let stopCounter = 0;
  const stopNumbers = new Map<number, number>();
  for (const index of visibleRowIndices) {
    if (rows[index].action.toLowerCase() === "stop")
      stopNumbers.set(index, ++stopCounter);
  }

  // Shared by mode "add"'s single screen and mode "edit"'s own
  // dedicated Details screen (see subScreen below) - identical either
  // way, so it's built once here rather than duplicated. Route #/Trip/
  // Start share one line (the three things a driver actually needs
  // for the trip itself); School gets its own full-width line right
  // after (picking the wrong school is the single costliest mistake in
  // this whole form); Bus number/Driver share a line last - least
  // important, neither means much without the other.
  const routeDetailsForm = (
    <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Route #" required={routeNumberMissing}>
          <input
            className={
              showRequiredErrors && routeNumberMissing
                ? errorInputClass
                : inputClass
            }
            value={routeNumber}
            onChange={(e) => {
              setRouteNumber(e.target.value);
              setDirty(true);
            }}
            placeholder="123"
          />
        </Field>
        <Field label="Trip" required={tripTypeMissing}>
          <select
            className={
              showRequiredErrors && tripTypeMissing
                ? errorInputClass
                : inputClass
            }
            value={tripType}
            onChange={(e) => {
              setTripType(e.target.value as TripType | "");
              setDirty(true);
            }}
          >
            <option value="">Select…</option>
            <option value="pickup">AM pickup</option>
            <option value="dropoff">PM drop off</option>
            <option value="fieldtrip">Field Trip</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Start">
          <input
            className={inputClass}
            value={departureTime}
            onChange={(e) => {
              setDepartureTime(e.target.value);
              setDirty(true);
            }}
            placeholder="H:MM AM"
          />
        </Field>
      </div>

      {/* School level and address are never picked or typed separately
          - both come from whichever school is chosen here, looked up
          in `schools` (Postgres, via /api/schools). */}
      <div className="mt-3">
        <Field label="School" required={schoolNameMissing}>
          <select
            className={
              showRequiredErrors && schoolNameMissing
                ? errorInputClass
                : inputClass
            }
            value={schoolName}
            onChange={(e) => {
              setSchoolName(e.target.value);
              setDirty(true);
            }}
          >
            <option value="">Select a school</option>
            {schoolOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
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
        <Field label="Bus number">
          <input
            className={inputClass}
            value={busNumber}
            onChange={(e) => {
              setBusNumber(e.target.value);
              setDirty(true);
            }}
            placeholder="123"
          />
        </Field>
        {/* What happens once this route's last step is reached, instead
            of always just ending the trip - either a real chained route
            (same bus driving more than one leg back-to-back - elementary,
            then middle school, say - see nextRouteOptions above, grouped
            here under "Begin Next Route" since picking one of those is
            what actually sets this), or DEPOT_NEXT_ACTION, a fixed
            sentinel this app recognizes but no real Route.id could ever
            collide with (every real one is `${routeNumber}-${tripType}-
            ${schoolLevel}`, always hyphenated) - "the driver heads back
            to base," not "hand off into another route's own directions"
            the way a real chain does (handleRouteArrived in page.tsx),
            which still ends the trip exactly like leaving this blank
            does. Genuinely distinguishing an actual return-to-depot leg
            (its own real stops/navigation) is a later step - see the
            README's own Next steps - this is just the honest label for
            "ends the trip, but the driver isn't just stopping wherever
            the last stop happened to be." Defaults to whichever eligible
            chained route (nextRouteOptions) runs the next school level
            up, if there is one - see the nextRouteId state's own doc
            comment for exactly how. Sits where "Driver" used to (see
            EditRouteScreen's own doc comment on why that field is gone
            for now) - a real driver is a person to assign to a route,
            not a property of the route itself; that's a later feature,
            once there's a real user entity to assign. */}
        <Field label="Next Action">
          <select
            className={inputClass}
            value={nextRouteId ?? ""}
            onChange={(e) => {
              setNextRouteId(e.target.value || null);
              setDirty(true);
            }}
          >
            <option value="">Nothing - End Route</option>
            <option value={DEPOT_NEXT_ACTION}>Return to Depot</option>
            {nextRouteOptions.length > 0 && (
              <optgroup label="Begin Next Route">
                {nextRouteOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.routeNumber} — {r.schoolName}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      </div>
    </div>
  );

  if (mode === "add") {
    return (
      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pb-10 text-center">
        <div className="flex w-full max-w-md items-center justify-between">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
          >
            <BackArrowIcon className="h-5 w-5" />
          </button>
          <h1 className="font-heading text-2xl font-black tracking-tight">
            New Route
          </h1>
          <span className="w-10" />
        </div>

        <CollapsibleSection title="Route Details">
          {routeDetailsForm}
        </CollapsibleSection>

        <CollapsibleSection title="Stops and Turns">
          <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-glossy-light flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-900"
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
                Couldn&apos;t find a column for: {missingRequired.join(", ")} -
                stops won&apos;t come through until that&apos;s fixed, but the
                route can still be saved as a draft.
              </p>
            )}
            {parseResult.headerless && parseResult.rows.length > 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                No column header recognized - read as a plain list (
                {parseResult.rows.length} row
                {parseResult.rows.length === 1 ? "" : "s"}).
              </p>
            )}
            {parseResult.unmatchedSourceHeaders.length > 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                Ignored column
                {parseResult.unmatchedSourceHeaders.length === 1
                  ? ""
                  : "s"}: {parseResult.unmatchedSourceHeaders.join(", ")}
              </p>
            )}
          </div>
        </CollapsibleSection>

        {message && <p className="text-sm text-zinc-500">{message}</p>}

        <div className="flex w-full max-w-md flex-col gap-2">
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving}
            className="btn-glossy-blue font-heading flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-lg font-bold text-white disabled:opacity-60"
          >
            Create Route
            <RightArrowIcon className="h-5 w-5" />
          </button>
        </div>

        {showFormatModal && (
          <StopsFormatModal onClose={() => setShowFormatModal(false)} />
        )}
      </div>
    );
  }

  // mode "edit" - a small hub (the Route Details form, editable right
  // there with its own Save/Cancel, plus an "Edit Stops" button below)
  // by default, or the Stops and Turns screen once that's picked.

  if (subScreen === "stops") {
    return (
      <div className="flex flex-1 flex-col items-center gap-3 overflow-hidden px-6 pb-2 text-center">
        {/* Everything that can genuinely grow past the viewport (the
            stops table especially) lives in this inner, scrollable
            region - Download/Cancel/Save below stay outside it, pinned
            to the bottom of the screen instead of scrolling away with
            a long stops list. */}
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-3">
          <div className="flex w-full max-w-md items-center justify-between">
            <button
              type="button"
              onClick={() => setSubScreen("hub")}
              aria-label="Back"
              className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
            >
              <BackArrowIcon className="h-5 w-5" />
            </button>
            <h1 className="font-heading text-2xl font-black tracking-tight">
              Stops and Turns
            </h1>
            <span className="w-10" />
          </div>

          {/* A secondary heading naming exactly which route this is -
              route number/trip/school, same badge convention every
              other route callout in the app uses (RouteListScreen's own
              rows, StartScreen's title) - so this doesn't read as a
              generic "stops" screen once Details is a separate tap
              away and no longer visible alongside it. Quick-stats line
              right under it answers the one question an admin actually
              opens this screen to check, without having to count green
              checks down the list themselves. */}
          <div className="flex w-full max-w-md shrink-0 flex-col items-center gap-0.5">
            <p className="flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0.5">
              <span className="font-heading text-lg font-black tracking-tight">
                {routeNumber || (
                  <span className="text-zinc-400 italic">No route number</span>
                )}
              </span>
              {/* am.svg/pm.svg carry their own "AM"/"PM" lettering, so
                  pickup/dropoff is just the icon alone, sized to the
                  route number's own height. Every other TripType
                  (fieldtrip/other) skips the badge entirely - those
                  routes may not even have a morning/afternoon
                  distinction to badge, and there's no real example of
                  one yet to design that case against. */}
              {routeNumber &&
                (tripType === "pickup" || tripType === "dropoff") && (
                  <TripTypeIcon
                    tripType={tripType}
                    className="h-3 w-3 text-zinc-400"
                  />
                )}
              <span className="min-w-0 truncate text-sm font-semibold text-zinc-600">
                {schoolName || "No school selected"}
              </span>
            </p>
            {counts.total - counts.skipped > 0 &&
              (() => {
                // Every waypoint that actually needs a real coordinate -
                // every row except one deriveWaypoints.ts flagged as
                // "unresolvable" (a driver instruction, not a real
                // road) or an admin marked Skip on by hand - neither of
                // which this count (or the meter below) should ever
                // penalize a route for not having geocoded, since
                // neither one is ever going to get a coordinate at all.
                const geocodable = counts.total - counts.skipped;
                const allVerified = counts.resolved === geocodable;
                const percentVerified = (counts.resolved / geocodable) * 100;
                return (
                  <div className="flex w-full max-w-[16rem] flex-col items-center gap-1">
                    <p className="flex items-center gap-1 text-xs font-semibold text-zinc-500">
                      {allVerified ? (
                        <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-green-600" />
                      ) : (
                        <XCircleIcon className="h-3.5 w-3.5 shrink-0 text-red-500" />
                      )}
                      {allVerified
                        ? `All ${geocodable} location${geocodable === 1 ? "" : "s"} verified`
                        : `${counts.unresolved} of ${geocodable} coordinate${geocodable === 1 ? "" : "s"} could not be verified`}
                    </p>
                    <GeocodeRatioBar percent={percentVerified} />
                  </div>
                );
              })()}
          </div>

          <div className="flex w-full max-w-md shrink-0 items-center justify-between gap-3">
            <ToggleSwitch
              checked={showTurns}
              onChange={setShowTurns}
              label="Show turns"
            />
            <button
              type="button"
              onClick={() => setShowFetchModal(true)}
              className="btn-glossy-light flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-900"
            >
              <GlobeIcon className="h-3.5 w-3.5" />
              Fetch Coordinates…
            </button>
          </div>

          <div className="flex w-full max-w-md shrink-0 items-center justify-between gap-3">
            <ToggleSwitch
              checked={showUnverifiedOnly}
              onChange={setShowUnverifiedOnly}
              label="Unverified only"
            />
            {/* Only offered from the full list - "Unverified only" above
                already narrows to exactly these rows, so a shortcut to
                find one among them would be redundant. */}
            {!showUnverifiedOnly && unverifiedRowIndices.length > 0 && (
              <button
                type="button"
                onClick={jumpToNextUnverified}
                className="btn-glossy-light flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-900"
              >
                <XCircleIcon className="h-3.5 w-3.5 text-red-500" />
                Jump to next unverified
              </button>
            )}
          </div>
          {hasIncompleteRow && (
            <p className="w-full max-w-md shrink-0 text-xs text-red-600">
              Every stop needs at least a type and a location before locations
              can be checked.
            </p>
          )}

          <div className="flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-300 text-left">
            {/* An "Add Step" control before the first row and after
                every row, not just once at the bottom - a new stop or
                turn can be dropped in anywhere along the route's real
                order this way, not only appended past the last one.
                Real padding on this scrollable region itself (not just
                the static card around it) so the first/last row never
                sits flush against the box's own edges, scrolled to
                either end or not. */}
            <div
              ref={stopsListRef}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            >
              <AddStepButton
                onClick={() => addRow(0)}
                disabled={expandedIndex !== null}
              />
              {visibleRowIndices.map((index) => {
                const row = rows[index];
                const isStop = row.action.toLowerCase() === "stop";
                const stopNumber = isStop
                  ? (stopNumbers.get(index) ?? null)
                  : null;
                const waypoint = waypoints[index];

                return (
                  <div
                    key={index}
                    data-row-index={index}
                    className={
                      highlightedRowIndex === index
                        ? "rounded-lg ring-2 ring-amber-400 transition-shadow"
                        : dragRowIndex === index
                          ? "opacity-40"
                          : dragOverIndex === index && dragRowIndex !== null
                            ? "border-t-2 border-blue-500"
                            : ""
                    }
                  >
                    <StepRowView
                      row={row}
                      stopNumber={stopNumber}
                      previousRoad={previousRoads[index] ?? null}
                      schools={schools}
                      status={waypoint ? resolutionRows[index] : undefined}
                      locked={expandedIndex !== null}
                      onEdit={() => openRowEditor(index)}
                      onDragStart={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDragRowIndex(index);
                        setDragOverIndex(index);
                      }}
                      onDragMove={(e) => {
                        const target = document
                          .elementFromPoint(e.clientX, e.clientY)
                          ?.closest("[data-row-index]");
                        const overIndex = target
                          ? Number(target.getAttribute("data-row-index"))
                          : null;
                        if (overIndex !== null && !Number.isNaN(overIndex))
                          setDragOverIndex(overIndex);
                      }}
                      onDragEnd={(e) => {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                        if (dragRowIndex !== null && dragOverIndex !== null) {
                          handleReorderRow(dragRowIndex, dragOverIndex);
                        }
                        setDragRowIndex(null);
                        setDragOverIndex(null);
                      }}
                    />
                    <AddStepButton
                      onClick={() => addRow(index + 1)}
                      disabled={expandedIndex !== null}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* One row's own editor, as a modal popup rather than swapped
            in for its StepRowView above - only ever rendered for
            `expandedIndex`, so it's hoisted out of the map above (a
            single instance, not one possible instance per row) rather
            than an inline ternary inside it. Uses draftWaypoint/
            draftStatus above (re-derived from `draftRow` on every
            change), never `waypoints[index]`/`resolutionRows[index]` -
            those only reflect the last *committed* row, so Fetch would
            otherwise look up whatever this row said before this edit
            even opened. The IIFE below just gives `index` its own real
            const binding, so the callbacks passed to StepRowEditor
            close over a value that can't have changed out from under
            them by the time a click actually fires. */}
        {expandedIndex !== null &&
          draftRow &&
          (() => {
            const index = expandedIndex;
            const isStop = rows[index].action.toLowerCase() === "stop";
            return (
              <StepRowEditor
                row={draftRow}
                stopNumber={isStop ? (stopNumbers.get(index) ?? null) : null}
                previousRoad={previousRoads[index] ?? null}
                schools={schools}
                routeSchoolName={schoolName}
                status={draftStatus}
                fetching={
                  draftWaypoint
                    ? fetchingStepIds.has(draftWaypoint.stepId)
                    : false
                }
                fetchLocked={singleFetchCoolingDown}
                placementGuess={nearestResolvedGuess(resolutionRows, index)}
                routeContext={routeContextPoints}
                onChange={handleDraftChange}
                onFetch={() =>
                  draftWaypoint &&
                  draftWaypoint.kind !== "unresolvable" &&
                  fetchLocation(draftWaypoint)
                }
                onManualCoordinates={(lat, lon) =>
                  draftWaypoint &&
                  draftWaypoint.kind !== "unresolvable" &&
                  setManualCoordinates(draftWaypoint, lat, lon)
                }
                onCancel={handleCancelRow}
                onDelete={() => handleDeleteRow(index)}
                onUpdate={handleUpdateRow}
              />
            );
          })()}

        <div className="flex w-full max-w-md shrink-0 flex-col gap-1.5">
          {/* A plain text link, not a button - matches RouteListScreen's
              own "Download routes" link. Still just a flat CSV of this
              one route's stops for now. */}
          {exportableRoute && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleDownloadCsv}
                aria-label="Download this route's stops and turns as a CSV"
                className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 active:text-blue-800"
              >
                <DownloadIcon className="h-4 w-4" />
                Download stops
              </button>
            </div>
          )}
          {message && <p className="text-sm text-zinc-500">{message}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="btn-glossy-light font-heading flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-300 py-3 text-lg font-semibold text-zinc-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={saving || !dirty}
              className="btn-glossy-blue font-heading flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-lg font-bold text-white disabled:opacity-40"
            >
              <SaveIcon className="h-5 w-5" />
              Save
            </button>
          </div>
        </div>

        {showFetchModal && (
          <FetchCoordinatesModal
            counts={counts}
            fetchRunning={fetchAllRunning}
            batchProgress={batchProgress}
            fetchError={fetchError}
            onFetchMissing={fetchMissingLocations}
            onRefetchAll={refetchAllLocations}
            onClose={() => setShowFetchModal(false)}
          />
        )}
      </div>
    );
  }

  // subScreen "hub"
  return (
    <div className="flex flex-1 flex-col items-center gap-3 overflow-hidden px-6 pb-2 text-center">
      {/* Everything that can genuinely grow past the viewport (the
          Route Details form especially) lives in this inner, scrollable
          region - Edit Stops/Cancel/Save below stay outside it, pinned
          to the bottom of the screen instead of scrolling away, same
          pattern subScreen "stops" already uses for its own footer. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-4 overflow-y-auto">
        <div className="flex w-full max-w-md items-center justify-between">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
          >
            <BackArrowIcon className="h-5 w-5" />
          </button>
          <div>
            {/* Same small district label StartScreen/RouteListScreen/
                SchoolListScreen each carry above their own heading - see
                StartScreen's own doc comment for why this isn't folded
                into the heading itself. Same text-4xl size as that
                screen's own title now too, not the smaller text-2xl
                this used to be - this is the same "Route N" callout,
                just reached from Edit Mode instead of tapping a row, so
                it reads the same size either way. */}
            <span className="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Rutherford County
            </span>
            {/* mt-[1.25px] - the exact same leading-[0.7083]-collapses-
                the-gap fix as StartScreen's own title (see that h1's
                own doc comment for the full canvas-metrics
                explanation) - reused unchanged, not re-measured, since
                this is now literally the same text-4xl size that value
                was tuned against. */}
            <h1 className="font-heading relative mt-[1.25px] text-4xl leading-[0.7083] font-black tracking-tight">
              Route {route?.routeNumber ?? ""}
              {/* am.svg/pm.svg carry their own "AM"/"PM" lettering, so
                  pickup/dropoff is vertically centered against the
                  title's full height and sized to nearly match it.
                  Every other TripType (fieldtrip/other) skips the
                  badge entirely - those routes may not even have a
                  morning/afternoon distinction to badge, and there's
                  no real example of one yet to design that case
                  against. */}
              {route?.routeNumber &&
                (tripType === "pickup" || tripType === "dropoff") && (
                  <TripTypeIcon
                    tripType={tripType}
                    className="absolute top-1/2 left-full ml-2 h-6 w-6 -translate-y-1/2 text-zinc-400"
                  />
                )}
            </h1>
          </div>
          <span className="w-10" />
        </div>

        {routeDetailsForm}

        {counts.total - counts.skipped > 0 &&
          (() => {
            // Same "every geocodable waypoint" definition the Edit
            // Stops screen's own meter/message use (see its doc
            // comment) - skipped/unresolvable rows never count against
            // either the bar or the two tallies below.
            const geocodable = counts.total - counts.skipped;
            const percentVerified = (counts.resolved / geocodable) * 100;
            return (
              <div className="flex w-full max-w-md shrink-0 flex-col items-center gap-1.5">
                <GeocodeRatioBar percent={percentVerified} />
                <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs font-semibold">
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
                    {counts.resolved} waypoint{counts.resolved === 1 ? "" : "s"}{" "}
                    valid
                  </span>
                  <span className="text-zinc-300">|</span>
                  <span className="flex items-center gap-1 text-red-600">
                    <XCircleIcon className="h-3.5 w-3.5 shrink-0" />
                    {counts.unresolved} waypoint
                    {counts.unresolved === 1 ? "" : "s"} unresolved
                  </span>
                </p>
              </div>
            );
          })()}

        {message && <p className="text-sm text-zinc-500">{message}</p>}
      </div>

      <div className="w-full max-w-md shrink-0">
        <button
          type="button"
          onClick={() => setSubScreen("stops")}
          className="btn-glossy-light font-heading flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-300 py-3 text-base font-semibold text-zinc-900"
        >
          <MapPinIcon className="h-5 w-5" />
          Edit Stops
        </button>
      </div>

      <div className="flex w-full max-w-md shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="btn-glossy-light font-heading flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-300 py-3 text-lg font-semibold text-zinc-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={saving || !dirty}
          className="btn-glossy-blue font-heading flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-lg font-bold text-white disabled:opacity-40"
        >
          <SaveIcon className="h-5 w-5" />
          Save
        </button>
      </div>
    </div>
  );
}
