import { renderToStaticMarkup } from "react-dom/server";
import { ActionIcon } from "./icons";
import type { TurnDirection } from "@/lib/types";

/**
 * The one turn/direction marker every map in this app now draws for a
 * non-Stop waypoint - the real icon set (src/components/icons/*.svg,
 * uploaded and cleaned up from src/components/icons/directions/ - see
 * that folder's own .ai source), never a blank colored tile. Every
 * action, Left/Right included, is drawn as ActionIcon's own already-
 * complete diamond+symbol SVG (icons.tsx) - left.svg/right.svg already
 * *are* the correct sign for their own direction (no flipping, no
 * separately-rotated inner arrow), just resized for the map. What
 * changes per-render is which whole sign gets used, not any shape
 * inside it.
 *
 * Left/Right/Continue/Proceed are the cases with a real-world pointing
 * direction, so the *entire* rendered sign - diamond frame and arrow
 * together, as one rigid graphic - gets rotated to the road's real
 * compass bearing at that waypoint (setTurnDiamondRotation below), the
 * same way a real road sign is bolted to point at the road it's warning
 * about. That's the opposite of a rider pin (stopMarkerHtml/
 * schoolMarkerHtml, RouteMap.tsx): those never carry any rotation at
 * all, so they stay upright for free as the map itself rotates in
 * driving mode. An action with no real-world pointing direction of its
 * own (Depart, Arrive, Pull Over, ...) deliberately does *not* get that
 * same treatment.
 */

// The real compass bearing each rotatable sign's own arrow already
// points at when drawn unrotated (0deg) - left.svg's own arrowhead
// points due west by default, right.svg's due east, continue.svg's and
// proceed.svg's both point due north (straight ahead). rotationKeyFor/
// setTurnDiamondRotation below subtract this off so a target bearing of,
// say, due west needs zero added rotation for the (already-west-
// pointing) left sign. Only actions listed here ever get a
// TURN_SIGN_ATTR wrapper (turnDiamondHtml below) or an entry in
// RouteMap.tsx's own turnArrowRotations - anything else keeps its
// default, unrotated artwork.
const ARROW_DEFAULT_BEARING: Record<string, number> = {
  left: 270,
  right: 90,
  continue: 0,
  proceed: 0,
};

/** The lookup key into ARROW_DEFAULT_BEARING for a given turn/action -
 * `direction` (Left/Right) when there is one, otherwise `heading`
 * lower-cased the same way ActionIcon (icons.tsx) already matches it
 * case-insensitively against ACTION_ICONS. Returns null for any action
 * with no real-world pointing direction of its own (Depart, Arrive,
 * Pull Over, ...), so callers can tell "nothing to rotate" apart from
 * "rotate to 0deg". */
export function rotationKeyFor(
  direction: TurnDirection | undefined,
  heading: string | undefined,
): string | null {
  const key = direction ?? heading?.toLowerCase();
  return key != null && key in ARROW_DEFAULT_BEARING ? key : null;
}

// data-* attribute (not a class or id) so setTurnDiamondRotation can
// look this element back up without either map needing to track its
// own reference to it separately from the plain MapLibre Marker element
// each already keeps for removal (clearPins/redrawStopPins). Marked on
// the sized inner wrapper div, never the outer element MapLibre's own
// Marker passes to `new maplibregl.Marker({element})` - that outer
// element's own `style.transform` is owned by MapLibre itself (map
// position), so rotating this inner child instead is what keeps this
// module's own rotation from fighting that positioning transform.
const TURN_SIGN_ATTR = "data-turn-sign";

/** Forces an explicit 100%/100% width/height onto a raw SVG string
 * (every icon under src/components/icons only ever sets its own
 * viewBox, relying on a caller's className for real-world sizing the
 * normal React way) - needed here since this HTML gets dropped straight
 * into a MapLibre marker's own fixed-size wrapper div via innerHTML, not
 * rendered through Tailwind's usual height/width classes on the root
 * svg element the way every other caller of these icons does. */
function sizedSvg(rawSvgHtml: string): string {
  return rawSvgHtml.replace("<svg ", '<svg width="100%" height="100%" ');
}

/** `size` is the marker's own full box, in CSS pixels - a caller passes
 * whatever fits its own map's existing pin scale, RouteMap.tsx and
 * WaypointPreviewMap.tsx each keep their own constant for it. Returns
 * null only for a row with neither a direction nor a recognized action
 * - "shouldn't happen for real data" (same caveat this always carried),
 * not something this app's own Type dropdown can actually produce. */
export function turnDiamondHtml(
  size: number,
  direction: TurnDirection | undefined,
  heading: string | undefined,
): string | null {
  const action = direction ?? heading;
  if (!action) return null;
  const svg = sizedSvg(renderToStaticMarkup(<ActionIcon action={action} />));
  if (!svg) return null;
  const signAttr = rotationKeyFor(direction, heading) != null ? ` ${TURN_SIGN_ATTR}="1"` : "";
  return `<div style="width:${size}px;height:${size}px;"${signAttr}>${svg}</div>`;
}

/**
 * Rotates a Left/Right/Continue/Proceed sign's own whole sign (the
 * TURN_SIGN_ATTR wrapper inside turnDiamondHtml above, diamond frame
 * and arrow together as one rigid graphic) to its real, true-north
 * compass bearing - "the road we're on at this point in the route," not
 * wherever the map's own live rotation (driving mode's own camera spin
 * toward the bus's current heading, RouteMap.tsx's bearingAt) happens to
 * be facing at that instant. Unlike a rider pin, this sign deliberately
 * does *not* stay upright as the map rotates - a real road sign is fixed
 * to the road, not to the driver's own view. `mapBearingDeg` is
 * subtracted off `bearingDeg` because a MapLibre marker's own DOM
 * element never auto-rotates with the map on its own (that's
 * `rotationAlignment`, a whole-marker option this app deliberately
 * doesn't use here - it would fight the `data-turn-sign` transform this
 * function sets on the marker's own inner child) - without correcting
 * for the map's own current bearing, the sign would only ever look
 * right the one moment the map itself sat at 0deg.
 * `ARROW_DEFAULT_BEARING[rotationKey]` is subtracted too, since the sign
 * doesn't start out pointing north the way a generic symbol would -
 * left.svg's own arrow already points west unrotated, right.svg's east,
 * continue.svg's and proceed.svg's north, so each needs its own offset
 * cancelled out first. `rotationKey` is `rotationKeyFor`'s own return
 * value - callers that already have one on hand (RouteMap.tsx) pass it
 * straight through rather than recomputing it. `bearingDeg` null (this
 * route's own road geometry hasn't resolved a bearing for this waypoint
 * yet) leaves the sign at its own unrotated default rather than a wrong
 * guess.
 */
export function setTurnDiamondRotation(
  markerElement: HTMLElement,
  rotationKey: string,
  bearingDeg: number | null,
  mapBearingDeg: number,
): void {
  const signEl = markerElement.querySelector<HTMLElement>(`[${TURN_SIGN_ATTR}]`);
  if (!signEl || bearingDeg == null) return;
  const defaultBearing = ARROW_DEFAULT_BEARING[rotationKey];
  if (defaultBearing == null) return;
  const angle = (((bearingDeg - mapBearingDeg - defaultBearing) % 360) + 360) % 360;
  signEl.style.transform = `rotate(${angle}deg)`;
}
