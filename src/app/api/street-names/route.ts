import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractStreetNames } from "@/lib/streetNames";

/**
 * Every distinct road name this app already has a resolved coordinate
 * for, anywhere in the district - not a live map/geocoder search, just
 * what's already been geocoded and cached (see the Waypoint model's own
 * `status: "ok"` rows, the same table /api/waypoints itself reads).
 * Feeds StepRowEditor's own Location field suggestions - a quick way to
 * reuse a road this route (or any other route in the system) has
 * already resolved, spelled exactly the way it resolved before, rather
 * than retyping it from memory and risking a fresh typo landing in a
 * brand-new, unresolved cache entry.
 */
export async function GET(): Promise<NextResponse> {
  const rows = await prisma.waypoint.findMany({
    where: { status: "ok" },
    select: { cacheKey: true },
  });
  const streetNames = extractStreetNames(rows.map((row) => row.cacheKey));
  return NextResponse.json(streetNames);
}
