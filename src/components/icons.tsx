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
