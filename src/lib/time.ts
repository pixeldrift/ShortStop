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
