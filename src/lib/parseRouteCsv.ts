import { speakRoadNames } from "./speech";
import type { NavigationStep, Route, TripType, TurnDirection } from "./types";

export interface RouteMeta {
  name: string;
  routeNumber: string;
  driverName: string;
  busNumber: string;
  departureTime: string;
  tripType: TripType;
  distance: string;
  durationMinutes: number;
}

function parseCsvLine(line: string): string[] {
  // This dataset has no quoted or comma-containing fields, so a plain
  // split is enough - swap for a real CSV parser if that changes.
  return line.split(",").map((cell) => cell.trim());
}

/**
 * Turns the doc's proposed CSV schema
 * (sequence,time,action,from_at,onto_at,rider_count,side,notes) into route
 * steps. Built for the real Bus 125 route sheet, which only records
 * turn-by-turn directions and stop locations - no times or special
 * instructions yet, so those fields come through empty.
 */
export function parseRouteCsv(csvText: string, meta: RouteMeta): Route {
  const [, ...rows] = csvText.trim().split(/\r?\n/); // drop header row
  let stopCounter = 0;

  const steps: NavigationStep[] = rows
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const [, , action, fromAt, ontoAt, riderCount, side, notes] = parseCsvLine(line);
      const studentCount = riderCount ? Number(riderCount) : undefined;
      const sideOfRoad = side || undefined;
      const specialInstruction = notes || undefined;

      if (action.toLowerCase() === "stop") {
        stopCounter += 1;
        const subheading = ontoAt ? `${fromAt} & ${ontoAt}` : fromAt;

        // Spoken as separate parts - stop number, then location, then
        // side of the road, then rider count - so there's a clear pause
        // between each rather than one long sentence.
        const announcement = [`Stop ${stopCounter}.`, `${speakRoadNames(subheading)}.`];
        if (sideOfRoad) {
          announcement.push(`On the ${sideOfRoad.toLowerCase()}.`);
        }
        if (studentCount != null) {
          announcement.push(`${studentCount} rider${studentCount === 1 ? "" : "s"} expected.`);
        }

        return {
          id: index,
          kind: "stop",
          subheading,
          studentCount,
          sideOfRoad,
          specialInstruction,
          announcement,
        };
      }

      // A handful of rows only give one road name (e.g. "Left,
      // Riverwood Ln", onto_at blank) - shorthand from the source route
      // sheet for "turn onto this road" rather than a from/onto pair.
      // Treat a lone value as the turn's destination either way.
      const destination = ontoAt || fromAt;
      const spokenAnnouncement =
        ontoAt && fromAt
          ? `Turn ${action.toLowerCase()} from ${speakRoadNames(fromAt)} onto ${speakRoadNames(ontoAt)}.`
          : `Turn ${action.toLowerCase()} onto ${speakRoadNames(destination)}.`;
      const direction: TurnDirection | undefined =
        action.toLowerCase() === "left"
          ? "left"
          : action.toLowerCase() === "right"
            ? "right"
            : undefined;

      return {
        id: index,
        kind: "turn",
        direction,
        heading: `TURN ${action.toUpperCase()}`,
        subheading: destination,
        specialInstruction,
        announcement: [spokenAnnouncement],
      };
    });

  return { ...meta, steps };
}
