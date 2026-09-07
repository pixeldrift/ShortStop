import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Regenerates one route's steps sheet - the tab-separated schema
 * parseRouteCsvRows already auto-detects (time, action, from_at,
 * onto_at, rider_count, side, notes) - from Postgres. page.tsx fetches
 * this per route id instead of the old hardcoded
 * ROUTE_STEPS_CSV_PATHS map of static files; a route id with no steps
 * committed yet comes back 404, same "skip it" case that map's own
 * missing entries used to be.
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

  const header = ["time", "action", "from_at", "onto_at", "rider_count", "side", "notes", "skip"].join("\t");
  const lines = route.steps.map((step) =>
    [
      "",
      step.action,
      step.fromAt,
      step.ontoAt,
      step.riderCount,
      step.side,
      step.notes,
      step.skip ? "true" : "false",
    ].join("\t"),
  );

  return new NextResponse([header, ...lines].join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
