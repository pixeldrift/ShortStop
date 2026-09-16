import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractCityState } from "@/lib/geocode";
import { lookupCoordinates } from "@/lib/resolveWaypoint";
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
}

/**
 * Creates a new saved location and geocodes its address immediately
 * (same ORS pipeline every other address in this app resolves through
 * - resolveWaypoint.ts's lookupCoordinates), so the address-book popup
 * that just created it can offer it as an already-resolved pick right
 * away, not one that still needs its own "Fetch Coordinates" click. A
 * geocode failure still creates the row (lat/lon stay null, same as an
 * ungeocoded School) rather than losing the name/address someone just
 * typed in - nothing prevents fixing the address and trying again
 * later.
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

  const apiKey = process.env.ORS_API_KEY;
  let lat: number | null = null;
  let lon: number | null = null;
  if (apiKey) {
    const locationContext = extractCityState(address) ?? "";
    const result = await lookupCoordinates({ kind: "address", text: address }, locationContext, { apiKey });
    if (result.status === "ok") {
      lat = result.lat;
      lon = result.lon;
    }
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
