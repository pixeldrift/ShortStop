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
