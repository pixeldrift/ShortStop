import Image from "next/image";
import type { TurnDirection } from "@/lib/types";

/** The turn-sign image, mirrored for a left turn (the source art is a
 * right turn). */
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

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 16" className={className} aria-hidden="true">
      <path d="M12 15 L1 1 H23 Z" fill="#facc15" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <rect x="5" y="4" width="5" height="16" rx="1.5" />
      <rect x="14" y="4" width="5" height="16" rx="1.5" />
    </svg>
  );
}

/** A filled triangle, pointing right by default and mirrored for "left". */
export function TriangleIcon({
  direction = "right",
  className,
}: {
  direction?: "left" | "right";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M6 4 L20 12 L6 20 Z" />
    </svg>
  );
}

/** A softer, rounded-corner triangle (stroke+fill sharing a color rounds
 * the corners via strokeLinejoin, rather than a crisp point) - used for
 * the stop side-of-road indicator, where a plain sharp arrowhead read as
 * too much like another tappable control. Pointing right by default and
 * mirrored for "left". */
export function RoundedTriangleIcon({
  direction = "right",
  className,
}: {
  direction?: "left" | "right";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M7 4 L18 12 L7 20 Z" />
    </svg>
  );
}

export function PlayIcon({ className }: { className?: string }) {
  return <TriangleIcon direction="right" className={className} />;
}

/** The traditional stacked up/down carets next to a sortable table
 * column header - both drawn always, with whichever one matches the
 * active sort direction solid and the other faint, so the icon itself
 * shows the current state rather than needing a separate indicator.
 * `direction: "none"` (an unsorted column) shows both equally faint. */
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

/** Outline person - used for a rider not yet checked in. */
export function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="7.5" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M4 20c0-4.42 3.58-8 8-8s8 3.58 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Solid/filled person - used for a rider checked in as onboard. */
export function PersonSolidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4 21c0-4.42 3.58-8 8-8s8 3.58 8 8v1H4z" />
    </svg>
  );
}

/** Small solid map pin - used inline next to an address. */
export function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

/** Plain left-pointing arrow - used for "back to the previous screen"
 * navigation, as opposed to TriangleIcon's filled arrowheads used for
 * step-by-step Back/Next. */
export function BackArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

/** Checkmark in a filled circle - used for the "arrived, all stops
 * complete" state. */
export function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
      <path
        d="M7 12.5 L10.5 16 L17 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A miss, alongside CheckCircleIcon's hit - same filled-circle-plus-
 * mark shape so the two read as a matched pair (auto-resolve status
 * rows, see routeResolutionStatus.ts), just an X instead of a check. */
export function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
      <path
        d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A route that can't be made active yet (still has unresolved
 * waypoints) - shown in place of the Make Active button on the edit-
 * route screen, and as a dimmed-list badge, rather than a plain
 * disabled button with no explanation of why. */
export function WarningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 3 L22 20 H2 Z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <rect x="11" y="9" width="2" height="6" rx="1" fill="currentColor" />
      <rect x="11" y="16.5" width="2" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

/** Plain "+" - the Add Route link on the route list. */
export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M12 5 V19 M5 12 H19" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Small pencil - every edit link/button (StartScreen's "Edit Route",
 * the route-list "Edit Mode" toggle and its header badge). */
export function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" aria-hidden="true">
      <path
        d="M4 20 L4.8 16.4 L16 5.2 A1.5 1.5 0 0 1 18 5.2 L18.8 6 A1.5 1.5 0 0 1 18.8 8 L7.6 19.2 Z M14.5 6.7 L17.3 9.5"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Trash can - every delete action (RouteListScreen's per-row Delete
 * button and its confirm modal). */
export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 7 H19 M9 7 V5 A1 1 0 0 1 10 4 H14 A1 1 0 0 1 15 5 V7 M7 7 L8 19 A1 1 0 0 0 9 20 H15 A1 1 0 0 0 16 19 L17 7" />
      <path d="M10 11 V16 M14 11 V16" />
    </svg>
  );
}

/** The traditional "save" glyph - an arrow pointing down into an open
 * box/tray - used on every Save button (as opposed to EditIcon, which
 * marks a link/button that only ever *opens* an edit screen). */
export function SaveIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 14 V18.5 A1.5 1.5 0 0 0 5.5 20 H18.5 A1.5 1.5 0 0 0 20 18.5 V14" />
      <path d="M12 3 V13.5 M7.5 9 L12 13.5 L16.5 9" />
    </svg>
  );
}

/** SaveIcon flipped the other way - an arrow lifting up off a base
 * line - the Add Route screen's "Upload File" button (an alternative
 * to pasting stops in directly). */
export function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 18 V18.5 A1.5 1.5 0 0 0 5.5 20 H18.5 A1.5 1.5 0 0 0 20 18.5 V18" />
      <path d="M12 15 V4.5 M7.5 9 L12 4.5 L16.5 9" />
    </svg>
  );
}

/** Magnifying glass - used inline in the route-list search box. */
export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20 L15.2 15.2" />
    </svg>
  );
}

/** Half-sun-on-a-horizon with rays above only (no rays below the
 * horizon, since the sun hasn't risen yet there) - used on
 * RouteListScreen's rows to mark a "pickup" (AM) route, paired with
 * SunIcon for "dropoff" (PM) ones. */
export function SunriseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v4" />
      <path d="M4.9 9.9l1.4 1.4M19.1 9.9l-1.4 1.4" />
      <path d="M7 17a5 5 0 0 1 10 0" />
      <path d="M2 17h20" />
      <path d="M5 21h14" />
    </svg>
  );
}

/** Full sun, rays all the way around - used on RouteListScreen's rows
 * to mark a "dropoff" (PM) route, paired with SunriseIcon for
 * "pickup" (AM) ones. */
export function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

/** A plain X - used to close a modal (AllStopsModal, StartScreen). */
export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

/** Favorite marker on RouteListScreen's rows - solid+filled when
 * `filled`, a faint outline otherwise (caller controls both fill and
 * outline color via `className`'s text color, same as every other
 * icon here). */
export function HeartIcon({
  filled,
  className,
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20.5s-7-4.35-9.5-8.8C1 8.4 2.4 5 5.7 4.5c2-.3 3.7.7 4.8 2.3.3.4.9.4 1.2 0 1.1-1.6 2.8-2.6 4.8-2.3C19.6 5 21 8.4 19.5 11.7c-2.5 4.45-9.5 8.8-9.5 8.8z" />
    </svg>
  );
}
