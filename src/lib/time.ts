import type { TripType } from "./types";

// Hour, optional ":MM", optional further ":SS", optional trailing
// whitespace + AM/PM (with or without periods, either case) - loose
// enough to accept "7:30 AM", "7:30am", "07:30", "19:00", "7:30:15",
// and a bare "7 AM", but still requires the whole string to match (no
// leftover characters), so something like "730am" (no colon) or plain
// garbage correctly fails rather than being half-parsed.
const TIME_INPUT_PATTERN =
  /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?$/;

/** Best-effort parse of whatever an admin actually typed into a Start
 * Time field into a strict 24-hour "HH:MM:SS" string - the one shape
 * this app now writes back to Route.startTime (see schema.prisma's own
 * doc comment: a real district sheet can still arrive as "H:MM", but
 * nothing this app itself saves should keep passing whatever shape a
 * person happened to type straight through unstandardized). Returns
 * null for anything that doesn't parse at all, so a caller can reject
 * it outright rather than silently saving garbage.
 *
 * An hour with no AM/PM and no other way to tell (1-11) is genuinely
 * ambiguous on its own - "3:15" could mean either 3:15 AM or 3:15 PM -
 * so this takes an optional `tripTypeHint` ("dropoff" leans PM,
 * anything else - "pickup" included - leaves the hour exactly as
 * typed, i.e. treated as already 24-hour) the same morning/afternoon
 * bias fillStartTimes.ts's own random fallback already uses. An hour
 * of 12-23 (or 0) is never ambiguous either way and is always left
 * alone. */
export function parseTimeInput(
  input: string,
  tripTypeHint?: TripType,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(TIME_INPUT_PATTERN);
  if (!match) return null;

  const [, hourStr, minuteStr = "00", secondStr = "00", periodRaw] = match;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const second = parseInt(secondStr, 10);
  if (minute > 59 || second > 59) return null;

  const period = periodRaw?.trim().charAt(0).toLowerCase();
  if (period === "a" || period === "p") {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (period === "p" ? 12 : 0);
  } else {
    if (hour > 23) return null;
    if (hour >= 1 && hour <= 11 && tripTypeHint === "dropoff") hour += 12;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

/** Adds minutes to a "H:MM AM/PM" string, wrapping across midnight.
 * Returns the input unchanged if it doesn't match that format. */
export function addMinutesToTimeString(timeStr: string, minutes: number): string {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return timeStr;

  const [, hourStr, minuteStr, period] = match;
  const hour24 = (parseInt(hourStr, 10) % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
  const totalMinutes = hour24 * 60 + parseInt(minuteStr, 10) + minutes;
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;

  const outHour24 = Math.floor(wrapped / 60);
  const outMinute = wrapped % 60;
  const outPeriod = outHour24 >= 12 ? "PM" : "AM";
  const outHour12 = outHour24 % 12 === 0 ? 12 : outHour24 % 12;

  return `${outHour12}:${String(outMinute).padStart(2, "0")} ${outPeriod}`;
}

/** Parses a "H:MM AM/PM" string into minutes since midnight, for sorting
 * a list of times chronologically. Unparseable input sorts last. */
export function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Infinity;

  const [, hourStr, minuteStr, period] = match;
  const hour24 = (parseInt(hourStr, 10) % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
  return hour24 * 60 + parseInt(minuteStr, 10);
}

/** Parses a 24-hour "H:MM" or "H:MM:SS" string (seconds discarded) into
 * minutes since midnight - the route-sheet counterpart to
 * parseTimeToMinutes's 12-hour AM/PM strings (route sheets record
 * start_time/end_time in 24-hour clock, not AM/PM). Unparseable input
 * sorts last, same convention. */
export function parse24HourTimeToMinutes(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return Infinity;

  const [, hourStr, minuteStr] = match;
  return parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
}

/** Formats a 24-hour "H:MM" or "H:MM:SS" string as "H:MM AM/PM". Returns
 * the input unchanged if it doesn't match either format. */
export function format24HourAsAmPm(time: string): string {
  const minutes = parse24HourTimeToMinutes(time);
  if (minutes === Infinity) return time;

  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** Minutes between two 24-hour "H:MM"/"H:MM:SS" times, wrapping across
 * midnight the same way addMinutesToTimeString does. */
export function durationBetween24HourTimes(startTime: string, endTime: string): number {
  const start = parse24HourTimeToMinutes(startTime);
  const end = parse24HourTimeToMinutes(endTime);
  return (((end - start) % 1440) + 1440) % 1440;
}
