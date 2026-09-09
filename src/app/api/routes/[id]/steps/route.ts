import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { RawRouteRow } from "@/lib/parseRouteCsv";

/**
 * One route's own turn-by-turn steps, straight from Postgres - real
 * RawRouteRow objects, not the tab-separated steps-sheet text every
 * real district route sheet used to arrive as (see parseRouteImport.ts
 * for where that format still belongs - a human pasting/uploading a
 * sheet, not this app's own data plumbing). page.tsx fetches this per
 * route id; a route id with no steps committed yet comes back 404, same
 * "skip it" case a missing sidecar file used to be.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const route = await prisma.route.findUnique({
    where: { id },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!route || route.steps.length === 0) {
    return NextResponse.json({ error: `No steps sheet for route "${id}".` }, { status: 404 });
  }

  const steps: RawRouteRow[] = route.steps.map((step) => ({
    action: step.action,
    fromAt: step.fromAt,
    ontoAt: step.ontoAt,
    riderCount: step.riderCount,
    side: step.side,
    notes: step.notes,
    skip: step.skip,
  }));

  return NextResponse.json(steps);
}
