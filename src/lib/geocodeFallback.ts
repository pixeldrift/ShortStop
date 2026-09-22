import { STREET_SUFFIX_ABBREVIATIONS } from "./parseRouteImport";

/** Every street-type word this app already recognizes (parseRouteImport.ts's
 * own STREET_SUFFIX_ABBREVIATIONS, spelled-out form) - reused here rather
 * than a second, competing vocabulary, since it's the exact same
 * "Road"/"Rd"/"Drive"/"Dr"/... set a route sheet's own text already
 * gets normalized against. */
export const STREET_TYPE_WORDS = Object.keys(STREET_SUFFIX_ABBREVIATIONS);

const STREET_TYPE_WORD_SET = new Set([
  ...STREET_TYPE_WORDS,
  ...Object.values(STREET_SUFFIX_ABBREVIATIONS).map((abbr) => abbr.toLowerCase()),
]);

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Splits a road name into its base ("Bill Stewart") and trailing
 * street-type word ("Boulevard"/"Blvd"), if it has one this app
 * recognizes - same "only the very last word" scope
 * parseRouteImport.ts's own normalizeStreetSuffix already uses, so
 * "Bill Stewart Blvd" and "Bill Stewart Boulevard" both split the same
 * way regardless of which spelling a route sheet happened to use.
 * `type` is null for a name with no recognized trailing word at all
 * (a numbered highway, a road genuinely named "Broadway") - nothing
 * downstream tries a street-type swap on those. */
export function splitStreetType(name: string): { base: string; type: string | null } {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*\s)([A-Za-z]+)\.?\s*$/);
  if (!match) return { base: trimmed, type: null };
  const [, prefix, lastWord] = match;
  return STREET_TYPE_WORD_SET.has(lastWord.toLowerCase())
    ? { base: prefix.trim(), type: lastWord }
    : { base: trimmed, type: null };
}

/** Every common street-type word this name's own trailing one could
 * plausibly have been meant as instead, most-likely-first - "Road" and
 * "Drive"/"Lane"/"Court"/"Cove" all read as the same kind of small
 * residential street to a human writing a route sheet by hand, which
 * is exactly the kind of mistake StepRowEditor's own admin keeps
 * finding and fixing one at a time (see this module's own callers'
 * doc). Excludes whichever word the name already ends in - that one
 * already failed, trying it again would just waste a call. */
export function streetTypeVariants(base: string, currentType: string): string[] {
  const currentLower = currentType.toLowerCase();
  return STREET_TYPE_WORDS.filter((word) => word !== currentLower).map(
    (word) => `${base} ${capitalize(word)}`,
  );
}

/** Plain Levenshtein (single-character insert/delete/substitute) edit
 * distance - no need for anything fancier (Damerau transpositions,
 * phonetic matching) for what this is actually used against: short
 * road names typed by hand, where the realistic mistakes are a
 * dropped/added/swapped letter ("Swayse" for "Swayze"), not a
 * scrambled word order. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const currRow = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(
        Math.min(
          currRow[j - 1] + 1, // insertion
          prevRow[j] + 1, // deletion
          prevRow[j - 1] + cost, // substitution
        ),
      );
    }
    prevRow = currRow;
  }
  return prevRow[n];
}

/** Why a fallback match reads the way it does in GeocodeConfirmModal -
 * "street-type" (a recognized trailing word swapped for a synonym,
 * matched exactly against a real road in the area), "fuzzy-name" (the
 * whole name's own spelling was close enough to a real road's, no
 * exact match either way), or "loop-snap" (neither road resolved as a
 * real intersection even after correction - a point placed directly on
 * one of the two roads instead, snapped to whichever of its own points
 * is closest to the route, not a genuine crossing). */
export type FallbackKind = "street-type" | "fuzzy-name" | "directional" | "loop-snap";

export interface StreetMatch {
  kind: "street-type" | "fuzzy-name" | "directional";
  /** The real road name (exactly as OSM itself spells it) this input
   * was matched against - what a retried Overpass/ORS query should
   * actually search for instead of the original text. */
  correctedName: string;
}

/** How close a "fuzzy-name" match's own edit distance has to be,
 * relative to the input's own length, to count as the same road
 * rather than a coincidentally similar but unrelated one - proportional
 * rather than a fixed number so "Elm St" (short, needs an exact-ish
 * match) and "Rocky Ridge Crescent" (long, can tolerate a couple of
 * off letters) are both held to a sensible bar. Floors at 2 so even a
 * very short name gets some tolerance for one real typo. */
function fuzzyThreshold(length: number): number {
  return Math.max(2, Math.round(length * 0.2));
}

