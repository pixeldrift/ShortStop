import type { NavigationStep, Route } from "./types";

export interface RouteMeta {
  name: string;
  routeNumber: string;
  driverName: string;
  busNumber: string;
  departureTime: string;
}

function parseCsvLine(line: string): string[] {
  // This dataset has no quoted or comma-containing fields, so a plain
  // split is enough - swap for a real CSV parser if that changes.
  return line.split(",").map((cell) => cell.trim());
}

/**
 * Turns the doc's proposed CSV schema
 * (sequence,time,action,from_at,onto_at,rider_count,notes) into route
 * steps. Built for the real Bus 125 route sheet, which only records
 * turn-by-turn directions and stop locations - no student counts or
 * special instructions yet, so those fields come through empty.
 */
export function parseRouteCsv(csvText: string, meta: RouteMeta): Route {
  const [, ...rows] = csvText.trim().split(/\r?\n/); // drop header row

  const steps: NavigationStep[] = rows
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const [, , action, fromAt, ontoAt, riderCount, notes] = parseCsvLine(line);
      const studentCount = riderCount ? Number(riderCount) : undefined;
      const specialInstruction = notes || undefined;

      if (action.toLowerCase() === "stop") {
        const subheading = ontoAt ? `${fromAt} & ${ontoAt}` : fromAt;
        return {
          id: index,
          kind: "stop",
          subheading,
          studentCount,
          specialInstruction,
          announcement: `Stop at ${subheading}.`,
        };
      }

      // A handful of rows only give one road name (e.g. "Left,
      // Riverwood Ln", onto_at blank) - shorthand from the source route
      // sheet for "turn onto this road" rather than a from/onto pair.
      // Treat a lone value as the turn's destination either way.
      const destination = ontoAt || fromAt;
      const announcement =
        ontoAt && fromAt
          ? `Turn ${action.toLowerCase()} from ${fromAt} onto ${ontoAt}.`
          : `Turn ${action.toLowerCase()} onto ${destination}.`;

      return {
        id: index,
        kind: "turn",
        heading: `TURN ${action.toUpperCase()}`,
        subheading: destination,
        specialInstruction,
        announcement,
      };
    });

  return { ...meta, steps };
}
