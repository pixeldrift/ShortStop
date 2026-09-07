import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { formatAddress } from "@/lib/schoolAddress";

/**
 * Regenerates schools.csv's exact tab-separated schema (school_name,
 * address, school_level) from Postgres - page.tsx fetches this instead
 * of the static file now, and hands the response straight to the same
 * parseSchoolsCsv.ts it always has, unchanged.
 */
export async function GET(): Promise<NextResponse> {
  const schools = await prisma.school.findMany({ orderBy: { name: "asc" } });

  const header = ["school_name", "address", "school_level"].join("\t");
  const lines = schools.map((school) => [school.name, formatAddress(school), school.level].join("\t"));

  return new NextResponse([header, ...lines].join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
