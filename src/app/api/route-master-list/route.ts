import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { SchoolLevelDb, TripTypeDb } from "@prisma/client";

/**
 * Regenerates route-master-list.csv's exact tab-separated schema
 * (route_id, route_number, bus_number, am_pm, school_type, school_name,
 * start_time, end_time, stop_count, rider_count, status), plus one
 * column the district's real sheet never had - next_route_id, this
 * route's own addition, carrying EditRouteScreen's "Next Action" field
 * (Route.nextRouteId) through to parseRouteMasterList.ts the same way
 * every other real column already does - from Postgres. page.tsx
 * fetches this instead of the static file now, and hands the response
 * straight to that same parser, so this route's only job is to produce
 * text it still recognizes.
 *
 * stop_count/rider_count are recomputed from each route's own steps
 * (rather than stored) purely so this text stays informative to a
 * human reading it directly - parseRouteMasterList.ts ignores both
 * columns already (see its own doc comment on why: the app derives
 * both, live, from the steps sheet itself).
 */

const LEVEL_TO_SCHOOL_TYPE: Record<SchoolLevelDb, string> = {
  elementary: "EL",
  middle: "MS",
  high: "HS",
};

const TRIP_TYPE_TO_AM_PM: Record<TripTypeDb, string> = {
  pickup: "AM",
  dropoff: "PM",
  fieldtrip: "FT",
};

export async function GET(): Promise<NextResponse> {
  const routes = await prisma.route.findMany({
    include: { steps: true },
    orderBy: { id: "asc" },
  });

  const header = [
    "route_id",
    "route_number",
    "bus_number",
    "am_pm",
    "school_type",
    "school_name",
    "start_time",
    "end_time",
    "stop_count",
    "rider_count",
    "status",
    "next_route_id",
  ].join("\t");

  const lines = routes.map((route) => {
    const stopSteps = route.steps.filter((step) => step.action.toLowerCase() === "stop");
    const riderCount = stopSteps.reduce((sum, step) => sum + (Number(step.riderCount) || 0), 0);
    return [
      route.id,
      route.routeNumber,
      route.busNumber,
      TRIP_TYPE_TO_AM_PM[route.tripType],
      LEVEL_TO_SCHOOL_TYPE[route.schoolLevel],
      route.schoolName,
      route.startTime,
      route.endTime ?? "",
      stopSteps.length || "",
      riderCount || "",
      route.status,
      route.nextRouteId ?? "",
    ].join("\t");
  });

  return new NextResponse([header, ...lines].join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
