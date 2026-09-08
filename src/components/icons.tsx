import Image from "next/image";
import type { TurnDirection } from "@/lib/types";
import CheckboxCheckedSvg from "./icons/checkbox-checked.svg";
import CheckboxUncheckedSvg from "./icons/checkbox-unchecked.svg";
import HeartFilledSvg from "./icons/heart-filled.svg";
import HeartOutlineSvg from "./icons/heart-outline.svg";
import TriangleRoundedSvg from "./icons/triangle-rounded.svg";
import TriangleSvg from "./icons/triangle.svg";

/** The turn-sign image, mirrored for a left turn (the source art is a
 * right turn). Still a raster PNG, not one of the vector icons below -
 * nothing to extract to its own .svg file for. */
export function TurnArrow({
  direction,
  className,
}: {
  direction: TurnDirection;
  className?: string;
}) {
  return (
    <Image
      src="/assets/turn-arrow.png"
      alt=""
      width={797}
      height={797}
      className={className}
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

// Every icon below is a standalone .svg file under ./icons/ (see
// next.config.ts's own turbopack.rules for the @svgr/webpack wiring,
// and src/svg.d.ts for the type that import actually resolves to) -
// open any of them directly in a vector editor to tweak its shape,
// no copy-paste back into this file needed. Every file uses
// currentColor for its own fill/stroke, same as these always did as
// inline JSX, so a caller's className (a Tailwind text-* color) still
// tints it exactly the same way.
//
// A handful need real per-render logic beyond what a plain className
// passthrough can express (a mirrored direction, a checked/filled
// toggle) and keep a small wrapper function here instead of a plain
// re-export - each one's own doc comment below says why.

export { default as ChevronDownIcon } from "./icons/chevron-down.svg";
export { default as PauseIcon } from "./icons/pause.svg";

/** A filled triangle, pointing right by default and mirrored for
 * "left" - the mirroring is a plain CSS transform forwarded onto the
 * imported SVG's own root element via `style`, not a second file. */
export function TriangleIcon({
  direction = "right",
  className,
}: {
  direction?: "left" | "right";
  className?: string;
}) {
  return (
    <TriangleSvg className={className} style={direction === "left" ? { transform: "scaleX(-1)" } : undefined} />
  );
}

/** A softer, rounded-corner triangle (stroke+fill sharing a color
 * rounds the corners via strokeLinejoin, rather than a crisp point) -
 * used for the stop side-of-road indicator, where a plain sharp
 * arrowhead read as too much like another tappable control. Pointing
 * right by default and mirrored for "left", same style-forwarding
 * approach as TriangleIcon above. */
export function RoundedTriangleIcon({
  direction = "right",
  className,
}: {
  direction?: "left" | "right";
  className?: string;
}) {
  return (
    <TriangleRoundedSvg
      className={className}
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

export function PlayIcon({ className }: { className?: string }) {
  return <TriangleIcon direction="right" className={className} />;
}

/** The traditional stacked up/down carets next to a sortable table
 * column header - both drawn always, with whichever one matches the
 * active sort direction solid and the other faint, so the icon itself
 * shows the current state rather than needing a separate indicator.
 * `direction: "none"` (an unsorted column) shows both equally faint.
 * Kept hand-authored here rather than importing ./icons/sort.svg (a
 * shape reference only, see its own comment) - its two carets need
 * independent per-direction opacity, which a plain className/style
 * passthrough onto one imported file can't express. */
export function SortIcon({
  direction = "none",
  className,
}: {
  direction?: "asc" | "desc" | "none";
  className?: string;
}) {
  return (
    <svg viewBox="0 0 10 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M5 0 L9 6 H1 Z" opacity={direction === "asc" ? 1 : 0.35} />
      <path d="M5 16 L9 10 H1 Z" opacity={direction === "desc" ? 1 : 0.35} />
    </svg>
  );
}

export { default as PersonIcon } from "./icons/person-outline.svg";
export { default as PersonSolidIcon } from "./icons/person-solid.svg";
export { default as MapPinIcon } from "./icons/map-pin.svg";
export { default as BackArrowIcon } from "./icons/back-arrow.svg";
export { default as RightArrowIcon } from "./icons/right-arrow.svg";
export { default as CheckIcon } from "./icons/check.svg";
export { default as CheckCircleIcon } from "./icons/check-circle.svg";
export { default as XCircleIcon } from "./icons/x-circle.svg";
export { default as WarningIcon } from "./icons/warning.svg";
export { default as PlusIcon } from "./icons/plus.svg";
export { default as EditIcon } from "./icons/edit.svg";
export { default as TrashIcon } from "./icons/trash.svg";
export { default as SaveIcon } from "./icons/save.svg";
export { default as UploadIcon } from "./icons/upload.svg";
export { default as DownloadIcon } from "./icons/download.svg";
export { default as EyeIcon } from "./icons/eye.svg";
export { default as EyeOffIcon } from "./icons/eye-off.svg";
export { default as SearchIcon } from "./icons/search.svg";
export { default as SunriseIcon } from "./icons/sunrise.svg";
export { default as SunIcon } from "./icons/sun.svg";
export { default as GlobeIcon } from "./icons/globe.svg";
export { default as SpinnerIcon } from "./icons/spinner.svg";
export { default as CloseIcon } from "./icons/close.svg";

/** Favorite marker on RouteListScreen's rows - solid+filled when
 * `filled`, a faint outline otherwise (caller controls both fill and
 * outline color via `className`'s text color, same as every other
 * icon here). Two separate files (heart-outline.svg/heart-filled.svg)
 * rather than one dynamically-filled shape - `fill` can't be forwarded
 * cleanly onto an already-imported static SVG component the way
 * `style` can for a mirrored direction elsewhere in this file. */
export function HeartIcon({
  filled,
  className,
}: {
  filled?: boolean;
  className?: string;
}) {
  const Svg = filled ? HeartFilledSvg : HeartOutlineSvg;
  return <Svg className={className} />;
}

/** A rounded-square checkbox - filled blue with a white check when
 * `checked`, an empty outline otherwise. Used for RouteListScreen's own
 * admin-mode bulk-selection column (replacing what used to be a pencil
 * there - editing now happens by tapping the row itself). Same
 * two-file approach as HeartIcon above, for the same reason. */
export function CheckboxIcon({
  checked,
  className,
}: {
  checked?: boolean;
  className?: string;
}) {
  const Svg = checked ? CheckboxCheckedSvg : CheckboxUncheckedSvg;
  return <Svg className={className} />;
}

/** A literal schoolhouse - used for the Schools heading
 * (SchoolListScreen) and RouteListScreen's own "Schools" link. */
export { default as SchoolIcon } from "./icons/school.svg";

/** A folded paper map with a dotted route line crossing it - used for
 * the Routes heading (RouteListScreen). */
export { default as RouteIcon } from "./icons/route.svg";

export { default as MailIcon } from "./icons/mail.svg";
