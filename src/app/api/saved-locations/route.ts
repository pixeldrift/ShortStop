import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { geocodeSavedLocationAddress } from "@/lib/savedLocations";
import type { SavedLocationInfo } from "@/lib/savedLocations";

/**
 * Every saved location, straight from Postgres - StepRowEditor's own
 * address-book popup (EditRouteScreen.tsx) fetches this once per edit
 * session, the same "fetch on mount" pattern page.tsx already uses for
 * schools. Sorted by name so the popup's own list doesn't need to sort
 * it again.
 */
export async function GET(): Promise<NextResponse> {
  const locations = await prisma.savedLocation.findMany({ orderBy: { name: "asc" } });
  const body: SavedLocationInfo[] = locations;
  return NextResponse.json(body);
}

interface CreateSavedLocationBody {
  name: string;
  address: string;
  /** Already resolved client-side (EditSavedLocationModal's own Fetch/
   * Place buttons) - when both are present, this skips the server-side
   * auto-geocode entirely and saves exactly this point, the same
   * "trust what's already in the box" rule PATCH .../[id] always
   * follows. Omitted (the plain "type name+address, hit Save" path)
   * still auto-geocodes below, same as this endpoint always has. */
  lat?: number | null;
  lon?: number | null;
}

/**
 * Creates a new saved location. When the caller already resolved a
 * point client-side (EditSavedLocationModal's own Fetch/Place
 * buttons), this just saves it as given - otherwise it geocodes the
 * address immediately server-side (same ORS pipeline every other
 * address in this app resolves through - resolveWaypoint.ts's
 * lookupCoordinates), so a location added without touching the
 * coordinates box still comes out already resolved rather than needing
 * a separate fetch afterward. A geocode failure still creates the row
 * (lat/lon stay null, same as an ungeocoded School) rather than losing
 * the name/address someone just typed in - nothing prevents fixing the
 * address and trying again later.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: CreateSavedLocationBody;
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

  let lat: number | null;
  let lon: number | null;
  if (body.lat != null && body.lon != null) {
    lat = body.lat;
    lon = body.lon;
  } else {
    const geocoded = await geocodeSavedLocationAddress(address);
    lat = "error" in geocoded ? null : geocoded.lat;
    lon = "error" in geocoded ? null : geocoded.lon;
  }

  try {
    const created = await prisma.savedLocation.create({ data: { name, address, lat, lon } });
    const responseBody: SavedLocationInfo = created;
    return NextResponse.json(responseBody);
  } catch (err) {
    // Prisma's own unique-constraint error (P2002) for a repeated name -
    // the one realistic failure here worth a specific message rather
    // than a bare 500.
    const message =
      err instanceof Error && "code" in err && err.code === "P2002"
        ? `A saved location named "${name}" already exists.`
        : err instanceof Error
          ? err.message
          : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
