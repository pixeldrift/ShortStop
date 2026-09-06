import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { WaypointCache, WaypointCacheEntry } from "@/lib/waypointCache";

/**
 * The geocode cache, backed by Postgres now instead of each route's
 * own committed *-waypoints.json sidecar file - GET returns the whole
 * cache (routeReadiness.ts, StepScreen.tsx and EditRouteScreen.tsx all
 * just look entries up by key locally, same as they did against a
 * fetched JSON file, so one shared table serving the full cache is a
 * drop-in replacement). POST is the real persistence EditRouteScreen's
 * "Fetch Location"/"Fetch All Locations" never had before (see its own
 * former "Download Coordinates" stopgap) - called right after a
 * successful /api/geocode lookup so a resolved coordinate is saved for
 * every future load, not just this session's.
 */

function toEntry(row: {
  status: string;
  lat: number | null;
  lon: number | null;
  displayName: string | null;
  source: string;
  provider: string;
  message: string | null;
  raw: string | null;
}): WaypointCacheEntry {
  if (row.status === "ok" && row.lat != null && row.lon != null && row.displayName != null) {
    return {
      status: "ok",
      lat: row.lat,
      lon: row.lon,
      displayName: row.displayName,
      source: row.source,
      provider: row.provider,
    };
  }
  return {
    status: "error",
    message: row.message ?? "",
    raw: row.raw ?? undefined,
    source: row.source,
    provider: row.provider,
  };
}

export async function GET(): Promise<NextResponse> {
  const rows = await prisma.waypoint.findMany();
  const cache: WaypointCache = Object.fromEntries(rows.map((row) => [row.cacheKey, toEntry(row)]));
  return NextResponse.json(cache);
}

interface WaypointPostBody {
  key: string;
  entry: WaypointCacheEntry;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: WaypointPostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.key || !body.entry) {
    return NextResponse.json({ error: "key and entry are required." }, { status: 400 });
  }

  // Only "ok" entries are worth persisting - same rule
  // waypointCacheKey.ts documents for the old per-route sidecar files:
  // a failure almost always means the query wording needs fixing, so
  // it should be retried next load rather than cached as a permanent
  // miss.
  if (body.entry.status !== "ok") {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const { key, entry } = body;
  await prisma.waypoint.upsert({
    where: { cacheKey: key },
    create: {
      cacheKey: key,
      status: entry.status,
      lat: entry.lat,
      lon: entry.lon,
      displayName: entry.displayName,
      source: entry.source,
      provider: entry.provider,
    },
    update: {
      status: entry.status,
      lat: entry.lat,
      lon: entry.lon,
      displayName: entry.displayName,
      source: entry.source,
      provider: entry.provider,
      message: null,
      raw: null,
    },
  });

  return NextResponse.json({ ok: true, persisted: true });
}
