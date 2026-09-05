"use client";

/**
 * A small labeled on/off switch - used for "View All Stops"'s and
 * EditRouteScreen's own stop editor's shared "show turns" toggle (both
 * default to stops-only; flipping this interleaves turn steps back in,
 * in their real route order).
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-sm font-medium text-zinc-600">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-blue-600" : "bg-zinc-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
