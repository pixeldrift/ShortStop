import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { RawRouteRow } from "@/lib/parseRouteCsv";
import type { RouteStatus, SchoolLevel, TripType } from "@/lib/types";

/**
 * The real persistence EditRouteScreen.tsx's Save button never had
 * before - its own onSave only ever updated page.tsx's in-memory
 * admin-route overlay (see that screen's own former "Session-only for
 * now" doc comment), so an edited school, status, or stops list looked
 * saved but was gone on the next real page load. Upserts the route's
 * own row and replaces its RouteSteps from the currently-edited rows,
 * the same shape prisma/seed.ts already loads from each route's own
 * steps CSV.
 */

interface SaveRouteRequestBody {
  id: string;
  /** The route's id *before* this edit, if it already existed - only
   * different from `id` when routeNumber/tripType/schoolLevel changed
   * (Route.id's own `${routeNumber}-${tripType}-${schoolLevel}`
   * convention - see types.ts), which happens whenever an admin
   * corrects, say, a route's school level. Deleted (cascading to its
   * own RouteSteps) so that edit doesn't leave the old row behind as
   * an orphan under its old id. Omitted/null for a brand-new route. */
  previousId?: string | null;
  // Not RouteStatus - "demo" is a client-only concept (a fabricated
  // filler route, see demoRoutes.ts) that never gets a database row at
  // all, and page.tsx's own handleSaveRoute already short-circuits
  // before ever calling this for one. Typed narrower here (and checked
  // below) since this is a real request boundary, not a call this
  // module controls both ends of.
  status: Exclude<RouteStatus, "demo">;
  routeNumber: string;
  busNumber: string;
  schoolName: string;
  schoolLevel: SchoolLevel;
  tripType: TripType;
  /** Whatever the admin typed in the Departure Time field, as-is - not
   * necessarily the strict 24-hour text real district sheets use (see
   * Route.startTime's own doc in schema.prisma), same "no real editing
   * for this yet" honesty already true of endTime below. Round-trips
   * fine either way: parseRouteMasterList's format24HourAsAmPm passes
   * an already-"H:MM AM/PM" string through unchanged. */
  startTime: string;
  /** EditRouteScreen's own "Next Action" field - another route's id, or
   * null to end the trip here (see Route.nextRouteId's own doc comment
   * in schema.prisma). The database's own foreign key is what actually
   * guards this - a nonexistent id fails the upsert below outright
   * rather than saving a dangling reference; a *valid* one that's later
   * deleted gets reset to null automatically (ON DELETE SetNull), not
   * left pointing at nothing. */
  nextRouteId: string | null;
  steps: RawRouteRow[];
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: SaveRouteRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    id,
    previousId,
    status,
    routeNumber,
    busNumber,
    schoolName,
    schoolLevel,
    tripType,
    startTime,
    nextRouteId,
    steps,
  } = body;
  // busNumber/schoolName/startTime are deliberately NOT required here -
  // EditRouteScreen's own Save/Create Route already only requires a
  // route number (see its handleSave's own doc comment: "everything
  // else... can genuinely be filled in later"), and readiness for
  // publishing is a separate, later concern (routeReadiness.ts's own
  // geocoding check, gated at Publish time) - a draft stub with
  // nothing but a route number and its stops should always be
  // saveable. id/schoolLevel/tripType/status stay required: the first
  // three are what Route.id itself is built from (see types.ts), and
  // every one of them already has a real, non-blank value from
  // EditRouteScreen's own form controls (a select's own default, never
  // an empty string) whenever this is actually called from the app's
  // own UI - so listing exactly which of these five is missing, on the
  // rare request that isn't, stays genuinely informative rather than a
  // blanket "something's missing" a person has to guess at.
  const missingFields = (
    [
      ["id", id],
      ["routeNumber", routeNumber],
      ["schoolLevel", schoolLevel],
      ["tripType", tripType],
      ["status", status],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingFields.length > 0) {
    return NextResponse.json(
      { error: `Missing required route fields: ${missingFields.join(", ")}.` },
      { status: 400 },
    );
  }
  if (status !== "published" && status !== "draft") {
    return NextResponse.json({ error: `Invalid status "${status}" - must be "published" or "draft".` }, {
      status: 400,
    });
  }
  if (!Array.isArray(steps)) {
    return NextResponse.json({ error: "steps must be an array." }, { status: 400 });
  }

  if (previousId && previousId !== id) {
    // Never a real error even if it's already gone (a double-submit,
    // or the id simply never existed yet) - the goal ("no row left
    // behind under the old id") is already satisfied either way.
    await prisma.route.delete({ where: { id: previousId } }).catch(() => {});
  }

  await prisma.route.upsert({
    where: { id },
    create: { id, status, routeNumber, busNumber, schoolName, schoolLevel, tripType, startTime, nextRouteId },
    update: { status, routeNumber, busNumber, schoolName, schoolLevel, tripType, startTime, nextRouteId },
  });

  // Replace-all rather than a per-row diff/update - same reasoning as
  // prisma/seed.ts's own steps loading: a steps list is edited as a
  // whole ordered sequence, not row-by-row against stable identities,
  // so there's no meaningful "this existing row changed" to diff
  // against, only "here's the current full list."
  await prisma.routeStep.deleteMany({ where: { routeId: id } });
  if (steps.length > 0) {
    await prisma.routeStep.createMany({
      data: steps.map((row, sequence) => ({
        routeId: id,
        sequence,
        action: row.action,
        fromAt: row.fromAt,
        ontoAt: row.ontoAt,
        riderCount: row.riderCount,
        side: row.side,
        notes: row.notes,
        skip: row.skip,
      })),
    });
  }

  return NextResponse.json({ ok: true });
}
