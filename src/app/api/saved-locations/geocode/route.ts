import { NextResponse } from "next/server";
import { geocodeSavedLocationAddress } from "@/lib/savedLocations";

/**
 * A preview-only geocode for EditSavedLocationModal's own Fetch
 * (globe) button - resolves an address to lat/lon without touching the
 * database, the same "look, don't persist yet" split
 * StepRowEditor's own Fetch has for a route waypoint (that one lands
 * in the shared waypoint cache; this one has nothing to land in until
 * the modal's own Save actually runs). Reuses the exact same
 * geocodeSavedLocationAddress helper /api/saved-locations's POST calls
 * for a brand-new location's own auto-geocode.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { address?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = body.address?.trim();
  if (!address) {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }

  const result = await geocodeSavedLocationAddress(address);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result);
}
