"use client";

import { useEffect, useMemo, useState } from "react";
import { Logo } from "./Logo";
import { BackArrowIcon, CheckCircleIcon, WarningIcon, XCircleIcon } from "./icons";
import { buildRouteFromRows } from "@/lib/parseRouteCsv";
import type { RouteMeta } from "@/lib/parseRouteCsv";
import { deriveWaypoints } from "@/lib/deriveWaypoints";
import { stepsCsvBaseName } from "@/lib/parseRouteMasterList";
import { parseRouteImport, unresolvedRequiredFields } from "@/lib/parseRouteImport";
import { PLACEHOLDER_DISTANCE, PLACEHOLDER_DRIVER_NAME } from "@/lib/placeholderMeta";
import { resolutionCounts, summarizeRouteResolution } from "@/lib/routeResolutionStatus";
import type { RowResolutionStatus } from "@/lib/routeResolutionStatus";
import type { WaypointCache } from "@/lib/waypointCache";
import type { Route, RouteStatus, SchoolLevel, TripType } from "@/lib/types";

const SCHOOL_LEVEL_OPTIONS: { value: SchoolLevel; label: string }[] = [
  { value: "elementary", label: "Elementary" },
  { value: "middle", label: "Middle School" },
  { value: "high", label: "High School" },
];

const STEPS_PLACEHOLDER = `Paste stops (and turns, if you have them). A few formats all work:

action,from_at,onto_at,rider_count,side,notes
Stop,Bill Stewart Blvd,Hidden Forest Ln,5,Right,

...or just a plain list, one stop per line, nothing else:
216 Lake Forest Dr
Bill Stewart Blvd & Hidden Forest Ln

...or stops and turns together, no header row at all:
Left, Rock Springs Rd
Stop, Bill Stewart Blvd, Hidden Forest Ln

Only the location itself is ever required - time, rider counts, side of street, and notes can all be left out.`;

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

function ResolutionRow({ row }: { row: RowResolutionStatus }) {
  if (row.status === "resolved") {
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm">
        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <span className="text-zinc-700">
          {row.displayName} <span className="text-zinc-400">({row.lat.toFixed(5)}, {row.lon.toFixed(5)})</span>
        </span>
      </div>
    );
  }
  if (row.status === "skipped") {
    return (
      <div className="flex items-start gap-2 py-1.5 text-sm text-zinc-400">
        <span className="mt-0.5 h-4 w-4 shrink-0 text-center leading-4">–</span>
        <span>Skipped (not a real road): {row.reason}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm">
      <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      <span className="text-zinc-700">Step {row.stepId + 1}: {row.reason}</span>
    </div>
  );
}

/**
 * The admin-only Add Route / Edit Route screen - reached via
 * RouteListScreen's "Add Route" link or StartScreen's "Edit Route"
 * link. Builds a Route from a pasted/typed stops list (via
 * parseRouteImport's graceful column/header matching - a plain list of
 * stops, stops and turns with no other columns, or the app's own full
 * schema all work) plus a small metadata form, checks it against
 * whatever geocoded waypoint cache already exists for this route
 * number/trip/level (empty for a brand-new one), and only allows
 * "Make Active" once every geocodable stop actually resolves - a
 * warning icon stands in for that button otherwise, rather than a
 * disabled control with no explanation.
 *
 * Session-only for now: `onSave` hands the built Route back up to
 * page.tsx's in-memory admin-route store, not a real committed file -
 * same "real workflow, no persistence yet" honesty this app already
 * uses for rider check-in state (see useRiderRoster.ts). Making a
 * brand-new route's status "active" for real still needs someone to
 * run the actual geocoding pipeline (scripts/geocodeRoute.ts) against
 * its steps once they're committed for real - this screen can't do
 * that itself (see EditRouteScreen's own README entry, "Next steps").
 */
