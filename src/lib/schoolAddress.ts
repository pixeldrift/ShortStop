/** One school's address, split into its component parts - the shape
 * the schools table itself stores now (street/city/state/zip columns,
 * rather than one combined string), matching every school's own
 * schools.csv row today ("{street}, {city}, {ST} {zip}"), which is
 * where parseAddress's own regex comes from. */
export interface SchoolAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

const ADDRESS_PATTERN = /^(.+),\s*(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/;

/** Splits a combined "{street}, {city}, {ST} {zip}" address (schools.csv's
 * own column format) into its parts - prisma/seed.ts's own use, at
 * import time, to populate the schools table's separate columns. */
export function parseAddress(address: string): SchoolAddress {
  const match = address.trim().match(ADDRESS_PATTERN);
  if (!match) {
    throw new Error(`Address doesn't match "street, city, ST zip": "${address}"`);
  }
  const [, street, city, state, zip] = match;
  return { street: street.trim(), city: city.trim(), state, zip };
}

/** The inverse of parseAddress - joins the schools table's own columns
 * back into the one combined address string every geocoding call and
 * every existing consumer of SchoolInfo.address (parseSchoolsCsv.ts)
 * already expects, so src/app/api/schools/route.ts's own wire format
 * stays exactly what it always has been. */
export function formatAddress({ street, city, state, zip }: SchoolAddress): string {
  return `${street}, ${city}, ${state} ${zip}`;
}

/** Same address, minus the trailing ZIP - display-only contexts
 * (StepScreen's "Ready to Depart", StartScreen's route summary) don't
 * need it, and dropping it leaves the line a little shorter for no real
 * loss of information. A plain trailing-digits regex rather than a full
 * parseAddress round-trip - not every address this sees is guaranteed to
 * match schools.csv's strict "street, city, ST zip" shape (a route's own
 * fabricated demo `schoolAddress` might not), so anything that doesn't
 * end in a ZIP just passes through unchanged instead of throwing. */
export function addressWithoutZip(address: string): string {
  return address.replace(/,?\s*\d{5}(-\d{4})?\s*$/, "");
}
