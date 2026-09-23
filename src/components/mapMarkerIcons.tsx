import { renderToStaticMarkup } from "react-dom/server";
import { ActionIcon } from "./icons";
import type { TurnDirection } from "@/lib/types";

/**
 * The one turn/direction marker shape every map in this app now draws -
 * a rounded square rotated 45deg (the same "diamond" trick
 * WaypointPreviewMap.tsx always used for this shape) holding a real
 * symbol, never a blank colored tile. `direction` (Left/Right) draws
 * arrowSvg below; every other action (Continue, U-Turn, Turn Around,
 * Proceed, Pull Over, Return, Depart, Arrive) draws its own already-
 * distinct ActionIcon glyph, the same one StepRowEditor's own row list
 * and StepScreen already show for that action - those already look like
 * what they mean (a U-turn glyph already reads as a U-turn) regardless
 * of which way they're rotated, so only a literal Left/Right turn's own
 * arrow needs a real-world pointing direction at all.
 *
 * A live map's turn markers all used to be either a fixed, mirrored
 * raster sign (RouteMap.tsx's own turn-arrow.png, "roughly which way,
 * relative to whatever the screen happened to be facing") or a plain
 * blank colored diamond (WaypointPreviewMap.tsx's own current-row
 * marker, no symbol at all). setTurnDiamondRotation below is what
 * fixes the first problem - this fixes the second, by always drawing a
 * real symbol no matter which map calls it from.
 */

const TURN_DIAMOND_COLOR = "#facc15"; // yellow-400
const TURN_SYMBOL_COLOR = "#1f2937"; // zinc-800, matching ActionIcon's own existing tint elsewhere on these maps
// data-* attribute (not a class or id) precisely so setTurnDiamondRotation
// can look this element back up without either map needing to track its
// own reference to it separately from the plain MapLibre Marker element
// each already keeps for removal (clearPins/redrawStopPins).
const TURN_SYMBOL_ATTR = "data-turn-symbol";

/** A plain bold arrowhead, pointing straight up (compass north, 0deg)
 * at rest - the one shape a Left/Right turn's own diamond ever draws,
 * since what actually distinguishes "turn left" from "turn right" is
 * real-world rotation (setTurnDiamondRotation below), not a second,
 * mirrored copy of this same shape the way the old raster sign needed. */
function arrowSvg(): string {
  return (
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="${TURN_SYMBOL_COLOR}" ` +
    'xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L19 15 L14 15 L14 22 L10 22 L10 15 L5 15 Z" /></svg>'
  );
}

/** `size` is the outer box's own full diameter (point-to-point height
 * comes out to roughly this, same convention WaypointPreviewMap.tsx's
 * own diamondHtml always used) - a caller passes whatever size fits its
 * own map's existing pin scale, RouteMap.tsx and WaypointPreviewMap.tsx
 * each keep their own constant for it rather than sharing one here, the
 * same way TURN_SIZE never had to match RouteMap's own h-8 turn icons
 * before this. Returns null only for a row with neither a direction nor
 * a recognized action - "shouldn't happen for real data" (same caveat
 * the old turnMarkerHtml always carried), not something this app's own
 * Type dropdown can actually produce. */
export function turnDiamondHtml(
  size: number,
  direction: TurnDirection | undefined,
  heading: string | undefined,
): string | null {
  const symbol = direction
    ? arrowSvg()
    : heading
      ? renderToStaticMarkup(<ActionIcon action={heading} className="h-4 w-4" />)
      : null;
  if (!symbol) return null;
  const side = Math.round(size / Math.SQRT2);
  const radius = Math.round(side * 0.22);
  return (
    `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">` +
    `<div style="width:${side}px;height:${side}px;background:${TURN_DIAMOND_COLOR};` +
    `border:1.5px solid #000000;border-radius:${radius}px;box-shadow:0 1px 2px rgba(0,0,0,0.35);` +
    'position:relative;transform:rotate(45deg);">' +
    `<div ${TURN_SYMBOL_ATTR} style="position:absolute;top:50%;left:50%;` +
    `transform:translate(-50%,-50%) rotate(-45deg);color:${TURN_SYMBOL_COLOR};line-height:0;">${symbol}</div>` +
    "</div></div>"
  );
}

/**
 * Points a Left/Right turn's own arrow (turnDiamondHtml above) at its
 * real, true-north compass bearing - "the street we're about to turn
 * onto," not wherever the map's own live rotation (driving mode's own
 * camera spin toward the bus's current heading, RouteMap.tsx's
 * bearingAt) happens to be facing at that instant. `mapBearingDeg` is
 * subtracted off `bearingDeg` because a MapLibre marker's own DOM
 * element never auto-rotates with the map on its own (that's
 * `rotationAlignment`, a whole-marker option this app deliberately
 * doesn't use here - it would also spin the diamond's own frame off its
 * clean point-up/point-down silhouette, not just the arrow inside it) -
 * without correcting for the map's own current bearing, the arrow would
 * only ever look right the one moment the map itself sat at 0deg.
 * `bearingDeg` null (a heading-based icon, which never rotates in the
 * first place, or a turn this route's own road geometry hasn't resolved
 * a bearing for yet) leaves the symbol at turnDiamondHtml's own fixed
 * upright rotation - not wrong, just not corrected, since there's
 * nothing real yet to correct it *to*. */
export function setTurnDiamondRotation(
  markerElement: HTMLElement,
  bearingDeg: number | null,
  mapBearingDeg: number,
): void {
  const symbolEl = markerElement.querySelector<HTMLElement>(`[${TURN_SYMBOL_ATTR}]`);
  if (!symbolEl || bearingDeg == null) return;
  const screenAngle = (((bearingDeg - mapBearingDeg) % 360) + 360) % 360;
  symbolEl.style.transform = `translate(-50%, -50%) rotate(-45deg) rotate(${screenAngle}deg)`;
}