/**
 * Tries to find a real road (from `candidates`, e.g.
 * overpassGeocode.ts's own fetchAreaStreetNames) that `name` probably
 * meant, now that a plain exact lookup for it has already failed.
 * Street-type-word swaps are tried first and preferred over an
 * equally-close spelling match even when both would clear the bar -
 * swapping a whole recognized word for its most common synonym is a
 * far more likely real mistake on a hand-written route sheet ("Road"
 * typed for what's actually "Drive") than a coincidentally similar
 * spelling is, and it only ever proposes an *exact* match against a
 * real road this way, never a guess. Returns null when nothing clears
 * either bar - the caller's own next fallback (overpassGeocode.ts's
 * fetchStreetNodes, for a loop/circle) picks up from there.
 */
/** A bare leading cardinal, the one thing splitStreetType's own
 * trailing-word scope never touches - "N Shreibman Blvd" needs "N"
 * recognized as a direction the same way "Blvd" is recognized as a
 * street type, not as part of the road's own distinctive name.
 * Matches only a complete leading word (one of exactly these eight),
 * so a road genuinely named "Northside Dr" or "Eastland Ave" is never
 * mistaken for a directional prefix - "North" the whole word, not
 * "North" as a prefix of a longer one. */
const LEADING_DIRECTION_PATTERN = /^(n|s|e|w|north|south|east|west)\.?\s+/i;

function stripLeadingDirection(text: string): string {
  return text.replace(LEADING_DIRECTION_PATTERN, "");
}

/** A name's own "core" - every word left once its trailing street-type
 * word (splitStreetType) and leading cardinal (stripLeadingDirection)
 * are both stripped, lowercased for comparison. "N Shreibman Blvd" and
 * "East Nir Shreibman Blvd" don't share a core this way ("shreibman"
 * vs "nir shreibman"), which is exactly why directionalCoreMatches
 * below checks containment rather than equality. */
function coreWords(name: string): string[] {
  const { base } = splitStreetType(name);
  return stripLeadingDirection(base.trim())
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Finds every real road (from `candidates`) whose own core contains
 * every word of `name`'s core - the fallback tier for a road-name
 * mismatch too large for bestStreetMatch's Levenshtein distance to
 * catch: "N Shreibman Blvd" isn't a typo of "East Nir Shreibman Blvd",
 * it's typed with the wrong cardinal *and* missing a whole word, which
 * puts it well outside fuzzyThreshold's own proportional tolerance.
 * Matching on core-word containment instead - does everything the
 * typed name is actually distinctive for still show up in this real
 * road's own name - catches it without needing an edit-distance bound
 * at all.
 *
 * Requires every core word to be at least 3 characters - a bare
 * initial or short stray word is too easy to coincidentally find
 * inside an unrelated road's name, and a name with no core left at all
 * after stripping (nothing but a direction and a street type) never
 * matches anything here.
 *
 * Can return more than one match - "N Shreibman Blvd" alone doesn't
 * say which side of a roundabout it means when the real road
 * genuinely renames itself partway (plain "Nir Shreibman Blvd" one
 * side, "E Nir Shreibman Blvd" the other) and the search box happens
 * to contain both. A caller with exactly one match can treat it as a
 * confident correction the same way a street-type/fuzzy-name match
 * already is; two or more means this is a real ambiguity to resolve
 * the same way two genuine crossings of one road pair already are
 * (see cardinalLabel.ts) - not something to silently guess at.
 */
export function directionalCoreMatches(name: string, candidates: string[]): string[] {
  const trimmed = name.trim();
  if (!trimmed || candidates.length === 0) return [];
  const nameWords = coreWords(trimmed).filter((word) => word.length >= 3);
  if (nameWords.length === 0) return [];

  return candidates.filter((candidate) => {
    const candidateWords = new Set(coreWords(candidate));
    return nameWords.every((word) => candidateWords.has(word));
  });
}

export function bestStreetMatch(name: string, candidates: string[]): StreetMatch | null {
  const trimmed = name.trim();
  if (!trimmed || candidates.length === 0) return null;
  const candidateByLower = new Map(candidates.map((c) => [c.toLowerCase(), c]));

  const { base, type } = splitStreetType(trimmed);
  if (type) {
    for (const variant of streetTypeVariants(base, type)) {
      const hit = candidateByLower.get(variant.toLowerCase());
      if (hit) return { kind: "street-type", correctedName: hit };
    }
  }

  let best: { name: string; distance: number } | null = null;
  const threshold = fuzzyThreshold(trimmed.length);
  for (const candidate of candidates) {
    // A cheap length gate before ever computing the real distance - a
    // candidate whose length alone already exceeds the threshold can't
    // possibly come in under it once edits are counted.
    if (Math.abs(candidate.length - trimmed.length) > threshold) continue;
    const distance = levenshteinDistance(trimmed.toLowerCase(), candidate.toLowerCase());
    if (distance > threshold) continue;
    if (!best || distance < best.distance) best = { name: candidate, distance };
  }
  return best ? { kind: "fuzzy-name", correctedName: best.name } : null;
}
