import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { SavedLocationInfo } from "@/lib/savedLocations";

interface UpdateSavedLocationBody {
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Updates a saved location in place - EditSavedLocationModal's own
 * Save button (EditRouteScreen.tsx), opened from the address book's
 * pencil icon. Unlike POST /api/saved-locations, this never geocodes
 * server-side: lat/lon come straight from the modal's own coordinates
 * box, which the admin fills in via that same box's Fetch (a preview
 * call to /api/saved-locations/geocode) or Place (a manually dropped
 * pin) buttons before Save ever runs - the same "resolve client-side,
 * persist whatever's in the box" split StepRowEditor's own
 * onManualCoordinates already uses for a route waypoint.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid location id." }, { status: 400 });
  }

  let body: UpdateSavedLocationBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  const address = body.address?.trim();
  if (!name || !address) {
    return NextResponse.json({ error: "Both name and address are required." }, { status: 400 });
  }

  try {
    const updated = await prisma.savedLocation.update({
      where: { id },
      data: { name, address, lat: body.lat ?? null, lon: body.lon ?? null },
    });
    const responseBody: SavedLocationInfo = updated;
    return NextResponse.json(responseBody);
  } catch (err) {
    const message =
      err instanceof Error && "code" in err && err.code === "P2002"
        ? `A saved location named "${name}" already exists.`
        : err instanceof Error && "code" in err && err.code === "P2025"
          ? "This saved location no longer exists."
          : err instanceof Error
            ? err.message
            : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
