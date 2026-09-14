import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Deletes one route outright - the endpoint RouteListScreen's own
 * Delete action (the draft-options popup's secondary button) calls, as
 * opposed to the full `/api/routes` POST every *edited* field goes
 * through. See page.tsx's handleDeleteRoute for the client side of
 * this, which used to only ever add the route's id to a session-only
 * `deletedRouteIds` Set - the row disappeared from every screen for the
 * rest of that session (effectiveRealRoutes filters it out), but a
 * later page load re-fetched realRoutes straight from Postgres, which
 * never lost the row, so it silently came back.
 *
 * A plain `prisma.route.delete` is enough on its own: RouteStep rows
 * cascade (schema.prisma's own `onDelete: Cascade`), and any other
 * route whose own `nextRouteId` pointed at this one gets reset to null
 * automatically (`onDelete: SetNull`) rather than left dangling - both
 * already relied on by `/api/routes` POST's own upsert (see that
 * file's `previousId` doc comment).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  try {
    await prisma.route.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: `No route "${id}".` }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
