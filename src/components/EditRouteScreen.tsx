"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { IconTooltip } from "./IconTooltip";
import { ScreenTransition } from "./ScreenTransition";
import { ToggleSwitch } from "./ToggleSwitch";
import { TripTypeIcon } from "./TripTypeIcon";
import { PlaceCoordinatesModal } from "./PlaceCoordinatesModal";
import { SchoolLevelIcon } from "./SchoolLevelIcon";
import { WaypointPreviewMap } from "./WaypointPreviewMap";
import type { StopPin } from "./WaypointPreviewMap";
import { LA_VERGNE_CENTER } from "./RouteMap";
import {
  ActionIcon,
  AddressBookIcon,
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  BackArrowIcon,
  CheckCircleIcon,
  CloseIcon,
  CompassIcon,
  CopyIcon,
  DownloadIcon,
  DragHandleIcon,
  EditIcon,
  GlobeIcon,
  MapPinIcon,
  PersonSolidIcon,
  PlusIcon,
  ReverseIcon,
  RightArrowIcon,
  RoundedTriangleIcon,
  SaveIcon,
  ScissorsIcon,
  SearchIcon,
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
  formatWaypointInstructionParts,
  titleCaseAction,
  waypointConnectorWord,
} from "@/lib/parseRouteCsv";
import type { RawRouteRow, RouteMeta } from "@/lib/parseRouteCsv";
import { deriveWaypointsWithContext } from "@/lib/deriveWaypoints";
import type { WaypointQuery } from "@/lib/deriveWaypoints";
import { downloadCsv, routeStepsToCsv } from "@/lib/exportCsv";
import type { GeocodableQuery } from "@/lib/geocode";
import {
  matchSchoolFromRows,
  parseRouteImport,
  serializeRouteImport,
  unresolvedRequiredFields,
} from "@/lib/parseRouteImport";
import { parseRouteFilename } from "@/lib/parseRouteMasterList";
import { routeTitleSizeClass } from "@/lib/routeTitle";
import { reverseRouteRows, reverseTripType } from "@/lib/reverseRoute";
import {
  PLACEHOLDER_DISTANCE,
  PLACEHOLDER_DURATION_MINUTES,
  SCHOOL_ADDRESS_NOT_YET_PROVIDED,
} from "@/lib/placeholderMeta";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import type { SavedLocationInfo } from "@/lib/savedLocations";
import {
  resolutionCounts,
  summarizeRouteResolution,
} from "@/lib/routeResolutionStatus";
import type {
  RouteResolutionCounts,
  RowResolutionStatus,
} from "@/lib/routeResolutionStatus";
import { schoolLevelLabel } from "@/lib/schoolLevel";
import { parseTimeInput } from "@/lib/time";
import { tripTypeFullLabel } from "@/lib/tripType";
import { waypointCacheKey } from "@/lib/waypointCache";
import type { WaypointCache, WaypointCacheEntry } from "@/lib/waypointCache";
import type { Route, RouteStatus, SchoolLevel, TripType } from "@/lib/types";
import type { GeocodeResponseBody } from "@/app/api/geocode/route";
import type { FallbackDetail } from "@/lib/resolveWaypoint";

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
      ? `${row.action || "Turn"} from ${effectiveFrom} ${waypointConnectorWord(row.action)} ${row.location}`
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
// display order - reused for that select's own value and for
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

// Every real option's own trimmed/lowercased form, mapped back to its
// canonical (correctly-cased) spelling - a row already sitting in the
// database with a merely differently-cased or stray-whitespace value
// ("left", "STOP ", both real data from a district's own CSV rather
// than a typo) still resolves to its real option this way, instead of
// an exact-string match reading it as unspecified/invalid just because
// it isn't byte-for-byte identical to how the dropdown itself spells
// it.
const WAYPOINT_TYPE_BY_KEY: Record<string, string> = Object.fromEntries(
  WAYPOINT_TYPES.map((type) => [type.toLowerCase(), type]),
);

/** The real option a row's own `action` value actually means, or null
 * when it doesn't match any of them even loosely (case/whitespace
 * aside) - shared by the Type select's own displayed value (below) and
 * rowValidationIssue (further below), so a row already correctly typed
 * in the database is never shown as "- Unspecified -" just because its
 * casing doesn't match the dropdown's own, and a row that's genuinely
 * something else entirely is never silently treated as valid either. */
function canonicalWaypointType(action: string): string | null {
  return WAYPOINT_TYPE_BY_KEY[action.trim().toLowerCase()] ?? null;
}

/** A concrete reason a row's own raw data can't be trusted, or null
 * when it's fine - the main way a row actually ends up this way is a
 * loosely-typed import (a blank or misspelled action cell, a location
 * column that didn't map), but the check itself doesn't care how the
 * row got here. Read by StepRowView below to flag the row with a red
 * border and a warning triangle carrying this same message, so a bad
 * import surfaces immediately in the stops list rather than only once
 * an admin happens to expand that one row. Checked against the Type
 * select's own real options (WAYPOINT_TYPES) rather than some broader
 * "recognized by the app somewhere" set - stray data that doesn't
 * match anything an admin can actually pick is exactly what's worth a
 * human's attention here, even if some other part of this app happens
 * to tolerate it. */
