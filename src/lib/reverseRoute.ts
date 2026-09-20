import type { RawRouteRow } from "./parseRouteCsv";
import type { TripType } from "./types";

/** Left/right swap on reversal isn't a rough guess - it's provably
 * correct for a straight reversal of the same physical path: reversing
 * which way you drive through a turn also reverses its handedness (the
 * same everyday fact behind "take the second right on the way out,
 * second left on the way back"). Every other action - Continue, U-Turn,
 * Turn Around, Proceed, Pull Over, Return, Stop - has no left/right of
 * its own to flip. */
function reverseAction(action: string): string {
  const a = action.trim().toLowerCase();
  if (a === "left") return "Right";
  if (a === "right") return "Left";
  // The route's first row (however it starts) becomes its last once
  // reversed, and vice versa - Depart/Arrive swap to match, the same
  // "still a real row, not the endpoint anymore" logic driving every
  // other field here.
  if (a === "depart") return "Arrive";
  if (a === "arrive" || a === "complete") return "Depart";
  return action;
}

/** Same reasoning as reverseAction - a stop described as being on the
 * right side of the road for a bus traveling one way is on the left for
 * a bus traveling the other. */
function reverseSide(side: string): string {
  const s = side.trim().toLowerCase();
  if (s === "left") return "Right";
  if (s === "right") return "Left";
  return side;
}

/** `location` is a row's own required field - always its real
 * destination road/address, forward-direction terms (see RawRouteRow's
 * own doc comment, parseRouteCsv.ts). `fromLocation` is the optional
 * "coming from" road that pairs with it as an intersection. Reversing
 * which way this row is driven swaps which of the two is the
 * destination - but only when `fromLocation` is actually filled in: a
 * blank one isn't "no road," it's "infer the current road from
 * context," which this function has no way to recompute locally (it
 * only ever sees one row at a time, not the route's own running
 * "current road" state) - so it's left alone rather than guessed at or,
 * worse, swapped into `location` empty. That's this reversal's one real
 * naive spot: a turn row with no explicit `fromLocation` keeps its
 * original `location` even though the correct one, after reversing,
 * is technically whatever road came before it - close enough to review
 * and fix by hand, not something to fake a real answer for here. Real
 * verification against the actual roads (are these turns still legal
 * the other way, is this even still the right road) is a separate,
 * later pass - see the README's own Reverse Route roadmap entry. */
function reverseLocationFields(row: RawRouteRow): Pick<RawRouteRow, "location" | "fromLocation"> {
  if (!row.fromLocation.trim()) {
    return { location: row.location, fromLocation: row.fromLocation };
  }
  return { location: row.fromLocation, fromLocation: row.location };
}

/** A morning pickup route reversed is an afternoon dropoff run (and
 * vice versa) - the whole point of Reverse Route. Field trips/"Other"
 * runs have no inherent forward/back pairing (see TripType's own doc
 * comment, types.ts), so they're left as whatever they already were. */
export function reverseTripType(tripType: TripType): TripType {
  if (tripType === "pickup") return "dropoff";
  if (tripType === "dropoff") return "pickup";
  return tripType;
}

/** Reverses a route's own row order and, row by row, everything about
 * each row that depends on which way it's being driven - see
 * reverseAction/reverseSide/reverseLocationFields above for what each
 * one does and why. A deliberately local, "just the rows" transform -
 * no routing call, no knowledge of the real road network - so the
 * result is always a fast, offline starting point, never a promise that
 * the reversed turns are actually legal/possible to drive. `riderCount`,
 * `notes`, and `skip` carry straight over unchanged; whatever a stop's
 * own rider count or note said, it still says once the route runs the
 * other way. */
export function reverseRouteRows(rows: RawRouteRow[]): RawRouteRow[] {
  return [...rows].reverse().map((row) => ({
    ...row,
    action: reverseAction(row.action),
    ...reverseLocationFields(row),
    side: reverseSide(row.side),
  }));
}
