/** The city out of a "<street>, <city>, TN <zip>" address (schools.csv/
 * Postgres' `School` table - every real school's address follows this
 * exact three-part shape today) - shared by SchoolListScreen's own City
 * column and RouteListScreen's grouped-view route headers, so both read
 * the same city out of the same address string the same way. */
export function cityFromAddress(address: string): string {
  return address.split(",")[1]?.trim() ?? "";
}

/** Just the street part of an address, for a line under a name where
 * the city's already shown separately - the state/zip are always "TN
 * <zip>" (every real school is Rutherford County, TN), so neither earns
 * a second mention right below where the city already reads. */
export function streetFromAddress(address: string): string {
  return address.split(",")[0]?.trim() ?? address;
}
