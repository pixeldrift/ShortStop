/**
 * Parses the tab-separated schools sheet (school_name, address - one
 * header row plus one row per school) into a lookup by school name,
 * for merging into route metadata alongside whatever the master list
 * and each route's own steps CSV provide (see page.tsx and
 * scripts/geocodeRoute.ts). Just a name/address pair for now - more
 * columns (a school_id, grade range, whatever else a real district
 * roster needs) can grow this sheet later without changing how
 * existing callers read it, the same way route-master-list.csv grew
 * past its own first few columns.
 */
export function parseSchoolsCsv(csvText: string): Record<string, string> {
  const [headerLine, ...dataLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split("\t").map((h) => h.trim());

  const addresses: Record<string, string> = {};
  for (const line of dataLines) {
    if (!line.trim()) continue;
    const values = line.split("\t").map((v) => v.trim());
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    addresses[row.school_name] = row.address;
  }
  return addresses;
}