function rowValidationIssue(row: RawRouteRow): string | null {
  if (!canonicalWaypointType(row.action)) {
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

/** A location field that's resolved to a real School or SavedLocation
 * by name (StepRowEditor's own Location field, EditRouteScreen's own
 * School field) - the outer box still reads as the same text-input
 * shape every other field here uses (border, rounded, white), with the
 * matched name as its own distinct chip nested inside rather than
 * stretched to fill the whole box, so a resolved match and a plain
 * typed-but-unmatched value both still look like "a text box," just
 * with something concrete sitting in this one. The chip's own darker
 * fill plus a 1px border of its own is what actually makes a real
 * match read clearly, rather than a near-white tint against this same
 * white box that a glance could mistake for empty. */
function MatchedLocationChip({
  name,
  onClear,
  clearLabel,
}: {
  name: string;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <div className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-zinc-200 bg-white px-1.5">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-zinc-400 bg-zinc-200 py-1 pr-1.5 pl-2.5">
        <span className="min-w-0 truncate text-sm font-semibold text-zinc-900">
          {name}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-300 active:text-zinc-700"
        >
          <CloseIcon className="h-2.5 w-2.5" />
        </button>
      </span>
    </div>
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
  // The "View Error" popup for this row's own unresolved status
  // (status.raw below) - lets an admin see the literal geocoder
  // response right from the collapsed list, the same detail
  // StepRowEditor's own expanded view offers, without first opening
  // the row's editor just to find out why it failed.
  const [showErrorDetail, setShowErrorDetail] = useState(false);
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
                {titleCaseAction(row.action)}
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
                {titleCaseAction(row.action) || "Turn"}
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
              {status.status === "unresolved" && status.raw && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowErrorDetail(true);
                  }}
                  className="font-semibold text-red-600 underline underline-offset-2"
                >
                  View Error
                </button>
              )}
            </p>
          )
        )}
        {showErrorDetail && status?.status === "unresolved" && (
          <ErrorDetailsModal
            message={status.detail ?? status.reason}
            raw={status.raw}
            onClose={() => setShowErrorDetail(false)}
          />
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
  savedLocations,
  locationSuggestions,
  onSaveSavedLocation,
  onFetchSavedLocationCoords,
  routeSchoolName,
  isNew,
  status,
  fetching,
  fetchLocked,
  placementGuess,
  routeContext,
  stopPins,
  onChange,
  onLocationChange,
  onClickWaypointPin,
  onFetch,
  onManualCoordinates,
  onCancel,
  onDelete,
  onUpdate,
  canGoPrev,
  canGoNext,
  onNavigate,
  onAddWaypointAfter,
  hideDelete,
}: {
  row: RawRouteRow;
  stopNumber: number | null;
  /** The road deriveWaypoints.ts already has tracked as "current"
   * heading into this row, from every row before it - null only for
   * the very first row, or when nothing earlier has named a real road
   * yet. */
  previousRoad: string | null;
  /** Every known school, by name - the same lookup the Route Details
   * form's own School <select> uses. Lets a row whose typed location
   * matches one show that school's real address underneath, and is one
   * of the two lists (alongside savedLocations below) the address-book
   * popup (AddressBookIcon, beside the Location field) picks from. */
  schools: Record<string, SchoolInfo>;
  /** Every saved location (the depot, a driver's own home address,
   * anywhere else worth picking by name instead of retyping - see
   * prisma/schema.prisma's own SavedLocation doc comment), fetched once
   * by EditRouteScreen on mount. The address book's own second list,
   * alongside schools above - picking either one there fills Location
   * with that exact name and, when it already has a cached lat/lon,
   * resolves this row immediately (onManualCoordinates) instead of
   * waiting on a fresh geocode. */
  savedLocations: SavedLocationInfo[];
  /** Every location this app already has a resolved coordinate for,
   * anywhere in the district (EditRouteScreen's own locationSuggestions,
   * fetched once on mount from /api/location-suggestions) - a street, a
   * business, anything successfully geocoded before, school names and
   * saved-location addresses included. Combined with every School/
   * SavedLocation name (locationDatalistOptions below) to power the
   * Location field's own <datalist> suggestions, a plain browser-native
   * autocomplete against what's already known rather than a live map/
   * geocoder search. */
  locationSuggestions: string[];
  /** Creates (`id: null`) or updates (`id` set) a saved location - the
   * address book's own "+ Add Location" footer button and each saved
   * location's own pencil icon both open EditSavedLocationModal, and
   * both funnel their Save through this one prop. POSTs/PATCHes
   * /api/saved-locations and, on success, adds/updates the record in
   * EditRouteScreen's own savedLocations state so it's immediately
   * reflected without a refetch. Returns the saved record, or an error
   * message the modal shows inline instead of closing. */
  onSaveSavedLocation: (
    id: number | null,
    name: string,
    address: string,
    lat: number | null,
    lon: number | null,
  ) => Promise<SavedLocationInfo | { error: string }>;
  /** A preview-only geocode for EditSavedLocationModal's own Fetch
   * button - resolves an address without persisting anything. */
  onFetchSavedLocationCoords: (
    address: string,
  ) => Promise<{ lat: number; lon: number } | { error: string }>;
  /** This route's own school (Route Details form) - defaults a fresh
   * Depart/Arrive row's location the moment its Type is picked, since
   * arriving at or departing from *some other* school is the rare case
   * (a field trip, say), not the default one. */
  routeSchoolName: string;
  /** True only for the one row `addRow` just inserted, still unedited -
   * shows "Add Waypoint" here instead of "Edit Waypoint" since there's
   * nothing to edit yet, just fill in (EditRouteScreen's own
   * newlyAddedIndex). */
  isNew: boolean;
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
  /** Every already-resolved Stop's own coordinate, numbered
   * (EditRouteScreen's own `stopPins`, a subset of `routeContext`
   * above) - handed to the WaypointPreviewMap at the bottom of this
   * card, red and numbered, so an admin can see this row's own point
   * next to its neighboring stops, not just the road-following line
   * alone. `rowIndex` is what lets tapping one of those dots open that
   * row's own editor (onClickWaypointPin below). */
  stopPins: StopPin[];
  onChange: (patch: Partial<RawRouteRow>) => void;
  /** Opens a different row's own editor in place of this one - the
   * same "save this row's draft, then open the target" goToRowIndex
   * does for the header's own prev/next arrows (EditRouteScreen), now
   * also reachable by tapping one of stopPins' own dots on the map. */
  onClickWaypointPin: (rowIndex: number) => void;
  /** The Location field's own onChange, in place of the plain
   * `onChange({ location })` every other field here uses directly - see
   * EditRouteScreen's own handleLocationChange for the extra step this
   * adds (an immediate coordinate resolve when the new text exactly
   * matches a School/SavedLocation that already has one). */
  onLocationChange: (value: string) => void;
  onFetch: () => void;
  /** A coordinate typed/pasted directly into the Latitude/Longitude
   * box, parsed and handed up on Save (see handleSave below) - writes
   * straight into the shared waypoint cache, the same place a real
   * Fetch would have, bypassing the geocoder entirely. */
  onManualCoordinates: (lat: number, lon: number) => void;
  onCancel: () => void;
  onDelete: () => void;
  onUpdate: () => void;
  /** Whether the header's own prev/next arrows have anywhere to go -
   * both false for a route with only one currently-visible waypoint
   * (see EditRouteScreen's own visibleRowIndices, which already
   * respects "Stops only"), so navigating never has to guess whether
   * it's about to run off either end of the list. */
  canGoPrev: boolean;
  canGoNext: boolean;
  /** Saves this row's own draft (same as tapping Update) and opens the
   * next/previous *visible* row's editor in its place - "visible"
   * meaning whatever "Stops only" currently leaves on screen, so this
   * never lands on a turn that's hidden right now. */
  onNavigate: (direction: "prev" | "next") => void;
  /** Saves this row's own draft (same as Update) and inserts a brand
   * new blank waypoint immediately after it, opening *that* row's own
   * editor in its place - the same "Insert Here" AddStepButton already
   * does between two rows in the list behind this popup, reachable
   * without closing this one first. Lets an admin who's mid-edit and
   * realizes a stop or turn is missing right after this one (most often
   * a direction - "oh, there's a turn between this stop and the next")
   * add it in context, rather than closing this editor, scrolling to
   * find the right gap in the list, and reopening. */
  onAddWaypointAfter: () => void;
  /** True only for EditRouteScreen's own quickEdit sessions (StepScreen's
   * Edit/Add buttons) - hides the Delete button entirely rather than
   * threading a quickEdit-aware branch into onDelete itself, since
   * deleting a waypoint was never part of what those buttons offered
   * ("update or insert," not remove) and this popup has no Waypoints
   * list behind it for a delete to sensibly land back on anyway. */
  hideDelete?: boolean;
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

  // Same by-name match as matchedSchool above, against the address
  // book's own saved locations (the depot, a driver's home address,
  // anywhere else picked from AddressBookIcon's own popup below)
  // instead of the schools table - same "reads as linked to a real
  // entity, not just typed text" treatment either way.
  const matchedSavedLocation = useMemo(() => {
    const target = row.location.trim().toLowerCase();
    if (!target) return null;
    return (
      savedLocations.find(
        (loc) => loc.name.trim().toLowerCase() === target,
      ) ?? null
    );
  }, [row.location, savedLocations]);

  // The Location field's own <datalist> options - every already-
  // geocoded location (locationSuggestions, fetched once by
  // EditRouteScreen) plus every School and SavedLocation name outright,
  // so picking one of those from the datalist fills Location with the
  // exact text matchedSchool/matchedSavedLocation above already know
  // how to recognize, turning straight into the linked-entity chip the
  // same tap through AddressBookIcon's own popup would have produced -
  // just a faster path to the same result for a name already memorized.
  const locationDatalistOptions = useMemo(() => {
    const names = new Set(locationSuggestions);
    for (const name of Object.keys(schools)) names.add(name);
    for (const loc of savedLocations) names.add(loc.name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [locationSuggestions, schools, savedLocations]);

  // A plain address (a house number out front) or a matched school/
  // saved location (see above) each name one specific point on their
  // own - neither has a "from road" concept the way an intersection
  // does, so the From field below stays hidden for either rather than
  // asking for context that wouldn't mean anything.
  const isPlainLocation =
    /^\d/.test(row.location.trim()) ||
    matchedSchool !== null ||
    matchedSavedLocation !== null;

  // The address-book popup (AddressBookIcon, beside Location below) -
  // local to this one row's editor, not lifted to EditRouteScreen,
  // since only one row's own editor is ever open at a time.
  const [showLocationPicker, setShowLocationPicker] = useState(false);

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

  // The "View Error" popup for this row's own unresolved status
  // (status.raw below) - its own on/off state, same reasoning as
  // showPlaceModal above.
  const [showRowErrorDetail, setShowRowErrorDetail] = useState(false);

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
  // not only after Update commits.
  const instructionParts = formatWaypointInstructionParts(
    row,
    stopNumber,
    isPlainLocation ? "" : row.fromLocation || previousRoad || "",
  );
  // The waypoint's own real name(s) read in bold black - the thing
  // actually worth a glance - while the connecting word joining it to
  // the label ("at"/"onto"/"&"...) stays gray and not bold, just
  // grammar holding the two names together. An intersection's own
  // location ("X & Y") always breaks right after the "&" rather than
  // wherever it happens to wrap on its own, so the two road names never
  // read as one run-on line.
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
      <span>
        <span className="font-bold text-zinc-900">
          {instructionParts.label}
        </span>
        {instructionParts.connector && instructionParts.location && (
          <>
            {" "}
            <span className="font-normal text-zinc-500">
              {instructionParts.connector}
            </span>{" "}
            {instructionParts.location.includes(" & ") ? (
              (() => {
                const [fromRoad, toRoad] =
                  instructionParts.location!.split(" & ");
                return (
                  <>
                    <span className="font-bold text-zinc-900">
                      {fromRoad}
                    </span>{" "}
                    <span className="font-normal text-zinc-500">&</span>
                    <br />
                    <span className="font-bold text-zinc-900">{toRoad}</span>
                  </>
                );
              })()
            ) : (
              <span className="font-bold text-zinc-900">
                {instructionParts.location}
              </span>
            )}
          </>
        )}
      </span>
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

  // This row's own best-known point right now - a manually typed
  // coordinate wins over an already-resolved one, which wins over the
  // nearest-neighbor guess, which falls back to a fixed default -
  // shared between PlaceCoordinatesModal's own opening center (below)
  // and WaypointPreviewMap's highlighted pin, so both agree on where
  // "this row" actually is.
  const previewCenter =
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
    };

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
          <div className="min-w-0 flex-1">
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
                  {isNew ? "Add Waypoint" : "Edit Waypoint"}
                </h2>
                {/* Same icon the collapsed StepRowView row above shows for
                  this same stop/turn (live off `isStop`/`turnDirection` -
                  the draft's own Type select, not a snapshot from when
                  this editor opened), paired with the exact instruction
                  this row now produces ("Stop 1 at Lake Forest Dr &
                  Davids Way," "Left onto Main Street") instead of just
                  its own type/number - both update immediately as Type/
                  destination change, not only after Update commits.
                  items-start (not -center) - the icon floats against the
                  top of the first line only, not the vertical center of
                  the whole (now possibly two-line, see
                  formatWaypointInstructionParts' own "&" split above)
                  block. leading-[1.125] - roughly three-quarters of the
                  1.5 line-height this paragraph would otherwise inherit,
                  tight enough that two short road names read as one
                  compact label instead of two loosely-spaced lines. */}
                <p className="mt-0.5 flex items-start gap-1.5 text-sm leading-[1.125]">
                  {instructionLine}
                </p>
              </>
            )}
          </div>
          {!showPlaceModal && (
            <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onNavigate("prev")}
                  disabled={!canGoPrev}
                  aria-label="Previous waypoint"
                  className={`flex h-6 w-6 items-center justify-center rounded disabled:opacity-30 ${
                    canGoPrev
                      ? "text-blue-600 active:bg-blue-50 active:text-blue-800"
                      : "text-zinc-400"
                  }`}
                >
                  <BackArrowIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate("next")}
                  disabled={!canGoNext}
                  aria-label="Next waypoint"
                  className={`flex h-6 w-6 items-center justify-center rounded disabled:opacity-30 ${
                    canGoNext
                      ? "text-blue-600 active:bg-blue-50 active:text-blue-800"
                      : "text-zinc-400"
                  }`}
                >
                  <RightArrowIcon className="h-4 w-4" />
                </button>
              </div>
              {/* Same round plus button AddStepButton draws between two
                  rows in the list behind this popup - inserts a blank
                  waypoint right after this one and opens its own editor
                  in place, without closing this one first. Under the
                  arrows (not beside them) so it reads as "add a new
                  waypoint after this one," not a third navigation
                  direction alongside prev/next. */}
              <button
                type="button"
                onClick={onAddWaypointAfter}
                aria-label="Insert a new waypoint after this one"
                className="btn-glossy-light flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
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
            initialCenter={previewCenter}
            routeContext={routeContext}
            onCancel={() => setShowPlaceModal(false)}
            onSetCoordinates={(lat, lon) => {
              onManualCoordinates(lat, lon);
              setShowPlaceModal(false);
            }}
          />
        ) : (
          <>
            <div className="mt-3 grid grid-cols-[3fr_2fr_3fr] gap-2">
              <Field label="Type" required>
                <select
                  className={inputClass}
                  // Falls back to "" (the "- Select -" option below)
                  // rather than passing an unrecognized row.action
                  // straight through as this select's own value - an
                  // imported row with a blank or misspelled action cell
                  // would otherwise leave no option actually selected,
                  // which a browser renders as if "Stop" (the first
                  // real option) were picked instead. The original
                  // value stays in `row` either way until an admin
                  // actually changes this select - only changing what's
                  // *shown*, not what's saved.
                  value={canonicalWaypointType(row.action) ?? ""}
                  onChange={(e) => handleTypeChange(e.target.value)}
                >
                  <option value="">- Select -</option>
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
                    <option value="">-</option>
                    <option value="Left">Left</option>
                    <option value="Right">Right</option>
                  </select>
                </Field>
              ) : (
                <span />
              )}
              {/* Beside the Type dropdown rather than down with Location
              below - reads in real driving order ("from Main St, onto
              Elm St") right next to the action it's context for, and
              doubles as this row's only escape hatch for fixing a bad
              inference or an explicit typo (e.g. 120-AM-HS.csv's real
              "David Way," which should be "Davids Way"). Hidden for a
              plain address or a matched school (see isPlainLocation
              above) - neither is part of an intersection, so there's no
              "from" road to name. */}
              {!isPlainLocation ? (
                <Field label="From">
                  <input
                    className={inputClass}
                    value={row.fromLocation}
                    onChange={(e) => onChange({ fromLocation: e.target.value })}
                    placeholder={previousRoad || "start of route"}
                  />
                </Field>
              ) : (
                <span />
              )}
            </div>

            <div className="mt-2 flex flex-col gap-2">
              <Field label="Location" required>
                <div className="flex items-center gap-2">
                  {/* A matched school/saved location (see both above)
                  renders as a chip nested in the text box instead of a
                  plain typed string - reads as one linked entity, the
                  way a resolved recipient chip does in an email
                  client's own To field, not just a text string a
                  geocoder has to guess at. The X clears it back to a
                  blank, freely-typed box; picking a *different* preset
                  (the address-book button, right) just overwrites it
                  directly, no need to clear first. */}
                  {matchedSchool || matchedSavedLocation ? (
                    <MatchedLocationChip
                      name={matchedSchool?.name ?? matchedSavedLocation?.name ?? ""}
                      onClear={() => onChange({ location: "" })}
                      clearLabel="Clear location"
                    />
                  ) : (
                    <>
                      <input
                        className={`min-w-0 flex-1 ${inputClass} ${
                          status?.status === "unresolved"
                            ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                            : ""
                        }`}
                        value={row.location}
                        onChange={(e) => onLocationChange(e.target.value)}
                        placeholder={
                          isSchoolAction
                            ? "LaVergne High School"
                            : /^\d/.test(row.location)
                              ? "123 Maple Dr"
                              : "Elm St"
                        }
                        list="location-suggestions"
                      />
                      {/* A plain browser-native <datalist>, not a real
                          autocomplete component - locationDatalistOptions
                          is every location this app already knows about
                          (see its own doc comment just above: already-
                          geocoded addresses/roads plus every School and
                          SavedLocation name outright), so typing "Oak"
                          here can suggest "Oak Ave" back exactly as it
                          resolved before, without a live map/geocoder
                          search. Still a free-typed field either way -
                          picking a suggestion or ignoring it entirely
                          both just set `value` above. */}
                      <datalist id="location-suggestions">
                        {locationDatalistOptions.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowLocationPicker(true)}
                    aria-label="Choose from address book"
                    className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
                  >
                    <AddressBookIcon className="h-4 w-4" />
                  </button>
                </div>
              </Field>
              {/* A location that matches a known school or saved location
            by name - typed by hand, or picked from the address book
            above - reads as linked to that real entity, not just a
            text string a geocoder has to guess at: its actual street
            address shows right underneath as confirmation. */}
              {(matchedSchool || matchedSavedLocation) && (
                <p className="-mt-1 flex items-center gap-1 text-xs text-zinc-500">
                  <MapPinIcon className="h-3 w-3 shrink-0 text-blue-500" />
                  {matchedSchool?.info.address ?? matchedSavedLocation?.address}
                </p>
              )}
            </div>
            {showLocationPicker && (
              <LocationPickerModal
                schools={schools}
                savedLocations={savedLocations}
                onSaveSavedLocation={onSaveSavedLocation}
                onFetchCoordinates={onFetchSavedLocationCoords}
                onSelect={(choice) => {
                  onChange({ location: choice.name });
                  if (choice.lat != null && choice.lon != null) {
                    onManualCoordinates(choice.lat, choice.lon);
                  }
                  setShowLocationPicker(false);
                }}
                onClose={() => setShowLocationPicker(false)}
              />
            )}

            {/* Above the coordinates box, not below it - checking this
            is the thing that makes that box irrelevant (see the
            coordsText-blanking onChange below), so it reads as the
            gate for what follows rather than an afterthought under it. */}
            <label className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={row.skip}
                onChange={(e) => {
                  const checked = e.target.checked;
                  onChange({ skip: checked });
                  // Reads as "no location coordinates" the moment it's
                  // checked, not just once Save clears them server-side -
                  // deriveWaypoints.ts already ignores a skipped row's
                  // coordinates entirely, so this only changes what the
                  // box itself displays.
                  if (checked) setCoordsText("");
                }}
                className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
              />
              Instructions only - no location coordinates
            </label>

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
                  <span>
                    {status.reason}
                    {status.raw && (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={() => setShowRowErrorDetail(true)}
                          className="font-semibold underline underline-offset-2"
                        >
                          View Error
                        </button>
                      </>
                    )}
                  </span>
                </p>
              ) : status?.status === "resolved" ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-green-600">
                  <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
                  Verified coordinates
                </p>
              ) : null}
            </div>

            {/* Riders only really means anything for a stop (a turn has
          no one boarding/leaving at it) - live off `isStop` above, so
          switching Type away from Stop drops it entirely, right along
          with the column that held it, rather than leaving a disabled
          field with nothing left to say. Notes then reclaims the full
          row instead of sharing it with a field that isn't shown. */}
            <div
              className={`mt-2 grid gap-2 ${isStop ? "grid-cols-[1fr_6.5rem]" : "grid-cols-1"}`}
            >
              <Field label="Driver Notes">
                <input
                  className={inputClass}
                  value={row.notes}
                  onChange={(e) => onChange({ notes: e.target.value })}
                />
              </Field>
              {isStop && (
                <Field
                  label={
                    <span className="inline-flex items-center gap-1">
                      <PersonSolidIcon className="h-3.5 w-3.5" />
                      Riders
                    </span>
                  }
                >
                  <select
                    className={inputClass}
                    value={row.riderCount}
                    onChange={(e) => onChange({ riderCount: e.target.value })}
                  >
                    <option value="">—</option>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            {/* Street-level context for this row's own point - the
          route's own road-following line plus every other resolved
          Stop, so an admin can sanity-check a fetched or manually
          typed coordinate against its real neighbors without leaving
          this card. Scroll/drag/pinch freely to look around -
          PlaceCoordinatesModal above is still the one place to
          actually change this row's point. Navigating to a different
          row via the prev/next arrows flies the camera to the new
          row's own point instead of jumping straight there (see
          WaypointPreviewMap's own doc comment) - tapping a stop's own
          dot directly does the same thing, straight to that stop. */}
            <WaypointPreviewMap
              center={previewCenter}
              centerStopNumber={stopNumber}
              centerIsTurn={!isStop}
              routeLine={routeContext}
              stopPins={stopPins}
              onClickPin={onClickWaypointPin}
            />

            <div className="mt-3 flex items-center gap-2">
              {!hideDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label="Delete step"
                  className="btn-glossy-red flex shrink-0 items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
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
      {showRowErrorDetail && status?.status === "unresolved" && (
        <ErrorDetailsModal
          message={status.detail ?? status.reason}
          raw={status.raw}
          onClose={() => setShowRowErrorDetail(false)}
        />
      )}
    </div>
  );
}

/** A slim "insert a step here" control - shown before the first row
 * and after every row below (not just once at the bottom), so a new
 * stop or turn can be dropped in anywhere along the route's real
 * order, not only appended past the last one. Disabled while a
 * different row's own editor is open, same as every other action here
 * that would move rows out from under it.
 *
 * Also doubles as the drag-and-drop landing indicator while `dragging`
 * (some row is actively being dragged) - the tappable "+" button
 * swaps for a plain, non-interactive box (tapping "add" mid-drag isn't
 * a real gesture), and whichever gap is the current `dropTarget` shows
 * a solid blue line overlaying the same dashed divider - not a wider
 * or taller box, and not a border added to a neighboring row (that
 * shifted the whole list's layout by its own border-width every time a
 * drag crossed into a new gap) - so nothing about the list's size
 * changes as the drag moves between gaps, resting or dragging. */
function AddStepButton({
  onClick,
  disabled,
  dragging,
  dropTarget,
  onSplit,
}: {
  onClick: () => void;
  disabled: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  /** Opens SplitRouteModal for this exact gap - omitted for the very
   * first gap (before row 0) and the very last (after the final row),
   * where "split" would just mean "the whole route" on one side and
   * nothing on the other. Only ever passed on an internal gap, between
   * two real rows. */
  onSplit?: () => void;
}) {
  if (dragging) {
    return (
      <div className="relative flex items-center justify-center py-1">
        <div
          className={
            dropTarget
              ? "absolute inset-x-0 border-t-2 border-blue-500"
              : "absolute inset-x-0 border-t border-dashed border-zinc-300"
          }
        />
        {dropTarget && (
          <span className="relative z-10 rounded bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            Drop Here
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center py-1">
      <div className="absolute inset-x-0 border-t border-dashed border-zinc-300" />
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Add step here"
        className="btn-glossy-light relative z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900 disabled:opacity-30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </button>
      {onSplit && (
        <>
          {/* Plain blue links, not button-styled boxes like Add/the
              rest of this screen - split and (eventually) Autoroute are
              both secondary, occasional actions on this one dashed
              line, not something that needs to visually compete with
              it the way the always-relevant Add button does. Left/right
              of Add respectively, so a future Autoroute (compass, right)
              reads as the equal-and-opposite counterpart to Split
              (scissors, left) rather than crowding the same side. */}
          <button
            type="button"
            onClick={onSplit}
            disabled={disabled}
            aria-label="Split route here"
            className="absolute left-0 z-10 flex h-6 w-6 items-center justify-center text-blue-600 active:opacity-70 disabled:opacity-30"
          >
            {/* The source art is a right-pointing (open) pair of blades -
                unmirrored now that this sits on the left edge, so it
                still reads as "cutting into" the line from its own
                side (see CompassIcon just below for the mirror-image
                case, on the right). */}
            <ScissorsIcon className="h-3.5 w-3.5" />
          </button>
          {/* Autoroute itself isn't wired up yet (see the README's own
              roadmap) - this is only here as a preview of where it'll
              live, not a real control yet, so it deliberately has no
              onClick of its own. */}
          <button
            type="button"
            disabled={disabled}
            aria-label="Autoroute (coming soon)"
            className="absolute right-0 z-10 flex h-6 w-6 items-center justify-center text-blue-600 active:opacity-70 disabled:opacity-30"
          >
            <CompassIcon className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Opened by AddStepButton's own scissors icon (an internal gap only -
 * see its own doc comment) - offers to carve the waypoints on either
 * side of that exact gap off into a brand-new route, rather than
 * retyping a whole second route by hand for what's really the same
 * stops, just riding two buses instead of one (or, per the driver-
 * substitution use case this was actually built for, separating a
 * depot/home leg into its own linkable route - see EditRouteScreen's
 * own Next Action field). Two steps, not one: which side of the gap
 * first (`direction`, this component's own local state), then Move or
 * Copy for that side - a real fork in what happens to *this* route,
 * not a detail worth burying in the first step's own button label.
 * `onSplit` hands both choices up to EditRouteScreen's own handleSplit,
 * which does the actual work; `saving`/`error` reflect Move's own save
 * of the shortened original back to the caller, so this step 2 can
 * disable its buttons and show why a Move failed without losing the
 * admin's place in the flow.
 */
function SplitRouteModal({
  aboveCount,
  belowCount,
  saving,
  error,
  onSplit,
  onClose,
}: {
  aboveCount: number;
  belowCount: number;
  saving: boolean;
  error: string | null;
  onSplit: (direction: "above" | "below", action: "move" | "copy") => void;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<"above" | "below" | null>(null);
  const count = direction === "above" ? aboveCount : belowCount;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-6"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="animate-popup-pop w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-center shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading text-xl font-black tracking-tight">
          Split Route
        </h2>
        {direction === null ? (
          <>
            <p className="mt-2 text-sm text-zinc-500">
              Carve the waypoints on one side of this split off into a
              brand-new route.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setDirection("above")}
                disabled={aboveCount === 0}
                className="btn-glossy-blue font-heading flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                <ArrowUpToLineIcon className="h-4 w-4" />
                Split Above to New Route
                <span className="font-normal opacity-80">({aboveCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setDirection("below")}
                disabled={belowCount === 0}
                className="btn-glossy-blue font-heading flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                <ArrowDownToLineIcon className="h-4 w-4" />
                Split Below to New Route
                <span className="font-normal opacity-80">({belowCount})</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-glossy-light font-heading rounded-xl bg-zinc-300 py-3 text-sm font-semibold text-zinc-900"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-500">
              Splitting {count} waypoint{count === 1 ? "" : "s"} into a
              separate route. Do you want to remove them from this route, or
              keep them and just make a copy?
            </p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onSplit(direction, "move")}
                disabled={saving}
                className="btn-glossy-blue font-heading rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {saving ? "Moving…" : "Move"}
              </button>
              <button
                type="button"
                onClick={() => onSplit(direction, "copy")}
                disabled={saving}
                className="btn-glossy-blue font-heading rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="btn-glossy-light font-heading rounded-xl bg-zinc-300 py-3 text-sm font-semibold text-zinc-900 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Human-readable copy for each FallbackDetail kind (resolveWaypoint.ts)
 * - GeocodeConfirmModal's own explanation of what actually happened,
 * distinct enough that an admin can tell a corrected typo apart from a
 * same-road approximation without reading the raw `kind` value. */
function fallbackExplanation(fallback: FallbackDetail): string {
  switch (fallback.kind) {
    case "street-type":
      return `No exact match, but a nearby road with a different street type looks like the same one: "${fallback.correctedQuery}".`;
    case "fuzzy-name":
      return `No exact match, but a nearby road with a similar spelling looks like the same one: "${fallback.correctedQuery}".`;
    case "loop-snap":
      return `These two roads don't meet as a simple intersection here (often a loop or circle) - placed on "${fallback.correctedQuery}" instead, at the point closest to this route. Not a real crossing - only an approximation.`;
  }
}

/**
 * Opened by fetchLocation's own single-row Fetch (globe button) when
 * the plain exact lookup failed but a fallback strategy
 * (resolveWaypoint.ts's own lookupCoordinatesWithFallback) found
 * something - street-type/spelling correction, or a same-road
 * "loop-snap" placement neither of which is a lookup an admin should
 * ever have saved silently. Shows what was originally searched, what
 * was actually found and why, and the same street-level
 * WaypointPreviewMap every row's own expanded editor already uses (this
 * route's own road-following line, every other resolved Stop) centered
 * on the proposed point - Accept persists it exactly like a plain
 * match always has, Reject leaves the row exactly as unresolved as it
 * was before this Fetch ran.
 */
function GeocodeConfirmModal({
  originalLabel,
  entry,
  fallback,
  routeLine,
  stopPins,
  onAccept,
  onReject,
}: {
  originalLabel: string;
  entry: Extract<WaypointCacheEntry, { status: "ok" }>;
  fallback: FallbackDetail;
  routeLine: { lat: number; lon: number }[];
  stopPins: StopPin[];
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-6"
      onClick={onReject}
    >
      <div
        className="animate-popup-pop flex max-h-[85dvh] w-full max-w-sm flex-col overflow-y-auto rounded-xl bg-[var(--background)] p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading text-xl font-black tracking-tight">
          Confirm Match
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          Searched for <span className="font-semibold text-zinc-900">{originalLabel}</span>.{" "}
          {fallbackExplanation(fallback)}
        </p>

        <div className="mt-3">
          <WaypointPreviewMap
            center={{ lat: entry.lat, lon: entry.lon }}
            centerStopNumber={null}
            centerIsTurn={false}
            routeLine={routeLine}
            stopPins={stopPins}
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onReject}
            className="btn-glossy-light font-heading flex-1 rounded-xl bg-zinc-300 py-3 text-sm font-semibold text-zinc-900"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="btn-glossy-blue font-heading flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/** StepRowEditor's own "choose a known place" popup (AddressBookIcon,
 * beside the Location field) - two lists, schools and saved locations
 * (the depot, a driver's home address, anywhere else worth reusing by
 * name instead of retyping - see prisma/schema.prisma's own
 * SavedLocation doc comment). Picking either one hands its exact name
 * and cached lat/lon (if it has one) back to `onSelect` - StepRowEditor
 * fills Location with the name and, when a coordinate came with it,
 * resolves this row immediately (onManualCoordinates) rather than
 * waiting on a fresh geocode. Same modal shell as StopsFormatModal
 * below (full-screen dim, centered card, backdrop tap or the corner X
 * to close) - a search box up top filters both lists together, and a
 * "+ Add Location" row under Other Locations opens a small inline
 * name/address form instead of a whole separate screen, since creating
 * one is rare enough not to need its own destination. z-30, one above
 * every other card here (z-20) - opened from on top of StepRowEditor's
 * own modal card, not instead of it. */
function LocationPickerModal({
  schools,
  savedLocations,
  onSelect,
  onSaveSavedLocation,
  onFetchCoordinates,
  onClose,
}: {
  schools: Record<string, SchoolInfo>;
  savedLocations: SavedLocationInfo[];
  onSelect: (choice: { name: string; lat: number | null; lon: number | null }) => void;
  /** Creates (`id: null`) or updates (`id` set) a saved location -
   * EditSavedLocationModal's own Save button, opened either from the
   * "+ Add Location" footer button below or a saved location's own
   * pencil icon. POSTs/PATCHes /api/saved-locations, geocoding
   * happens client-side first (see onFetchCoordinates) so this only
   * ever persists whatever's already in that modal's own coordinates
   * box - same split StepRowEditor's own onManualCoordinates uses. */
  onSaveSavedLocation: (
    id: number | null,
    name: string,
    address: string,
    lat: number | null,
    lon: number | null,
  ) => Promise<SavedLocationInfo | { error: string }>;
  /** A preview-only geocode for EditSavedLocationModal's own Fetch
   * button - resolves an address without persisting anything, so the
   * admin can see/adjust the result before Save actually runs. */
  onFetchCoordinates: (
    address: string,
  ) => Promise<{ lat: number; lon: number } | { error: string }>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // "new" opens EditSavedLocationModal in create mode (the old inline
  // Name/Address form, now the same full popup editing uses); a real
  // record opens it in edit mode. Either way it's a separate modal
  // stacked on top of this one, not inline content that had to fit in
  // the scrollable list area below.
  const [editingLocation, setEditingLocation] = useState<
    SavedLocationInfo | "new" | null
  >(null);

  const q = query.trim().toLowerCase();
  const schoolEntries = Object.entries(schools)
    .filter(([name]) => !q || name.toLowerCase().includes(q))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const savedEntries = savedLocations
    .filter((loc) => !q || loc.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="animate-popup-pop flex max-h-[85dvh] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-[var(--background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="font-heading flex items-center gap-1.5 text-xl font-black tracking-tight">
            <AddressBookIcon className="h-5 w-5 text-zinc-400" />
            Address Book
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

        <div className="shrink-0 border-b border-zinc-200 px-5 py-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pr-3 pl-9 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* The only scrolling region in this card - header and search
        above, "+ Add Location" below, are both shrink-0 so they stay
        on screen no matter how long either list gets, instead of the
        whole card growing past the viewport the way it used to. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 text-left">
          <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Schools
          </p>
          <div className="mt-1 flex flex-col divide-y divide-zinc-100">
            {schoolEntries.length === 0 && (
              <p className="py-2 text-sm text-zinc-400 italic">No matches</p>
            )}
            {schoolEntries.map(([name, info]) => (
              <button
                key={name}
                type="button"
                onClick={() => onSelect({ name, lat: info.lat, lon: info.lon })}
                className="flex items-center gap-2 py-2 text-left active:bg-zinc-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {name}
                  </p>
                  <p className="truncate text-xs text-zinc-500">{info.address}</p>
                </div>
                {info.lat != null ? (
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-600" />
                ) : (
                  <XCircleIcon className="h-4 w-4 shrink-0 text-red-500" />
                )}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Other Locations
          </p>
          <div className="mt-1 flex flex-col divide-y divide-zinc-100">
            {savedEntries.length === 0 && (
              <p className="py-2 text-sm text-zinc-400 italic">No matches</p>
            )}
            {savedEntries.map((loc) => (
              // Two sibling buttons, not a button nested inside a
              // button (invalid HTML, and it made the pencil tap also
              // fire onSelect underneath it) - the row itself is a div,
              // "select this location" and "edit this location" are two
              // independent tap targets side by side.
              <div key={loc.id} className="flex items-center gap-1 py-2">
                <button
                  type="button"
                  onClick={() =>
                    onSelect({ name: loc.name, lat: loc.lat, lon: loc.lon })
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-left active:bg-zinc-100"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      {loc.name}
                    </p>
                    <p className="truncate text-xs text-zinc-500">{loc.address}</p>
                  </div>
                  {loc.lat != null ? (
                    <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <XCircleIcon className="h-4 w-4 shrink-0 text-red-500" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLocation(loc)}
                  aria-label={`Edit ${loc.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 active:bg-zinc-100 active:text-zinc-600"
                >
                  <EditIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-200 px-5 py-3">
          <button
            type="button"
            onClick={() => setEditingLocation("new")}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 py-2 text-sm font-semibold text-blue-600 active:bg-zinc-100"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add Location
          </button>
        </div>
      </div>

      {editingLocation && (
        <EditSavedLocationModal
          location={editingLocation === "new" ? null : editingLocation}
          onFetchCoordinates={onFetchCoordinates}
          onSave={onSaveSavedLocation}
          onSaved={(saved) => {
            setEditingLocation(null);
            // Adding a brand-new location from this popup still fills
            // the waypoint row with it, same as picking an existing one
            // from the list above always has - editing an existing
            // entry in place, though, is just a correction, not a pick,
            // so it only updates the list underneath rather than also
            // closing this whole popup out from under the admin.
            if (editingLocation === "new") {
              onSelect({ name: saved.name, lat: saved.lat, lon: saved.lon });
            }
          }}
          onClose={() => setEditingLocation(null)}
        />
      )}
    </div>
  );
}

/** A saved location's own full editor - "Add Location" (from the
 * address book's footer button, `location: null`) and "Edit Location"
 * (from a saved location's own pencil icon) are the same form either
 * way, just seeded differently. Deliberately its own separate popup
 * layered on top of LocationPickerModal (z-40, one above that card's
 * own z-30) rather than folded into StepRowEditor's Edit Waypoint card
 * the way the old inline add-form was - a saved location isn't a
 * waypoint, and StepRowEditor's card is busy enough already. Shares
 * the same Latitude/Longitude box shape (manual text entry, a Fetch/
 * globe button, a Place/map-pin button opening PlaceCoordinatesModal)
 * StepRowEditor's own coordinates field uses, down to the same input
 * classes and status-line copy, so resolving a saved location's point
 * feels identical to resolving a waypoint's. */
function EditSavedLocationModal({
  location,
  onFetchCoordinates,
  onSave,
  onSaved,
  onClose,
}: {
  location: SavedLocationInfo | null;
  onFetchCoordinates: (
    address: string,
  ) => Promise<{ lat: number; lon: number } | { error: string }>;
  onSave: (
    id: number | null,
    name: string,
    address: string,
    lat: number | null,
    lon: number | null,
  ) => Promise<SavedLocationInfo | { error: string }>;
  /** Fires only once Save actually succeeds, with the saved record -
   * LocationPickerModal's own call site decides from there whether
   * that also means picking it into the waypoint row (a brand-new
   * location) or just refreshing the list (an edit). */
  onSaved: (saved: SavedLocationInfo) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [coordsText, setCoordsText] = useState(
    location?.lat != null && location?.lon != null
      ? `${location.lat}, ${location.lon}`
      : "",
  );
  const hasCoordsText = coordsText.trim() !== "";
  const manualCoords = useMemo(() => parseLatLon(coordsText), [coordsText]);

  const [showPlaceModal, setShowPlaceModal] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleFetch() {
    if (!address.trim() || fetching) return;
    setFetching(true);
    setFetchError(null);
    const result = await onFetchCoordinates(address.trim());
    setFetching(false);
    if ("error" in result) {
      setFetchError(result.error);
      return;
    }
    setCoordsText(`${result.lat}, ${result.lon}`);
  }

  async function handleSave() {
    if (!name.trim() || !address.trim() || saving) return;
    if (hasCoordsText && !manualCoords) return; // the box below already shows why
    setSaving(true);
    setSaveError(null);
    const result = await onSave(
      location?.id ?? null,
      name.trim(),
      address.trim(),
      manualCoords ? manualCoords[0] : null,
      manualCoords ? manualCoords[1] : null,
    );
    setSaving(false);
    if ("error" in result) {
      setSaveError(result.error);
      return;
    }
    onSaved(result);
  }

  const previewCenter = manualCoords
    ? { lat: manualCoords[0], lon: manualCoords[1] }
    : { lat: LA_VERGNE_CENTER[0], lon: LA_VERGNE_CENTER[1] };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="animate-popup-pop flex max-h-[85dvh] w-full max-w-sm flex-col overflow-y-auto rounded-xl bg-[var(--background)] p-5 text-left shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-heading text-xl font-black tracking-tight">
            {showPlaceModal
              ? "Place Coordinates"
              : location
                ? "Edit Location"
                : "Add Location"}
          </h2>
          <button
            type="button"
            onClick={showPlaceModal ? () => setShowPlaceModal(false) : onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {showPlaceModal ? (
          <PlaceCoordinatesModal
            initialCenter={previewCenter}
            routeContext={[]}
            onCancel={() => setShowPlaceModal(false)}
            onSetCoordinates={(lat, lon) => {
              setCoordsText(`${lat}, ${lon}`);
              setShowPlaceModal(false);
            }}
          />
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-2">
              <Field label="Name" required={!name.trim()}>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Bus Depot"
                />
              </Field>
              <Field label="Address" required={!address.trim()}>
                <input
                  className={inputClass}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="1425 Lake Forest Dr, Smyrna, TN 37167"
                />
              </Field>

              <Field label="Latitude, longitude">
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputClass} flex-1 font-mono ${
                      hasCoordsText && !manualCoords
                        ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                        : manualCoords
                          ? "border-green-400 focus:border-green-500 focus:ring-green-500"
                          : ""
                    }`}
                    value={coordsText}
                    onChange={(e) => setCoordsText(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleFetch}
                    disabled={fetching || !address.trim()}
                    aria-label="Fetch coordinates for this address"
                    className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900 disabled:opacity-50"
                  >
                    {fetching ? (
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <GlobeIcon className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPlaceModal(true)}
                    aria-label="Manually place coordinates on a map"
                    className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
                  >
                    <MapPinIcon className="h-4 w-4" />
                  </button>
                </div>
              </Field>
              {hasCoordsText && !manualCoords ? (
                <p className="-mt-1 flex items-start gap-1 text-xs text-red-600">
                  <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Enter latitude and longitude, separated by a space, comma,
                    or tab.
                  </span>
                </p>
              ) : manualCoords ? (
                <p className="-mt-1 flex items-center gap-1 text-xs text-green-600">
                  <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
                  Verified coordinates
                </p>
              ) : null}
              {fetchError && <p className="text-xs text-red-600">{fetchError}</p>}
              {saveError && <p className="text-xs text-red-600">{saveError}</p>}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="btn-glossy-light shrink-0 rounded-lg bg-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={
                  saving ||
                  !name.trim() ||
                  !address.trim() ||
                  (hasCoordsText && !manualCoords)
                }
                className="btn-glossy-blue shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
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

/** A thin at-a-glance ratio of resolved vs. not - a solid red track
 * with a green fill scaled to `percent`, so it reads correctly (a
 * sliver of green, mostly red) well before anyone reads the count
 * next to it. The fill itself stays the same green the whole way -
 * only its width grows - rather than shifting hue with progress, so
 * it never reads as "still red/orange, not really done yet" partway
 * through. Styled like the app's own glossy buttons (the same white
 * sheen highlight) but with an inset shadow instead of a raised one,
 * so it reads as a groove the fill sits inside rather than another
 * button. */
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
        className="h-full rounded-full bg-green-600 transition-[width]"
        style={{ width: `${percent}%` }}
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
  initialStepsText,
  seedMeta,
  initialWaypointCache,
  schools,
  initialSubScreen,
  justCreated,
  onSplitToNewRoute,
  onCancel,
  onSave,
  quickEdit,
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
  /** `mode: "add"` only - seeds the paste box itself (`stepsText`)
   * rather than `rows`/`initialSteps` above, since `mode: "add"` reads
   * its rows straight from that text (see `currentRows`), never from
   * `rows` state. Set only by the split-to-new-route flow
   * (page.tsx's own "add-route" screen kind, `initialStepsText`) -
   * already in the exact format parseRouteImport reads, so this just
   * needs to land in the box, not be parsed or validated again here. */
  initialStepsText?: string;
  /** `mode: "add"` only - a starting School/Trip for the new route,
   * from whichever route it was split off of (page.tsx's own
   * "add-route" screen kind, `seedMeta`). Omitted for the ordinary
   * "New Route" link, which leaves both genuinely unset the way it
   * always has. */
  seedMeta?: { schoolName: string; tripType: TripType | ""; routeNumber?: string };
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
  /** `mode: "edit"` only - opens straight to the Stops and Turns screen
   * instead of the hub, for a caller (StartScreen's own View Stops
   * popup, via its pencil-to-Edit-Waypoints button) that already knows
   * an admin wants that screen specifically, not the hub they'd
   * otherwise have to tap "Edit Waypoints" from. Defaults to "hub" -
   * every other caller still opens where it always has. */
  initialSubScreen?: "hub" | "stops";
  /** `mode: "edit"` only - this instance is the very first time this
   * route is being shown, straight off a brand-new Save (page.tsx's own
   * handleSaveRoute, called with its `justCreated` argument true) -
   * shows a one-time "New Route Created!" confirmation on the hub
   * screen instead of landing there with no acknowledgment that the
   * Save actually did anything. */
  justCreated?: boolean;
  /** `mode: "edit"` only - opens a brand-new "add-route" screen already
   * pasted with the waypoints on one side of a split (the Stops and
   * Turns list's own scissors icon, between two waypoints), plus this
   * route's own School/Trip as a starting point. `stepsText` is already
   * in the exact paste-box format that screen's own import parser
   * reads (see serializeRouteImport) - page.tsx only needs to seed it
   * in, not parse or validate anything itself. Omitted entirely for
   * `mode: "add"`, which has no existing rows of its own to split. */
  onSplitToNewRoute?: (
    stepsText: string,
    seedMeta: { schoolName: string; tripType: TripType | ""; routeNumber?: string },
  ) => void;
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
   * closes. `previousId` is this same route's id *before* this save
   * (see handleSave's own doc comment) - null unless this was an
   * "edit" of an already-existing route whose own routeNumber/
   * tripType/schoolLevel changed enough to change Route.id itself
   * (a Special route's own free-typed name doubles as routeNumber, so
   * a plain rename hits this constantly, not just an edge case). The
   * caller needs this to know a rename happened, not a second route
   * appearing - see page.tsx's own handleSaveRoute. */
  onSave: (
    route: Route,
    steps: RawRouteRow[],
    cache: WaypointCache,
    previousId: string | null,
  ) => void;
  /** `mode: "edit"` only - a driver-screen "quick edit," opened via
   * StepScreen's own Edit/Add buttons on the current step (page.tsx's
   * own onEditWaypoint) instead of the normal RouteListScreen/
   * StartScreen entry points. Opens straight into `rowIndex`'s own
   * StepRowEditor popup (or, if `insertNewAfter`, a brand-new blank row
   * spliced in right after it) with nothing else - the hub, the
   * Waypoints list, prev/next, and Delete are all unreachable for the
   * whole session, not just hidden at first paint, since this exists
   * specifically to fix *this one waypoint* and hand control straight
   * back to the live trip, never to become a general editing session.
   * `onSaved`/`onCancelled` fire in place of the ordinary onSave/
   * onCancel above - see handleUpdateRow/handleCancelRow's own
   * quickEdit branches for exactly what "straight back" means (an
   * immediate real save, not just closing the popup back to a list
   * this session never shows). */
  quickEdit?: {
    rowIndex: number;
    insertNewAfter: boolean;
    onSaved: (
      route: Route,
      steps: RawRouteRow[],
      cache: WaypointCache,
      resumeAtStepIndex: number,
    ) => void;
    onCancelled: (resumeAtStepIndex: number) => void;
  };
}) {
  const [routeNumber, setRouteNumber] = useState(
    route?.routeNumber ?? seedMeta?.routeNumber ?? "",
  );
  const [busNumber, setBusNumber] = useState(route?.busNumber ?? "");
  // Every saved location (the address book's own "Other Locations"
  // list - StepRowEditor's own AddressBookIcon button, below, and this
  // form's own School field further down) - fetched once per edit
  // session, same "fetch on mount" shape page.tsx already uses for
  // schools. Declared up here (rather than alongside
  // handleSaveSavedLocation below) so the School field's own
  // matchedSavedLocation, right below, can read it.
  const [savedLocations, setSavedLocations] = useState<SavedLocationInfo[]>(
    [],
  );
  useEffect(() => {
    fetch("/api/saved-locations")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: SavedLocationInfo[]) => setSavedLocations(data))
      .catch(() => {});
  }, []);
  // Every location (street, business, anything) this app already has a
  // resolved coordinate for, anywhere in the district - fetched once
  // per edit session, same "fetch on mount" shape as savedLocations
  // just above. Feeds StepRowEditor's own Location field suggestions
  // alongside every School/SavedLocation name (a plain <datalist>, not
  // a live map search) - see /api/location-suggestions's own doc
  // comment.
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/location-suggestions")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: string[]) => setLocationSuggestions(data))
      .catch(() => {});
  }, []);
  // The route's own anchor - a free-typed name, matched by exact
  // name (case/whitespace-insensitive) against Schools first and
  // SavedLocations second, same as StepRowEditor's own matchedSchool/
  // matchedSavedLocation do for a single waypoint - never required to
  // resolve to either, since a Special route's own starting point (or
  // any route anchored on a saved location instead of a school) is a
  // genuinely valid, permanent state, not just "not looked up yet."
  const [schoolName, setSchoolName] = useState(
    route?.schoolName ?? seedMeta?.schoolName ?? "",
  );
  const matchedSchool = useMemo(() => {
    const target = schoolName.trim().toLowerCase();
    if (!target) return null;
    const entry = Object.entries(schools).find(
      ([name]) => name.trim().toLowerCase() === target,
    );
    return entry ? { name: entry[0], info: entry[1] } : null;
  }, [schoolName, schools]);
  const matchedSavedLocation = useMemo(() => {
    const target = schoolName.trim().toLowerCase();
    if (!target) return null;
    return (
      savedLocations.find((loc) => loc.name.trim().toLowerCase() === target) ??
      null
    );
  }, [schoolName, savedLocations]);
  // A route already being edited whose anchor doesn't match either
  // list (yet, or ever - a Special route's own one-off starting point
  // never will) keeps its own already-known address/level/point
  // instead of falling back to the generic placeholder/default -
  // typing or picking a *different*, matching name always overrides
  // this with that entity's own real table entry.
  const isOriginalUnmatchedSchool =
    route != null &&
    route.schoolName === schoolName &&
    !matchedSchool &&
    !matchedSavedLocation;
  const schoolAddress =
    matchedSchool?.info.address ??
    matchedSavedLocation?.address ??
    (isOriginalUnmatchedSchool
      ? route.schoolAddress
      : SCHOOL_ADDRESS_NOT_YET_PROVIDED);
  // Null whenever the anchor isn't a real school (no match at all, or
  // matched to a saved location instead) - a school level genuinely
  // doesn't exist for either case (see Route.schoolLevel's own doc
  // comment, types.ts).
  const schoolLevel: SchoolLevel | null =
    matchedSchool?.info.schoolLevel ??
    (isOriginalUnmatchedSchool ? route.schoolLevel : null);
  const schoolLat =
    matchedSchool?.info.lat ??
    matchedSavedLocation?.lat ??
    (isOriginalUnmatchedSchool ? route.schoolLat : null);
  const schoolLon =
    matchedSchool?.info.lon ??
    matchedSavedLocation?.lon ??
    (isOriginalUnmatchedSchool ? route.schoolLon : null);
  // Whether `schoolAddress` above is a real, geocodable address rather
  // than the generic "not yet provided" placeholder it falls back to
  // when nothing's typed or matched yet - unlike that state-backed
  // field before this pass, `schoolAddress` is never actually blank
  // anymore, so gating on this instead of `schoolAddress.trim()` is
  // what still keeps `waypoints` from treating an unresolved anchor as
  // ready.
  const hasRealSchoolAddress =
    Boolean(matchedSchool) || Boolean(matchedSavedLocation) || isOriginalUnmatchedSchool;
  // StepRowEditor's own address-book popup (AddressBookIcon, beside
  // this field below) - same LocationPickerModal every row's own
  // Location field already opens, just picking this route's own
  // anchor instead of one waypoint's.
  const [showSchoolLocationPicker, setShowSchoolLocationPicker] =
    useState(false);
  // Blank (never "pickup" by default) for a brand-new route - Trip is
  // one of the three fields this screen actually requires (see
  // requiredFieldErrors below), so it needs a genuine "not chosen yet"
  // state to require *into*, the same way School already has one via
  // its own blank "Select a school" option.
  const [tripType, setTripType] = useState<TripType | "">(
    route?.tripType ?? seedMeta?.tripType ?? "",
  );
  // Every other real route this bus could plausibly hand off to once
  // this one's done - same trip type (an AM route handing off into a
  // PM one, or vice versa, would mean the bus sits idle for hours
  // mid-"trip"), excluding this route itself and every demo/
  // fabricated filler route (chaining only ever makes sense between
  // real, scheduled routes - see Route.nextRouteId's own doc comment
  // in types.ts). Deliberately NOT filtered to the same busNumber -
  // that used to be a hard requirement ("a chain is one bus driving
  // more than one leg back-to-back"), but a transition leg split off
  // to its own route (a depot-to-first-stop hop, say) is exactly the
  // case that's created before its own bus number is ever filled in,
  // and a strict match just hid every real route it should be able to
  // chain into. The sort below still surfaces a same-bus route first
  // when there is one, without excluding every other real candidate.
  const nextRouteOptions = useMemo(
    () =>
      routes
        .filter(
          (r) =>
            r.status !== "demo" && r.id !== route?.id && r.tripType === tripType,
        )
        .sort((a, b) => {
          const aSameBus = a.busNumber === busNumber && busNumber !== "" ? 0 : 1;
          const bSameBus = b.busNumber === busNumber && busNumber !== "" ? 0 : 1;
          return aSameBus - bSameBus;
        }),
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
  const [stepsText, setStepsText] = useState(initialStepsText ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepsTextareaRef = useRef<HTMLTextAreaElement>(null);
  // mode "edit" only - seeded once from initialSteps (the route's own
  // already-structured rows, straight from Postgres or a prior edit
  // this session), then edited structurally (add/remove/change a row)
  // from here on, never re-derived from initialSteps again.
  // quickEdit's own `insertNewAfter` splices its blank row in right
  // here, at the very first render, rather than via a mount effect -
  // so there's never a frame where the Waypoints list behind the
  // about-to-open popup is the *wrong* one (missing the row this
  // session exists to edit) even for an instant.
  const [rows, setRows] = useState<RawRouteRow[]>(() => {
    if (!quickEdit?.insertNewAfter) return initialSteps;
    const next = [...initialSteps];
    next.splice(quickEdit.rowIndex + 1, 0, BLANK_ROW);
    return next;
  });
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
  // Defaults to off (showing every turn) here - unlike StartScreen's
  // own "View All Stops," which defaults to stops-only - reviewing a
  // route for editing is exactly when seeing every turn in its real
  // place matters most.
  const [stopsOnly, setStopsOnly] = useState(false);
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
  // quickEdit opens straight into whichever row it names, from the
  // very first render (same reasoning as `rows` above) - `insertNewAfter`
  // shifts which index that actually is, since `rows` above already
  // spliced its own blank row in one position later.
  const quickEditTargetIndex = quickEdit
    ? quickEdit.insertNewAfter
      ? quickEdit.rowIndex + 1
      : quickEdit.rowIndex
    : null;
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    quickEditTargetIndex,
  );
  const [draftRow, setDraftRow] = useState<RawRouteRow | null>(() => {
    if (!quickEdit) return null;
    return quickEdit.insertNewAfter
      ? BLANK_ROW
      : { ...initialSteps[quickEdit.rowIndex] };
  });
  const [newlyAddedIndex, setNewlyAddedIndex] = useState<number | null>(
    quickEdit?.insertNewAfter ? quickEditTargetIndex : null,
  );
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
  // Shows the hub screen's own "New Route Created!" confirmation while
  // `justCreated` is true and nothing's been touched yet - derived
  // straight off `dirty` rather than its own separate state, so the
  // confirmation naturally disappears the instant an admin starts
  // actually editing this route further, without needing to remember to
  // clear it anywhere.
  const showCreatedBanner = Boolean(justCreated) && !dirty;
  // mode "add" only - the paste box's own "Details" link, see
  // StopsFormatModal above.
  const [showFormatModal, setShowFormatModal] = useState(false);
  // mode "edit" only - which of the two screens this whole component is
  // currently showing: the hub (the Route Details form itself, plus an
  // "Edit Waypoints" button down to the second screen) or the Stops and
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
  const [subScreen, setSubScreen] = useState<"hub" | "stops">(
    quickEdit ? "stops" : (initialSubScreen ?? "hub"),
  );
  // Which way ScreenTransition should animate the *next* hub<->stops
  // switch - "forward" diving into Stops from the hub's own "Edit
  // Waypoints" button, "backward" for Back/Cancel returning to the hub.
  // Set alongside `subScreen` itself (see goToSubScreen below), same
  // pairing page.tsx's own navDirection/screen do for the outer
  // between-screens transition this one nests inside.
  const [subScreenDirection, setSubScreenDirection] = useState<"forward" | "backward">("forward");

  function goToSubScreen(next: "hub" | "stops", direction: "forward" | "backward") {
    setSubScreenDirection(direction);
    setSubScreen(next);
  }

  // Stops' own Back arrow and Cancel button both want the same target:
  // the hub screen, *if* this session actually has one to return to.
  // initialSubScreen === "stops" means it doesn't - this instance was
  // opened straight into Stops (the View Stops popup's own pencil), so
  // "hub" here would be a screen the user never chose to visit at all.
  // In that case Back/Cancel should leave EditRouteScreen entirely via
  // the real onCancel, same as the hub screen's own Back/Cancel already
  // do, instead of dropping the user onto an unfamiliar Details form.
  function handleStopsBack() {
    if (initialSubScreen === "stops") {
      onCancel();
    } else {
      goToSubScreen("hub", "backward");
    }
  }

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

  // A single-row Fetch (globe button) that only found a coordinate via
  // a fallback strategy (street-type/spelling correction, or a
  // same-road "loop-snap" placement) - GeocodeConfirmModal shows this
  // and waits for Accept/Reject before anything's persisted. Null the
  // rest of the time, including for every plain exact match, which
  // never touches this state at all (see fetchLocation above).
  const [pendingFallbackConfirm, setPendingFallbackConfirm] = useState<{
    waypoint: GeocodableQuery;
    entry: Extract<WaypointCacheEntry, { status: "ok" }>;
    fallback: FallbackDetail;
  } | null>(null);

  /** GeocodeConfirmModal's own Accept - persists exactly the same way
   * a plain exact match already does (setCache + persistWaypoint),
   * just gated behind this extra look-it-over step. */
  function acceptFallbackMatch() {
    if (!pendingFallbackConfirm) return;
    const { waypoint, entry } = pendingFallbackConfirm;
    const key = waypointCacheKey(waypoint);
    setCache((prev) => ({ ...prev, [key]: entry }));
    persistWaypoint(key, entry);
    setPendingFallbackConfirm(null);
  }

  /** GeocodeConfirmModal's own Reject - leaves the row exactly as
   * unresolved as it was before this Fetch ran, recorded as a real
   * "error" cache entry (not just silently forgotten) so the row's own
   * status line explains why nothing saved rather than reading as if
   * Fetch was never tried at all. */
  function rejectFallbackMatch() {
    if (!pendingFallbackConfirm) return;
    const { waypoint, fallback } = pendingFallbackConfirm;
    const key = waypointCacheKey(waypoint);
    const entry: WaypointCacheEntry = {
      status: "error",
      message: `Rejected a suggested match ("${fallback.correctedQuery}") - no coordinate saved.`,
      notFound: true,
      source: waypointLabel(waypoint),
      provider: "overpass",
    };
    setCache((prev) => ({ ...prev, [key]: entry }));
    setPendingFallbackConfirm(null);
  }

  // The gap (a real index into `rows`, not `visibleRowIndices`) whose
  // scissors icon is currently open in SplitRouteModal - null the rest
  // of the time. Only ever set for an internal gap (see AddStepButton's
  // own `onSplit` doc comment), so `rows.slice` on either side of it
  // always has something in it.
  const [splitGapIndex, setSplitGapIndex] = useState<number | null>(null);
  // Move's own save of the shortened original - separate from the hub
  // screen's own `saving`/`message` (the main Save button) so a Move
  // failure shows up inside SplitRouteModal itself, next to the retry,
  // rather than on a screen the admin's already navigating away from.
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  // Guards the hub screen's own "Duplicate Route" link the same way
  // `saving` guards Save - a duplicate is its own immediate POST, not
  // routed through handleSave, so it needs its own in-flight flag.
  const [duplicating, setDuplicating] = useState(false);
  // Same guard, for the hub screen's own "Reverse Route" link.
  const [reversing, setReversing] = useState(false);

  /** SplitRouteModal's own Move/Copy step - hands the chosen half's
   * rows up to page.tsx as ready-to-paste text (the same canonical
   * format an admin's own upload/paste already produces), along with
   * this route's own School/Trip as a starting point, so the new route
   * needs only a Route #/Name before its first Save.
   *
   * Copy leaves this route's own `rows` untouched, same as always.
   * Move actually removes the split-off half from `rows` *and* saves
   * that shortened list right away (handleSave's own `overrideRows`) -
   * a "move" that only ever showed up in this screen's own unsaved
   * draft would silently undo itself the next time this route loads
   * from Postgres without an admin ever coming back to hit Save on it,
   * which isn't what "moved" means. A failed save reverts `rows` back
   * to its full, pre-split state and leaves the modal open on its
   * Move/Copy step (splitError) rather than quietly discarding the
   * admin's own removal or forging ahead to the new route screen as if
   * the original still reflected it.
   */
  async function handleSplit(direction: "above" | "below", action: "move" | "copy") {
    if (splitGapIndex === null || !onSplitToNewRoute) return;
    const selected =
      direction === "above" ? rows.slice(0, splitGapIndex) : rows.slice(splitGapIndex);

    if (action === "move") {
      const remaining =
        direction === "above" ? rows.slice(splitGapIndex) : rows.slice(0, splitGapIndex);
      setSplitSaving(true);
      setSplitError(null);
      setRows(remaining);
      const ok = await handleSave(status, remaining);
      setSplitSaving(false);
      if (!ok) {
        setRows(rows);
        setSplitError("Couldn't save the shortened route - try again.");
        return;
      }
    }

    onSplitToNewRoute(serializeRouteImport(selected), {
      schoolName,
      tripType,
      routeNumber: `Split-${routeNumber}`,
    });
    setSplitGapIndex(null);
  }

  // EditSavedLocationModal's own Save button (opened either from the
  // address book's "+ Add Location" footer button, `id: null`, or a
  // saved location's own pencil icon, `id` set) - POSTs/PATCHes
  // /api/saved-locations and updates `savedLocations` above so the
  // list reflects it immediately, without waiting on a refetch.
  async function handleSaveSavedLocation(
    id: number | null,
    name: string,
    address: string,
    lat: number | null,
    lon: number | null,
  ): Promise<SavedLocationInfo | { error: string }> {
    try {
      const res = await fetch(
        id == null ? "/api/saved-locations" : `/api/saved-locations/${id}`,
        {
          method: id == null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, address, lat, lon }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        return { error: data.error ?? "Couldn't save this location." };
      }
      const saved = data as SavedLocationInfo;
      setSavedLocations((prev) =>
        id == null
          ? [...prev, saved]
          : prev.map((loc) => (loc.id === saved.id ? saved : loc)),
      );
      return saved;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // EditSavedLocationModal's own Fetch button - a preview-only geocode
  // that doesn't touch the database, so the admin can see/adjust the
  // result before Save actually persists anything.
  async function handleFetchSavedLocationCoords(
    address: string,
  ): Promise<{ lat: number; lon: number } | { error: string }> {
    try {
      const res = await fetch("/api/saved-locations/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.error ?? "Couldn't geocode this address." };
      }
      return data as { lat: number; lon: number };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

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

  // Every Stop row's own "Stop N" number, counted straight through
  // `rows` in order rather than `visibleRowIndices` - a stop's number is
  // its fixed position in the real route, not a count of whatever
  // "Stops only"/"Unverified only" currently leave visible. Used
  // everywhere a "Stop N" number is shown (the visible list's own row
  // header, StepRowEditor's header, WaypointPreviewMap's dots) so a
  // stop's number never changes just because a filter toggled - only
  // reordering/adding/removing a Stop row itself should ever do that.
  const absoluteStopNumbers = useMemo(() => {
    const numbers = new Map<number, number>();
    let counter = 0;
    rows.forEach((row, index) => {
      if (row.action.toLowerCase() === "stop") numbers.set(index, ++counter);
    });
    return numbers;
  }, [rows]);

  // Every already-resolved Stop row's own coordinate (not a turn, not
  // the school) - `resolutionRows` shares `rows`' own index order
  // (deriveWaypointsWithContext builds `waypoints` via a plain
  // `rows.map`, so `stepId` is just that index), so lining the two up
  // by position is enough to tell which resolved point belongs to an
  // actual Stop. WaypointPreviewMap draws these as red, numbered dots,
  // distinct from whichever one is this row's own (highlighted
  // separately). `rowIndex` (a real index into `rows`) is only ever
  // read by StepRowEditor's own call site (goToRowIndex, below) -
  // tapping one of these dots on the map opens that row's own editor
  // in place of whichever one is currently open.
  const stopPins = useMemo(() => {
    const pins: StopPin[] = [];
    resolutionRows.forEach((r, i) => {
      if (r.status === "resolved" && rows[i]?.action.toLowerCase() === "stop") {
        pins.push({ lat: r.lat, lon: r.lon, rowIndex: i, stopNumber: absoluteStopNumbers.get(i) ?? 0 });
      }
    });
    return pins;
  }, [resolutionRows, rows, absoluteStopNumbers]);

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
  //
  // A function, not just the memo below directly - handleLocationChange
  // needs this same derivation for a row it hasn't actually committed
  // to `draftRow` yet (the new Location text, applied on top of a copy
  // of the draft), so a school/saved-location match can resolve to the
  // *new* text's own cache key immediately rather than the stale one
  // `draftWaypoint` itself is still holding at the moment that change
  // first comes in.
  const computeDraftWaypointFor = useCallback(
    (row: RawRouteRow) => {
      if (expandedIndex === null) return undefined;
      if (
        mode !== "edit" ||
        hasIncompleteRow ||
        !hasRealSchoolAddress ||
        rows.length === 0
      )
        return undefined;
      const draftRows = rows.map((r, i) => (i === expandedIndex ? row : r));
      return deriveWaypointsWithContext(draftRows, schoolAddress).waypoints[
        expandedIndex
      ];
    },
    [expandedIndex, rows, schoolAddress, mode, hasIncompleteRow, hasRealSchoolAddress],
  );
  const draftWaypoint = useMemo(
    () => (draftRow ? computeDraftWaypointFor(draftRow) : undefined),
    [draftRow, computeDraftWaypointFor],
  );
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
  /** The Location field's own onChange (typing, or picking one of its
   * own <datalist> suggestions - both fire the same input event) - same
   * patch as handleDraftChange above, plus one extra step: if the new
   * text exactly matches a School or SavedLocation that already has its
   * own lat/lon, resolve this row immediately (setManualCoordinates)
   * instead of leaving it unresolved until Save/Update - the same
   * "resolves this row immediately" treatment LocationPickerModal's own
   * onSelect already gives a pick from the address book popup, now also
   * true of typing (or datalist-picking) that exact same name by hand.
   * Computes the new row's own waypoint fresh (computeDraftWaypointFor,
   * with `value` applied) rather than reading `draftWaypoint` itself -
   * that memo hasn't recomputed yet at the moment this fires
   * (handleDraftChange's own setDraftRow is still in flight), so it's
   * still holding the *previous* text's own cache key. */
  function handleLocationChange(value: string) {
    handleDraftChange({ location: value });

    const target = value.trim().toLowerCase();
    if (!target || !draftRow) return;
    const matched: { lat: number | null; lon: number | null } | undefined =
      Object.entries(schools).find(([name]) => name.trim().toLowerCase() === target)?.[1] ??
      savedLocations.find((loc) => loc.name.trim().toLowerCase() === target);
    if (matched?.lat == null || matched.lon == null) return;

    const waypoint = computeDraftWaypointFor({ ...draftRow, location: value });
    if (!waypoint || waypoint.kind === "unresolvable") return;
    setManualCoordinates(waypoint, matched.lat, matched.lon);
  }
  function handleUpdateRow() {
    if (expandedIndex === null || !draftRow) return;
    const index = expandedIndex;
    const updatedRows = rows.map((r, i) => (i === index ? draftRow : r));
    // quickEdit: this popup is the *entire* reason EditRouteScreen is
    // even mounted right now - there's no Waypoints list for closing it
    // to reveal, and "Update" is meant to read as "save and go back to
    // the drive," not "commit locally, then still need a separate real
    // Save." Saves immediately (handleSave's own overrideRows - `rows`
    // itself hasn't re-rendered with `updatedRows` yet at this point in
    // the same tick) and routes its completion through quickEdit's own
    // callback instead of the ordinary onSave prop (see handleSave's
    // own quickEdit branch) - never falls through to the plain local
    // commit below.
    if (quickEdit) {
      void handleSave(status, updatedRows);
      return;
    }
    setRows(() => updatedRows);
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
    // quickEdit: same reasoning as handleUpdateRow above - nothing was
    // ever saved (rows/cache are this component's own local state,
    // about to unmount entirely), so there's no cleanup to do here at
    // all, just hand control straight back to the drive at the same
    // step it was on.
    if (quickEdit) {
      quickEdit.onCancelled(quickEdit.rowIndex);
      return;
    }
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
  // first. Called two ways: every "Add Step" control in the list below
  // (disabled whenever a row is already expanded, so `expandedIndex` is
  // always null there - inserting partway through never has to shift an
  // already-open row's own index out from under it), and StepRowEditor's
  // own "insert after this one" button, called *while* this exact row
  // is still open - the currently-open draft is committed into `rows`
  // first (same as goToRowIndex does for prev/next), so whatever was
  // typed there isn't lost under the fresh blank row this opens next.
  // See handleCancelRow above for what backing out of this specific row
  // does differently from canceling an edit to one that already existed.
  function addRow(index: number) {
    setRows((prev) => {
      const committed =
        expandedIndex !== null && draftRow
          ? prev.map((r, i) => (i === expandedIndex ? draftRow : r))
          : prev;
      const next = [...committed];
      // fromLocation starts blank, same as every other new row - the
      // road already tracked heading into this exact position shows
      // live as StepRowEditor's own "From" placeholder (its own
      // `previousRoad` prop), so there's nothing to pre-fill into the
      // row's real data just to avoid a moment of "no context shown."
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
    allowFallback = false,
  ): Promise<GeocodeResponseBody> {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        schoolAddress,
        anchor: schoolAnchor ?? undefined,
        allowFallback,
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
      const data = await callGeocodeApi(waypoint, true);
      if (data.anchor) setSchoolAnchor(data.anchor);
      persistSchoolAnchorIfFresh(data.anchorEntry);

      // A fallback strategy is what actually found this (street-type/
      // spelling correction, or a same-road "loop-snap" placement) -
      // hold off on persisting anything until GeocodeConfirmModal's own
      // Accept, rather than saving a guess an admin hasn't actually
      // looked at yet. A plain exact match (the overwhelming majority)
      // skips this entirely and saves exactly as it always has, below.
      if (data.result.status === "ok" && data.fallback) {
        setPendingFallbackConfirm({
          waypoint,
          entry: data.result,
          fallback: data.fallback,
        });
        return;
      }

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
      // Same reasoning as runFetchAll's own per-item catch below: this
      // row's own request failed outright (most often the school-
      // address anchor lookup an intersection query needs, or - as
      // with a missing ORS_API_KEY - every query alike), and the only
      // way an admin sees that at all is if it lands in this row's own
      // cache entry. `fetchError` below still drives the "Fetch
      // Coordinates..." modal's own banner for a batch run, but nothing
      // renders it when this single-row Fetch (StepRowEditor's own
      // globe button) is what failed - without also recording this
      // here, the row silently sat at "Not yet geocoded" forever with
      // no visible sign anything was even attempted.
      const key = waypointCacheKey(waypoint);
      const entry: WaypointCacheEntry = {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        raw: err instanceof GeocodeApiError ? err.raw : undefined,
        source: waypointLabel(waypoint),
        provider: "none",
      };
      setCache((prev) => ({ ...prev, [key]: entry }));
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
      // "none" for a route with no real school level - a Special run,
      // or one anchored on a saved location - rather than requiring
      // every id segment to be non-null. Collision risk is the same
      // "unique as long as..." best-effort this id convention already
      // accepts (see the Route model's own doc comment,
      // schema.prisma): two schoolless routes for the same bus/trip
      // type on the same day is rare enough not to design around here.
      return {
        id: `${routeNumber}-${effectiveTripType}-${schoolLevel ?? "none"}`,
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
  // Not required (a blank Start is fine, same as busNumber/driver) -
  // only flagged once something's actually typed in but parseTimeInput
  // can't make sense of it, so Save doesn't silently write whatever
  // unparseable text was left in the box.
  const startTimeInvalid =
    departureTime.trim() !== "" &&
    parseTimeInput(departureTime, tripType || undefined) === null;

  /** `overrideRows` - Move-a-split's own way of saving a shortened row
   * list immediately (see handleSplit below) without waiting on a
   * `setRows` re-render first, which a plain read of the `rows` closure
   * here wouldn't see yet in the same tick. Omitted (every other
   * caller), this reads the same `rows`/`parseResult.rows` it always
   * has. Returns whether the save actually succeeded, so a caller that
   * has something conditional to do next (handleSplit's own "don't
   * navigate to the new route on a failed Move save") can tell. */
  async function handleSave(
    nextStatus: RouteStatus = status,
    overrideRows?: RawRouteRow[],
  ): Promise<boolean> {
    if (routeNumberMissing || tripTypeMissing || schoolNameMissing) {
      setShowRequiredErrors(true);
      setMessage("Route #, Trip, and School are required.");
      return false;
    }
    if (startTimeInvalid) {
      setShowRequiredErrors(true);
      setMessage(`Start time "${departureTime}" isn't a time this app can recognize.`);
      return false;
    }
    if (saving) return false;
    const currentRows = overrideRows ?? (mode === "add" ? parseResult.rows : rows);
    const built = buildRouteFromRows(currentRows, buildMetaFields(nextStatus));
    // Only set in "edit" mode - a brand-new route (mode "add") has no
    // previous row to clean up after, even if its own freshly-typed
    // routeNumber/tripType/schoolLevel happen to collide with
    // something already saved (a real id collision, not a rename -
    // the upsert below already handles that case correctly on its
    // own). Passed to onSave below too, not just the request body here -
    // page.tsx's own local route overlay needs to know the same thing
    // the server does: that a rename means this route's own id just
    // changed, not that a second route now exists alongside the first.
    const previousId = mode === "edit" ? (route?.id ?? null) : null;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: built.id,
          previousId,
          status: nextStatus,
          routeNumber: built.routeNumber,
          busNumber: built.busNumber,
          schoolName: built.schoolName,
          schoolLevel: built.schoolLevel,
          tripType: built.tripType,
          // Normalized to strict 24-hour "HH:MM:SS" here, not whatever
          // shape was typed - startTimeInvalid above already guarantees
          // this parses whenever built.departureTime isn't blank.
          startTime: built.departureTime.trim()
            ? (parseTimeInput(built.departureTime, built.tripType) ?? "")
            : "",
          nextRouteId: built.nextRouteId,
          steps: currentRows,
        }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        setMessage(`Couldn't save: ${data.error ?? res.statusText}`);
        return false;
      }
    } catch (err) {
      setMessage(
        `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      setSaving(false);
    }

    setStatus(nextStatus);
    setDirty(false);
    // quickEdit: routes straight back to the live trip (its own
    // onSaved, see this screen's own quickEdit prop doc comment) rather
    // than the ordinary onSave, which would otherwise land on this
    // screen's own hub - a session that only ever existed to fix one
    // waypoint has nothing to show there.
    if (quickEdit) {
      quickEdit.onSaved(built, currentRows, cache, quickEdit.rowIndex);
    } else {
      onSave(built, currentRows, cache, previousId);
    }
    return true;
  }

  /** The hub screen's own "Duplicate Route" link - saves an immediate,
   * full copy of this route under a new id/routeNumber (a `Copy-`
   * prefix, same convention handleSplit's own `Split-` prefix above
   * uses) rather than routing through handleSave, since this needs a
   * *different* id built from a *different* routeNumber than the one
   * still sitting in the form - `previousId: null` (a new route
   * appearing alongside this one, not a rename of it) and `status:
   * "draft"` (never publish a copy nobody's reviewed yet, whatever this
   * route's own current status is). Always leaves the original route's
   * own unsaved form state untouched either way - a failed duplicate is
   * just a message, nothing here was ever written to `rows`/`status`/etc. */
  async function handleDuplicate() {
    if (mode !== "edit" || duplicating) return;
    if (routeNumberMissing || tripTypeMissing || schoolNameMissing) {
      setShowRequiredErrors(true);
      setMessage("Route #, Trip, and School are required.");
      return;
    }
    const newRouteNumber = `Copy-${routeNumber}`;
    const meta = buildMetaFields("draft");
    meta.routeNumber = newRouteNumber;
    meta.id = `${newRouteNumber}-${meta.tripType}-${meta.schoolLevel ?? "none"}`;
    const built = buildRouteFromRows(rows, meta);

    setDuplicating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: built.id,
          previousId: null,
          status: "draft",
          routeNumber: built.routeNumber,
          busNumber: built.busNumber,
          schoolName: built.schoolName,
          schoolLevel: built.schoolLevel,
          tripType: built.tripType,
          startTime: built.departureTime.trim()
            ? (parseTimeInput(built.departureTime, built.tripType) ?? "")
            : "",
          nextRouteId: built.nextRouteId,
          steps: rows,
        }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        setMessage(`Couldn't duplicate: ${data.error ?? res.statusText}`);
        return;
      }
    } catch (err) {
      setMessage(
        `Couldn't duplicate: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    } finally {
      setDuplicating(false);
    }

    onSave(built, rows, cache, null);
  }

  /** The hub screen's own "Reverse Route" link - same immediate-save
   * shape as handleDuplicate above (`Reverse-` prefix, `previousId:
   * null`, forced `status: "draft"`), but the rows themselves are
   * genuinely transformed, not just carried over: reverseRouteRows
   * (src/lib/reverseRoute.ts) reverses their order and flips
   * everything about each row that depends on which way it's being
   * driven (left/right, side of road, Depart/Arrive), and tripType
   * flips pickup<->dropoff to match - the whole point being a quick
   * starting point for "the same stops, the other direction" (morning
   * pickup -> afternoon dropoff) without retyping every waypoint.
   * departureTime is deliberately dropped rather than carried over - an
   * AM route's own start time is never right for the PM run this
   * becomes. This is explicitly a *naive* reversal (see
   * reverseRouteRows's own doc comment on exactly where) - real
   * verification against the actual road network (are these turns
   * still legal/possible the other way) is a later, separate pass, not
   * this button. */
  async function handleReverse() {
    if (mode !== "edit" || reversing) return;
    if (routeNumberMissing || tripTypeMissing || schoolNameMissing) {
      setShowRequiredErrors(true);
      setMessage("Route #, Trip, and School are required.");
      return;
    }
    const newRouteNumber = `Reverse-${routeNumber}`;
    const newTripType = reverseTripType(tripType || "pickup");
    const reversedRows = reverseRouteRows(rows);
    const meta = buildMetaFields("draft");
    meta.routeNumber = newRouteNumber;
    meta.tripType = newTripType;
    meta.name = `${meta.schoolName} — ${tripTypeFullLabel(newTripType)}`;
    meta.departureTime = "";
    meta.id = `${newRouteNumber}-${newTripType}-${meta.schoolLevel ?? "none"}`;
    const built = buildRouteFromRows(reversedRows, meta);

    setReversing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: built.id,
          previousId: null,
          status: "draft",
          routeNumber: built.routeNumber,
          busNumber: built.busNumber,
          schoolName: built.schoolName,
          schoolLevel: built.schoolLevel,
          tripType: built.tripType,
          startTime: "",
          nextRouteId: built.nextRouteId,
          steps: reversedRows,
        }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        setMessage(`Couldn't reverse: ${data.error ?? res.statusText}`);
        return;
      }
    } catch (err) {
      setMessage(
        `Couldn't reverse: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    } finally {
      setReversing(false);
    }

    onSave(built, reversedRows, cache, null);
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

  // Which rows to actually render below - stops only when "Stops only"
  // is on, every row otherwise (matching StartScreen's own "View All
  // Stops" default), further narrowed to just the unresolved ones when
  // "Unverified only" is on. Never affects the underlying `rows` state
  // itself, only what's currently displayed.
  const visibleRowIndices = rows
    .map((_, index) => index)
    .filter((index) => !stopsOnly || rows[index].action.toLowerCase() === "stop")
    .filter(
      (index) =>
        !showUnverifiedOnly || resolutionRows[index]?.status === "unresolved",
    );

  // "Jump to next unverified"'s own target list - every *currently
  // visible* unresolved row (so it never lands on one hidden by "Stops
  // only" being on), independent of "Unverified only" itself (that
  // button's only ever shown while this list is the full one, not
  // already narrowed to just these rows - see its own render below).
  const unverifiedRowIndices = rows
    .map((_, index) => index)
    .filter((index) => !stopsOnly || rows[index].action.toLowerCase() === "stop")
    .filter((index) => resolutionRows[index]?.status === "unresolved");

  // StepRowEditor's own header arrows - saves the currently open row's
  // draft (same as tapping Update) and opens whichever *visible* row
  // sits next to it, so paging through a route's own waypoints never
  // lands on one "Stops only" (or "Unverified only") is currently
  // hiding. No-op past either end of `visibleRowIndices` - the arrows
  // themselves are disabled there too (see canGoPrev/canGoNext below),
  // this is just the same guard on the handler itself.
  // Shared by goToRow (the prev/next arrows) and onClickStopPin (a tap
  // on one of WaypointPreviewMap's own dots) - both are really just
  // "save the current draft, then open row `nextIndex` in its place,"
  // differing only in how `nextIndex` gets picked.
  function goToRowIndex(nextIndex: number) {
    if (expandedIndex === null || !draftRow || nextIndex === expandedIndex)
      return;
    setRows((prev) =>
      prev.map((r, i) => (i === expandedIndex ? draftRow : r)),
    );
    if (newlyAddedIndex === expandedIndex) setNewlyAddedIndex(null);
    setDirty(true);
    setExpandedIndex(nextIndex);
    setDraftRow({ ...rows[nextIndex] });
  }
  function goToRow(direction: "prev" | "next") {
    if (expandedIndex === null) return;
    const currentPos = visibleRowIndices.indexOf(expandedIndex);
    if (currentPos === -1) return;
    const nextIndex =
      visibleRowIndices[direction === "next" ? currentPos + 1 : currentPos - 1];
    if (nextIndex === undefined) return;
    goToRowIndex(nextIndex);
  }

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

  // Shared by mode "add"'s single screen and mode "edit"'s own
  // dedicated Details screen (see subScreen below) - identical either
  // way, so it's built once here rather than duplicated. Route #/Trip/
  // Start share one line (the three things a driver actually needs
  // for the trip itself); School gets its own full-width line right
  // after (picking the wrong school is the single costliest mistake in
  // this whole form); Bus number/Driver share a line last - least
  // important, neither means much without the other.
  const routeDetailsForm = (
    <div
      className={`w-full max-w-md rounded-2xl border p-5 text-left ${
        // Blue in edit mode - matches RouteListScreen's own admin-mode
        // box border, same "this box is live and editable" signal. Not
        // for mode "add" (a route that doesn't exist yet isn't "an
        // individual route" being edited) - this same form is also
        // that screen's own single card, unchanged there.
        mode === "edit" ? "border-2 border-blue-400" : "border-zinc-300"
      }`}
    >
      <div className="grid grid-cols-3 gap-2">
        <Field
          label={tripType === "fieldtrip" ? "# / Name" : "#"}
          required={routeNumberMissing}
        >
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
            // A Special (field trip) run isn't one of a district's own
            // numbered routes - it's a one-off, so this field doubles
            // as a free-text name for it ("Zoo Trip", "Band Comp")
            // rather than requiring a real route number that doesn't
            // exist. Every other trip type keeps the plain numeric
            // placeholder/hint - this field has always accepted any
            // text typed into it either way (it's a plain input, never
            // constrained to digits), so nothing about *validation*
            // changes here, just what an admin is told to expect.
            placeholder={tripType === "fieldtrip" ? "123 or Zoo Trip" : "123"}
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
            <option value="pickup">AM</option>
            <option value="dropoff">PM</option>
            <option value="fieldtrip">Special</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Start">
          <input
            className={
              showRequiredErrors && startTimeInvalid
                ? errorInputClass
                : inputClass
            }
            value={departureTime}
            onChange={(e) => {
              setDepartureTime(e.target.value);
              setDirty(true);
            }}
            placeholder="H:MM AM"
          />
        </Field>
      </div>

      {/* Free text, matched by name against Schools then
          SavedLocations (matchedSchool/matchedSavedLocation above) -
          level/address/point come from whichever matched, exactly the
          way StepRowEditor's own Location field already works. Doesn't
          have to match anything at all: a Special route's own one-off
          starting point is just as valid typed in plain. */}
      <div className="mt-3">
        <Field label="School" required={schoolNameMissing}>
          <div className="flex items-center gap-2">
            {matchedSchool || matchedSavedLocation ? (
              <MatchedLocationChip
                name={matchedSchool?.name ?? matchedSavedLocation?.name ?? ""}
                onClear={() => {
                  setSchoolName("");
                  setDirty(true);
                }}
                clearLabel="Clear school"
              />
            ) : (
              <input
                className={`min-w-0 flex-1 ${
                  showRequiredErrors && schoolNameMissing
                    ? errorInputClass
                    : inputClass
                }`}
                value={schoolName}
                onChange={(e) => {
                  setSchoolName(e.target.value);
                  setDirty(true);
                }}
                placeholder="LaVergne High School"
              />
            )}
            <button
              type="button"
              onClick={() => setShowSchoolLocationPicker(true)}
              aria-label="Choose from address book"
              className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
            >
              <AddressBookIcon className="h-4 w-4" />
            </button>
          </div>
        </Field>
      </div>

      {schoolName && (
        <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
          <MapPinIcon className="h-3 w-3 shrink-0 text-blue-500" />
          {schoolAddress}
        </p>
      )}

      {showSchoolLocationPicker && (
        <LocationPickerModal
          schools={schools}
          savedLocations={savedLocations}
          onSaveSavedLocation={handleSaveSavedLocation}
          onFetchCoordinates={handleFetchSavedLocationCoords}
          onSelect={(choice) => {
            setSchoolName(choice.name);
            setDirty(true);
            setShowSchoolLocationPicker(false);
          }}
          onClose={() => setShowSchoolLocationPicker(false)}
        />
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
            ${schoolLevel ?? "none"}`, always hyphenated) - "the driver heads back
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
  // there with its own Save/Cancel, plus an "Edit Waypoints" button below)
  // by default, or the Stops and Turns screen once that's picked.

  if (subScreen === "stops") {
    return (
      <ScreenTransition screenKey="stops" direction={subScreenDirection}>
      <div className="flex flex-1 flex-col items-center gap-3 overflow-hidden px-6 pb-2 text-center">
        {/* Everything that can genuinely grow past the viewport (the
            stops table especially) lives in this inner, scrollable
            region - Download/Cancel/Save below stay outside it, pinned
            to the bottom of the screen instead of scrolling away with
            a long stops list. */}
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-3">
          {/* Title and route name share one tight-gapped block (gap-0.5,
              not this column's own gap-3) so the route name sits right
              under the title instead of with the same breathing room
              every other section here gets. */}
          <div className="flex w-full max-w-md shrink-0 flex-col items-center gap-0.5">
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={handleStopsBack}
                aria-label="Back"
                className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
              >
                <BackArrowIcon className="h-5 w-5" />
              </button>
              <h1 className="font-heading text-2xl font-black tracking-tight">
                Waypoints
              </h1>
              <span className="w-10" />
            </div>

            {/* A secondary heading naming exactly which route this is -
                route number/trip/school, same badge convention every
                other route callout in the app uses (RouteListScreen's own
                rows, StartScreen's title) - so this doesn't read as a
                generic "stops" screen once Details is a separate tap
                away and no longer visible alongside it. */}
            <p className="flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0.5">
              {/* No separate "AM"/"PM" text beside this icon
                  (TripTypeIcon.tsx's own doc says why) - just the icon
                  alone, sized to nearly match the route number's own
                  height (h-4 against text-lg), same ratio StartScreen's
                  own title uses (h-6 against its text-4xl). Every other
                  TripType (fieldtrip/other) skips the badge entirely -
                  those routes may not even have a morning/afternoon
                  distinction to badge, and there's no real example of
                  one yet to design that case against. Blue (text-blue-600,
                  IconTooltip's own standard color - see its own doc
                  comment), same as SchoolLevelIcon beside it and every
                  other route-number badge across the app, tappable for a
                  quick "what does this mean" label since the icon alone
                  still carries no text. */}
              {routeNumber &&
                (tripType === "pickup" || tripType === "dropoff") && (
                  <IconTooltip
                    label={tripTypeFullLabel(tripType)}
                    className="h-4 w-4 text-blue-600"
                  >
                    <TripTypeIcon tripType={tripType} className="h-full w-full" />
                  </IconTooltip>
                )}
              <span className="font-heading text-lg font-black tracking-tight">
                {routeNumber || (
                  <span className="text-zinc-400 italic">No route number</span>
                )}
              </span>
              {schoolLevel ? (
                <IconTooltip label={schoolLevelLabel(schoolLevel)} className="h-4 w-4 text-blue-600">
                  <SchoolLevelIcon level={schoolLevel} className="h-full w-full" />
                </IconTooltip>
              ) : (
                <SchoolLevelIcon level={schoolLevel} className="h-4 w-4 text-blue-600" />
              )}
              <span className="min-w-0 truncate text-sm font-semibold text-zinc-600">
                {schoolName || "No school selected"}
              </span>
            </p>
          </div>

          {hasIncompleteRow && (
            <p className="w-full max-w-md shrink-0 text-xs text-red-600">
              Every stop needs at least a type and a location before locations
              can be checked.
            </p>
          )}

          {/* The verified-locations meter floats left, beside Fetch
              Coordinates on its right, just above the main list box -
              rather than its old spot up under the route name, once
              disconnected from the toggles now living inside that box
              below (see doc comment there). Left side stays present
              (an empty flex-1) even with nothing geocodable yet, so the
              button doesn't jump from centered to right-aligned once a
              school/stop actually gets picked. */}
          <div className="flex w-full max-w-md shrink-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-left">
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
                    <div className="flex w-full max-w-[16rem] flex-col items-start gap-1">
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
            <button
              type="button"
              onClick={() => setShowFetchModal(true)}
              className="btn-glossy-light flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-900"
            >
              <GlobeIcon className="h-3.5 w-3.5" />
              Fetch Coordinates…
            </button>
          </div>

          {/* Blue outline in edit mode, matching RouteListScreen's own
              admin-mode box border - this screen is always mid-edit. */}
          <div className="flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border-2 border-blue-400 text-left">
            {/* Both toggles live at the top of the list box itself now,
                next to each other, rather than each with its own
                full-width row above it - they're both view filters on
                the exact list directly below them, not route-level
                settings like Fetch Coordinates. */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-zinc-200 px-4 py-2.5">
              <ToggleSwitch
                checked={stopsOnly}
                onChange={setStopsOnly}
                label="Stops only"
              />
              <ToggleSwitch
                checked={showUnverifiedOnly}
                onChange={setShowUnverifiedOnly}
                label="Unverified only"
              />
              {/* Only offered from the full list - "Unverified only"
                  above already narrows to exactly these rows, so a
                  shortcut to find one among them would be redundant. */}
              {!showUnverifiedOnly && unverifiedRowIndices.length > 0 && (
                <button
                  type="button"
                  onClick={jumpToNextUnverified}
                  className="ml-auto flex shrink-0 items-center gap-1 text-xs font-semibold text-zinc-900"
                >
                  <XCircleIcon className="h-3.5 w-3.5 text-red-500" />
                  Next
                  <ArrowDownToLineIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
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
                dragging={dragRowIndex !== null}
                dropTarget={dragOverIndex === 0}
              />
              {visibleRowIndices.map((index) => {
                const row = rows[index];
                const isStop = row.action.toLowerCase() === "stop";
                const stopNumber = isStop
                  ? (absoluteStopNumbers.get(index) ?? null)
                  : null;
                const waypoint = waypoints[index];

                return (
                  <div
                    key={index}
                    data-row-index={index}
                    // No more border-t-2-on-drop-target styling here - that
                    // added real box height right on the row itself,
                    // shifting every row below it down a couple pixels the
                    // moment a drag entered a new gap. The landing
                    // indicator lives on AddStepButton below instead (see
                    // its own doc comment), which never changes size.
                    className={
                      highlightedRowIndex === index
                        ? "-mx-2 rounded-lg border-2 border-red-500 px-2 transition-colors"
                        : dragRowIndex === index
                          ? "opacity-40"
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
                      dragging={dragRowIndex !== null}
                      dropTarget={dragOverIndex === index + 1}
                      onSplit={
                        onSplitToNewRoute && index + 1 < rows.length
                          ? () => setSplitGapIndex(index + 1)
                          : undefined
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {splitGapIndex !== null && (
          <SplitRouteModal
            aboveCount={splitGapIndex}
            belowCount={rows.length - splitGapIndex}
            saving={splitSaving}
            error={splitError}
            onSplit={handleSplit}
            onClose={() => {
              setSplitGapIndex(null);
              setSplitError(null);
            }}
          />
        )}
        {pendingFallbackConfirm && (
          <GeocodeConfirmModal
            originalLabel={waypointLabel(pendingFallbackConfirm.waypoint)}
            entry={pendingFallbackConfirm.entry}
            fallback={pendingFallbackConfirm.fallback}
            routeLine={routeContextPoints}
            stopPins={stopPins}
            onAccept={acceptFallbackMatch}
            onReject={rejectFallbackMatch}
          />
        )}

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
                stopNumber={isStop ? (absoluteStopNumbers.get(index) ?? null) : null}
                previousRoad={previousRoads[index] ?? null}
                schools={schools}
                savedLocations={savedLocations}
                locationSuggestions={locationSuggestions}
                onSaveSavedLocation={handleSaveSavedLocation}
                onFetchSavedLocationCoords={handleFetchSavedLocationCoords}
                routeSchoolName={schoolName}
                isNew={newlyAddedIndex === index}
                status={draftStatus}
                fetching={
                  draftWaypoint
                    ? fetchingStepIds.has(draftWaypoint.stepId)
                    : false
                }
                fetchLocked={singleFetchCoolingDown}
                placementGuess={nearestResolvedGuess(resolutionRows, index)}
                routeContext={routeContextPoints}
                stopPins={stopPins}
                onChange={handleDraftChange}
                onLocationChange={handleLocationChange}
                onClickWaypointPin={goToRowIndex}
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
                canGoPrev={quickEdit ? false : visibleRowIndices.indexOf(index) > 0}
                canGoNext={
                  quickEdit
                    ? false
                    : visibleRowIndices.indexOf(index) <
                      visibleRowIndices.length - 1
                }
                onNavigate={goToRow}
                onAddWaypointAfter={() => addRow(index + 1)}
                onCancel={handleCancelRow}
                onDelete={() => handleDeleteRow(index)}
                onUpdate={handleUpdateRow}
                hideDelete={!!quickEdit}
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
                Download Waypoints
              </button>
            </div>
          )}
          {message && <p className="text-sm text-zinc-500">{message}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleStopsBack}
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
      </ScreenTransition>
    );
  }

  // subScreen "hub"
  return (
    <ScreenTransition screenKey="hub" direction={subScreenDirection}>
    <div className="flex flex-1 flex-col items-center gap-3 overflow-hidden px-6 pb-2 text-center">
      {/* Everything that can genuinely grow past the viewport (the
          Route Details form especially) lives in this inner, scrollable
          region - Edit Waypoints/Cancel/Save below stay outside it, pinned
          to the bottom of the screen instead of scrolling away, same
          pattern subScreen "stops" already uses for its own footer. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-4 overflow-y-auto">
        <div className="flex w-full max-w-md items-start justify-between">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
          >
            <BackArrowIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 px-1 text-center">
            {/* Same small district label StartScreen/RouteListScreen/
                SchoolListScreen each carry above their own heading - see
                StartScreen's own doc comment for why this isn't folded
                into the heading itself. Same size scale as that
                screen's own title now too (routeTitleSizeClass) - this
                is the same "Route N" callout, just reached from Edit
                Mode instead of tapping a row, so it reads the same way
                either way. */}
            <span className="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Rutherford County
            </span>
            {/* items-start + a flex row (not the old relative/absolute
                layout) - see StartScreen's own title for why: a
                Special/transition route's own free-typed name can wrap
                to more than one line, and a fixed top-1/2 badge
                position (or centering this row against the back
                button) only ever accounted for a single short line. No
                "Route " prefix either, same reasoning. */}
            <h1
              className={`font-heading flex items-start justify-center gap-1.5 font-black tracking-tight ${routeTitleSizeClass(route?.routeNumber ?? "")}`}
            >
              {/* No separate "AM"/"PM" text beside this icon
                  (TripTypeIcon.tsx's own doc says why) - vertically
                  centered against the title's full height and sized to
                  nearly match it.
                  Every other TripType (fieldtrip/other) skips the
                  badge entirely - those routes may not even have a
                  morning/afternoon distinction to badge, and there's
                  no real example of one yet to design that case
                  against. */}
              {route?.routeNumber &&
                (tripType === "pickup" || tripType === "dropoff") && (
                  <IconTooltip
                    label={tripTypeFullLabel(tripType)}
                    className="mt-1 h-6 w-6 shrink-0 text-blue-600"
                  >
                    <TripTypeIcon tripType={tripType} className="h-full w-full" />
                  </IconTooltip>
                )}
              <span className="min-w-0">{route?.routeNumber ?? ""}</span>
            </h1>
          </div>
          <span className="w-10" />
        </div>

        {showCreatedBanner && (
          <p className="flex w-full max-w-md shrink-0 items-center justify-center gap-1.5 text-sm font-semibold text-green-700">
            <CheckCircleIcon className="h-4 w-4 shrink-0" />
            New Route Created!
          </p>
        )}

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

      {/* Plain text links, not buttons - same "Download Waypoints"
          convention the Stops and Turns screen's own footer uses. Both
          make an immediate, saved copy of this route (see
          handleDuplicate's/handleReverse's own doc comments) rather
          than opening anything to review first - Split's own review
          step exists because it's carving up this route's live rows;
          neither of these has anything to reconcile, they're just new
          drafts. */}
      <div className="flex w-full max-w-md shrink-0 items-center justify-end gap-4">
        <button
          type="button"
          onClick={handleReverse}
          disabled={reversing}
          aria-label="Reverse this route's stops and directions as a new draft"
          className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 active:text-blue-800 disabled:opacity-40"
        >
          <ReverseIcon className="h-4 w-4" />
          Reverse Route
        </button>
        <button
          type="button"
          onClick={handleDuplicate}
          disabled={duplicating}
          aria-label="Duplicate this route as a new draft"
          className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 active:text-blue-800 disabled:opacity-40"
        >
          <CopyIcon className="h-4 w-4" />
          Duplicate Route
        </button>
      </div>

      <div className="w-full max-w-md shrink-0">
        <button
          type="button"
          onClick={() => goToSubScreen("stops", "forward")}
          className="btn-glossy-light font-heading flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-300 py-3 text-base font-semibold text-zinc-900"
        >
          <MapPinIcon className="h-5 w-5" />
          Edit Waypoints
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
    </ScreenTransition>
  );
}
