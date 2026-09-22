import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { RawRouteRow } from "@/lib/parseRouteCsv";

/**
 * Every route's own steps, straight from Postgres, all in one query -
 * page.tsx's initial load used to fire one `/api/routes/[id]/steps`
 * request per route instead (`Promise.all(allRows.map(...))`), which
 * meant one Neon connection/serverless invocation per route, all at
 * once, on every single page load. With enough real routes seeded,
 * that fan-out routinely outran Neon's pooled connection limit - some
 * of those requests just queued forever waiting for a free connection,
 * with nothing to time out and surface as a real error, so the app
 * looked permanently stuck loading rather than failing outright. One
 * request here means one query, no matter how many routes exist.
 *
 * Grouped by routeId, in each route's own step order - a route with no
 * steps committed yet is simply missing its own key, same "skip it"
 * case `/api/routes/[id]/steps`'s own 404 already was for.
 */
export async function GET(): Promise<NextResponse> {
  const allSteps = await prisma.routeStep.findMany({
    orderBy: [{ routeId: "asc" }, { sequence: "asc" }],
  });

  const byRouteId: Record<string, RawRouteRow[]> = {};
  for (const step of allSteps) {
    (byRouteId[step.routeId] ??= []).push({
      action: step.action,
      location: step.location,
      fromLocation: step.fromLocation,
      riderCount: step.riderCount,
      side: step.side,
      notes: step.notes,
      skip: step.skip,
      overrideLat: step.overrideLat,
      overrideLon: step.overrideLon,
    });
  }

  return NextResponse.json(byRouteId);
}
