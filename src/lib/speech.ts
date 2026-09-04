// Common USPS street-suffix abbreviations, spelled out for speech. Display
// text (subheadings, the CSV itself) keeps the abbreviated form - this is
// audio-only, so a TTS engine doesn't read "Rd" as "rid" or skip it.
const ROAD_ABBREVIATIONS: Record<string, string> = {
  rd: "Road",
  ln: "Lane",
  dr: "Drive",
  st: "Street",
  ave: "Avenue",
  blvd: "Boulevard",
  pkwy: "Parkway",
  hwy: "Highway",
  ct: "Court",
  cir: "Circle",
  pl: "Place",
  trl: "Trail",
  ter: "Terrace",
  sq: "Square",
  xing: "Crossing",
  byp: "Bypass",
  cv: "Cove",
  holw: "Hollow",
  mnr: "Manor",
  pt: "Point",
  rdg: "Ridge",
  vw: "View",
  wlk: "Walk",
};

/** Expands road-suffix abbreviations and "&" for text that will be spoken
 * aloud, e.g. "Bill Stewart Rd & Hidden Forest" -> "Bill Stewart Road and
 * Hidden Forest". */
export function speakRoadNames(text: string): string {
  return text
    .replace(/&/g, " and ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const bare = word.replace(/\.$/, "");
      return ROAD_ABBREVIATIONS[bare.toLowerCase()] ?? word;
    })
    .join(" ");
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Reads 0-99 the way it'd naturally be said as the last two digits of a
 * number: "oh three" for a single digit (not "three" alone, or a TTS
 * engine's own instinct to read a leading zero as "zero"), "twenty
 * four"/"fifty" for the rest. */
function speakTwoDigits(n: number): string {
  if (n < 10) return `oh ${ONES[n]}`;
  if (n < 20) return TEENS[n - 10];
  const tens = TENS[Math.floor(n / 10) - 2];
  const ones = n % 10;
  return ones === 0 ? tens : `${tens} ${ONES[ones]}`;
}

/**
 * Reads a route number the way a driver actually says it aloud, not as
 * a raw number: the first digit read alone, then the remaining two
 * digits read as a single two-digit number, e.g. "124" -> "one twenty
 * four", "403" -> "four oh three", "254" -> "two fifty four", "101" ->
 * "one oh one". Joined with a plain space (not punctuation) so a TTS
 * engine reads it as one continuous phrase rather than pausing between
 * the two parts. The one exception: a round hundred (last two digits
 * both zero, e.g. "100") reads as "one hundred" - nobody says "one oh
 * zero" - rather than running it through the same "oh" treatment as
 * every other last-two-digits value. Only three-digit route numbers
 * follow this pattern - anything else is spoken as its raw digits
 * instead.
 */
export function speakRouteNumber(routeNumber: string): string {
  if (!/^\d{3}$/.test(routeNumber)) return routeNumber;
  const first = Number(routeNumber[0]);
  const rest = Number(routeNumber.slice(1));
  return rest === 0 ? `${ONES[first]} hundred` : `${ONES[first]} ${speakTwoDigits(rest)}`;
}
