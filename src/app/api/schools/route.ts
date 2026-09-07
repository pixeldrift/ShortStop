import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { formatAddress } from "@/lib/schoolAddress";

/**
 * Regenerates schools.csv's original tab-separated schema (school_name,
 * address, school_level) from Postgres, plus two columns schools.csv
 * never had - lat/lon, School's own geocoded location (see
 * scripts/geocodeSchools.ts) - blank for a school that hasn't been
 * geocoded yet. page.tsx fetches this instead of the static file now,
 * and hands the response straight to parseSchoolsCsv.ts, which now
 * reads those two new columns too.
 */
export async function GET(): Promise<NextResponse> {
  const schools = await prisma.school.findMany({ orderBy: { name: "asc" } });

  const header = ["school_name", "address", "school_level", "lat", "lon"].join("\t");
  const lines = schools.map((school) =>
    [school.name, formatAddress(school), school.level, school.lat ?? "", school.lon ?? ""].join("\t"),
  );

  return new NextResponse([header, ...lines].join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
