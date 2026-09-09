import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { MasterListRoute } from "@/lib/parseRouteMasterList";
import { tripTypeFullLabel } from "@/lib/tripType";
import { durationBetween24HourTimes, format24HourAsAmPm } from "@/lib/time";

/**
 * Every route's own metadata, straight from Postgres as real
 * MasterListRoute objects - route_id/route_number/bus_number/am_pm/
 * school_type/school_name/start_time/end_time/status was the district's
 * original tab-separated master list's own schema (see
 * parseRouteMasterList.ts, kept for prisma/seed.ts's own real read of
 * that file at import time); this is the same data, already typed and
 * shaped the way page.tsx actually consumes it, rather than a CSV-text
 * response it immediately re-parses back into this exact shape. Route's
 * own tripType/schoolLevel columns are already exactly SchoolLevel/
 * TripType (see prisma/schema.prisma's SchoolLevelDb/TripTypeDb), so
 * there's no am_pm/school_type letter-code round-trip needed here
 * either - stop_count/rider_count don't appear at all, same as
 * MasterListRoute never carried them (the app derives both, live, from
 * each route's own steps).
 */
export async function GET(): Promise<NextResponse> {
  const routes = await prisma.route.findMany({ orderBy: { id: "asc" } });

  const rows: MasterListRoute[] = routes.map((route) => ({
    id: route.id,
    status: route.status,
    routeNumber: route.routeNumber,
    name: `${route.schoolName} — ${tripTypeFullLabel(route.tripType)}`,
    busNumber: route.busNumber,
    schoolName: route.schoolName,
    schoolLevel: route.schoolLevel,
    tripType: route.tripType,
    departureTime: format24HourAsAmPm(route.startTime),
    durationMinutes: route.endTime ? durationBetween24HourTimes(route.startTime, route.endTime) : undefined,
    nextRouteId: route.nextRouteId,
  }));

  return NextResponse.json(rows);
}
