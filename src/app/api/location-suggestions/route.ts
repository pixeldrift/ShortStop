import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractLocationSuggestions } from "@/lib/locationSuggestions";

/**
 * Every location this app already has a resolved coordinate for,
 * anywhere in the district - not a live map/geocoder search, just what's
 * already been geocoded and cached (see the Waypoint model's own
 * `status: "ok"` rows, the same table /api/waypoints itself reads).
 * Feeds StepRowEditor's own Location field suggestions, alongside every
 * School and SavedLocation name (EditRouteScreen already has both of
 * those loaded, so this only covers what neither of those two lists
 * would - a road name, a business name, anything else that's been
 * successfully typed and geocoded before) - a quick way to reuse a road
 * this route (or any other route in the system) has already resolved,
 * rather than retyping it from memory and risking a fresh typo landing
 * in a brand-new, unresolved cache entry. See extractLocationSuggestions'
 * own doc comment for why a house-numbered address suggests as just its
 * road name, not the exact address it was originally typed as.
 */
export async function GET(): Promise<NextResponse> {
  const rows = await prisma.waypoint.findMany({
    where: { status: "ok" },
    select: { cacheKey: true },
  });
  const suggestions = extractLocationSuggestions(rows.map((row) => row.cacheKey));
  return NextResponse.json(suggestions);
}
