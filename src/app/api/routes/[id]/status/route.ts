import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Just a route's own published/draft flag - the endpoint
 * RouteListScreen's own quick Activate/Deactivate actions (the eyeball
 * toggle and its confirm modals) call, as opposed to the full `/api/routes`
 * POST every *edited* field goes through from EditRouteScreen's Save.
 * Those two actions never touch anything else about the route (steps
 * included), so this only ever writes the one column rather than
 * requiring every other required field `/api/routes` POST does, and
 * never replaces RouteSteps the way that upsert's own "replace-all"
 * write does - see page.tsx's handleSetRouteStatus for the client side
 * of this, which is exactly what page.tsx's own local-only status
 * overlay never actually persisted before this route existed.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { status } = body;
  if (status !== "published" && status !== "draft") {
    return NextResponse.json(
      { error: `Invalid status "${String(status)}" - must be "published" or "draft".` },
      { status: 400 },
    );
  }

  try {
    await prisma.route.update({ where: { id }, data: { status } });
  } catch {
    return NextResponse.json({ error: `No route "${id}".` }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
