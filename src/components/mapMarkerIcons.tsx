import { renderToStaticMarkup } from "react-dom/server";
import { ActionIcon } from "./icons";
import type { TurnDirection } from "@/lib/types";

/**
 * The one turn/direction marker every map in this app now draws for a
 * non-Stop waypoint - the real yellow-diamond icon set (src/components/
 * icons/*.svg, uploaded and cleaned up from src/components/icons/
 * directions/ - see that folder's own .ai source), never a blank
 * colored tile or a fixed raster sign mirrored in place. Every action
 * *except* Left/Right already reads as what it means regardless of
 * orientation (a U-turn glyph already looks like a U-turn), so
 * ActionIcon's own already-complete diamond+symbol SVG (icons.tsx) is
 * used as-is for those, just resized. Left/Right are the one case that
 * needs a real-world pointing direction - left.svg/right.svg's own
 * arrow is kept as a separate, independently-rotatable `<g>` inside the
 * diamond (setTurnDiamondRotation below) so the diamond's own frame
 * stays upright (a real road sign never tilts to match the road) while
 * only the arrow itself turns to point at the real outgoing bearing.
 */

// The diamond frame every direction icon shares (left.svg/right.svg's
// own outer path, copied verbatim) - centered on this same 24x24
// viewBox's own (12,12) center, which is also what the rotation below
// pivots around.
const DIAMOND_D =
  "M12,22.77c-.59,0-1.15-.23-1.57-.65L1.88,13.57c-.86-.86-.86-2.27,0-3.13L10.43,1.88c.42-.42.97-.65,1.57-.65s1.15.23,1.57.65l8.55,8.55c.42.42.65.97.65,1.57s-.23,1.15-.65,1.57l-8.55,8.55c-.42.42-.97.65-1.57.65Z";
const DIAMOND_FILL = "#f5ca0d";
const DIAMOND_STROKE = "#0c0c0c";

// left.svg/right.svg's own arrow linework, copied verbatim.
const ARROW_D: Record<TurnDirection, string> = {
  left: "M14.35,16.5v-5.38h-7.47M6.88,11.12l3-3M6.88,11.12l3,3",
  right: "M17.12,11.12h-7.47s0,5.38,0,5.38M14.12,8.12l3,3M14.12,14.12l3-3",
};
// The real compass bearing each arrow's own tip already points at when
// drawn unrotated (0deg rotation) - left.svg's own arrowhead points due
// west by default, right.svg's due east (each drawn as "coming up from
// the bottom, then bending toward its own side"). setTurnDiamondRotation
// below subtracts this off so a target bearing of, say, due west needs
// zero added rotation for the (already-west-pointing) left arrow.
const ARROW_DEFAULT_BEARING: Record<TurnDirection, number> = { left: 270, right: 90 };

// data-* attribute (not a class or id) so setTurnDiamondRotation can
// look this element back up without either map needing to track its
// own reference to it separately from the plain MapLibre Marker element
// each already keeps for removal (clearPins/redrawStopPins).
const TURN_SYMBOL_ATTR = "data-turn-symbol";

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
  const inner = direction
    ? `<svg viewBox="0 0 24 24" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">` +
      `<path fill="${DIAMOND_FILL}" stroke="${DIAMOND_STROKE}" stroke-width="1" d="${DIAMOND_D}" />` +
      `<g ${TURN_SYMBOL_ATTR} transform="rotate(0 12 12)">` +
      `<path fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${ARROW_D[direction]}" />` +
      "</g></svg>"
    : heading
      ? sizedSvg(renderToStaticMarkup(<ActionIcon action={heading} />))
      : "";
  if (!inner) return null;
  return `<div style="width:${size}px;height:${size}px;">${inner}</div>`;
}

/**
 * Points a Left/Right turn's own arrow (the rotatable `<g>` inside
 * turnDiamondHtml above) at its real, true-north compass bearing - "the
 * street we're about to turn onto," not wherever the map's own live
 * rotation (driving mode's own camera spin toward the bus's current
 * heading, RouteMap.tsx's bearingAt) happens to be facing at that
 * instant. The diamond's own frame is a sibling element, never
 * touched, so it stays upright throughout - only the arrow inside it
 * turns. `mapBearingDeg` is subtracted off `bearingDeg` because a
 * MapLibre marker's own DOM element never auto-rotates with the map on
 * its own (that's `rotationAlignment`, a whole-marker option this app
 * deliberately doesn't use here - it would spin the diamond's own frame
 * too, not just the arrow) - without correcting for the map's own
 * current bearing, the arrow would only ever look right the one moment
 * the map itself sat at 0deg. `ARROW_DEFAULT_BEARING[direction]` is
 * subtracted too, since the arrow doesn't start out pointing north the
 * way a generic symbol would - left.svg's own arrow already points
 * west unrotated, right.svg's east, so each needs its own offset
 * cancelled out first. `bearingDeg` null (this route's own road
 * geometry hasn't resolved a bearing for this turn yet) leaves the
 * arrow at its own unrotated default rather than a wrong guess. */
export function setTurnDiamondRotation(
  markerElement: HTMLElement,
  direction: TurnDirection,
  bearingDeg: number | null,
  mapBearingDeg: number,
): void {
  const symbolEl = markerElement.querySelector<SVGGElement>(`[${TURN_SYMBOL_ATTR}]`);
  if (!symbolEl || bearingDeg == null) return;
  const angle =
    (((bearingDeg - mapBearingDeg - ARROW_DEFAULT_BEARING[direction]) % 360) + 360) % 360;
  symbolEl.setAttribute("transform", `rotate(${angle} 12 12)`);
}
