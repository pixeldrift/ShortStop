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

export function PlayIcon({ className }: { className?: string }) {
  return <TriangleIcon direction="right" className={className} />;
}
