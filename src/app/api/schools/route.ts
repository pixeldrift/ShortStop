import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { formatAddress } from "@/lib/schoolAddress";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";

/**
 * Every school's own name/address/level/coordinates, straight from
 * Postgres, keyed by name - the same lookup shape page.tsx has always
 * merged into route metadata and handed to EditRouteScreen's school
 * picker, just built here now instead of on the client from a
 * schools.csv-shaped text response (see parseSchoolsCsv.ts, kept for
 * prisma/seed.ts's own real read of that file at import time).
 */
export async function GET(): Promise<NextResponse> {
  const schools = await prisma.school.findMany({ orderBy: { name: "asc" } });

  const table: Record<string, SchoolInfo> = Object.fromEntries(
    schools.map((school) => [
      school.name,
      { address: formatAddress(school), schoolLevel: school.level, lat: school.lat, lon: school.lon },
    ]),
  );

  return NextResponse.json(table);
}