export function EditRouteScreen({
  mode,
  route,
  rawStepsText,
  schoolAddresses,
  onCancel,
  onSave,
}: {
  mode: "add" | "edit";
  /** The route being edited, or null when adding a brand-new one. */
  route: Route | null;
  /** The route's own current steps text (pre-fills the textarea) -
   * always "" for `mode: "add"`. */
  rawStepsText: string;
  /** School name -> address, from schools.csv - offered as a one-click
   * fill-in for the school address field rather than auto-overwriting
   * whatever the admin already typed. */
  schoolAddresses: Record<string, string>;
  onCancel: () => void;
  onSave: (route: Route, rawStepsText: string) => void;
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
  const [stepsText, setStepsText] = useState(rawStepsText);
  const [status, setStatus] = useState<RouteStatus>(route?.status ?? "pending");
  const [showValidation, setShowValidation] = useState(false);
  const [cache, setCache] = useState<WaypointCache>({});
  const [message, setMessage] = useState<string | null>(null);

  // Whatever's already geocoded for this exact route number/trip/level
  // combination, if anything - a real route's committed sidecar cache
  // once one exists, or nothing at all for a brand-new one (a 404
  // resolves to an empty cache, same as RouteMap.tsx's own fetch).
  useEffect(() => {
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
  }, [routeNumber, tripType, schoolLevel]);

  const parseResult = useMemo(() => parseRouteImport(stepsText), [stepsText]);
  const missingRequired = useMemo(
    () => unresolvedRequiredFields(parseResult.mapping),
    [parseResult],
  );
  const waypoints = useMemo(() => {
    if (missingRequired.length > 0 || !schoolAddress || parseResult.rows.length === 0) return [];
    return deriveWaypoints(parseResult.rows, schoolAddress);
  }, [parseResult, missingRequired, schoolAddress]);
  const resolutionRows = useMemo(
    () => summarizeRouteResolution(waypoints, cache),
    [waypoints, cache],
  );
  const counts = useMemo(() => resolutionCounts(resolutionRows), [resolutionRows]);
  const canActivate =
    missingRequired.length === 0 && parseResult.rows.length > 0 && counts.unresolved === 0;
  // The readiness check only ever gates *activating* - deactivating an
  // already-active route (one that's live despite having unresolved
  // waypoints, e.g. before the real geocoding pipeline has ever run
  // against it) is always allowed, no warning needed for that
  // direction.
  const canToggleActive = status === "active" || canActivate;

  const knownSchoolAddress = schoolAddresses[schoolName];

  function buildMeta(nextStatus: RouteStatus): RouteMeta | null {
    if (!routeNumber.trim() || !schoolName.trim() || !schoolAddress.trim()) {
      setMessage("Route number, school name, and school address are all required.");
      return null;
    }
    if (missingRequired.length > 0) {
      setMessage(`Couldn't find a column for: ${missingRequired.join(", ")}. Every stop needs at least an action and a location.`);
      return null;
    }
    if (parseResult.rows.length === 0) {
      setMessage("Add at least one stop before saving.");
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
      distance,
      durationMinutes: Number(durationMinutes) || 0,
      isFavorite: route?.isFavorite ?? false,
    };
  }

  function handleSave(nextStatus: RouteStatus = status) {
    const meta = buildMeta(nextStatus);
    if (!meta) return;
    const built = buildRouteFromRows(parseResult.rows, meta);
    setStatus(nextStatus);
    setMessage("Saved.");
    onSave(built, stepsText);
  }

  function handleToggleActive() {
    handleSave(status === "active" ? "inactive" : "active");
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

      <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5 text-left">
        <span className={labelClass}>Stops</span>
        <textarea
          className={`${inputClass} mt-1 h-48 font-mono text-sm`}
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
          placeholder={STEPS_PLACEHOLDER}
        />

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

        <button
          type="button"
          onClick={() => setShowValidation(true)}
          className="btn-glossy font-heading mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-2.5 text-base font-semibold text-zinc-900"
        >
          Validate Stops
        </button>

        {showValidation && (
          <div className="mt-3">
            {missingRequired.length > 0 ? (
              <p className="text-sm text-red-600">
                Missing required column{missingRequired.length === 1 ? "" : "s"}:{" "}
                {missingRequired.join(", ")}
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold text-zinc-700">
                  {counts.resolved} resolved, {counts.unresolved} need attention, {counts.skipped}{" "}
                  skipped ({counts.total} total)
                </p>
                <div className="mt-1 max-h-56 divide-y divide-zinc-200 overflow-y-auto">
                  {resolutionRows.map((row) => (
                    <ResolutionRow key={row.stepId} row={row} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {message && <p className="text-sm text-zinc-500">{message}</p>}

      <div className="flex w-full max-w-md flex-col gap-2">
        <button
          type="button"
          onClick={() => handleSave()}
          className="btn-glossy font-heading flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-lg font-bold text-white"
        >
          Save
        </button>

        {mode === "edit" &&
          (canToggleActive ? (
            <button
              type="button"
              onClick={handleToggleActive}
              className="btn-glossy font-heading flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-500 bg-zinc-300 py-3 text-base font-semibold text-zinc-900"
            >
              {status === "active" ? "Make Inactive" : "Make Active"}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 py-3 text-sm font-semibold text-amber-700">
              <WarningIcon className="h-5 w-5 shrink-0" />
              {parseResult.rows.length === 0
                ? "Add stops before this route can go active."
                : `Can't go active yet - ${counts.unresolved} stop${counts.unresolved === 1 ? "" : "s"} still need${counts.unresolved === 1 ? "s" : ""} geocoding.`}
            </div>
          ))}
      </div>
    </div>
  );
}
