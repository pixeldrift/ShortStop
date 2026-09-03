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
