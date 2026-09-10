"use client";

/**
 * A shared yes/no confirmation overlay - used for the admin-only
 * publish/unpublish/delete actions on RouteListScreen's edit-mode
 * rows, all three consequential enough (delete especially) to need a
 * second tap rather than firing immediately on the first one. Same
 * visual pattern as StepScreen.tsx's own one-off LeaveRouteConfirmModal
 * (full-screen dim, centered card, backdrop tap to cancel) - not
 * merged with it here since that one's copy/actions are specific to
 * ending a trip, not worth genericizing away from.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmIcon,
  destructive = false,
  secondaryLabel,
  secondaryIcon,
  onSecondary,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  /** Icon shown before confirmLabel - a trash can for delete, say -
   * kept optional/generic rather than hardcoding delete's icon here,
   * since this modal serves publish/unpublish too. */
  confirmIcon?: React.ReactNode;
  /** Red confirm button for delete - amber/blue destructive-lite isn't
   * needed for publish/unpublish, which are always reversible. */
  destructive?: boolean;
  /** A third, always-red/destructive button alongside Cancel and the
   * (blue) confirm button - RouteListScreen's own "this route is in
   * Draft" popup uses it for "Delete", offered right next to
   * "Activate" so both ways out of that popup are a single tap rather
   * than nesting a second confirm-of-a-confirm inside this one. Reads
   * leftmost, same "destructive reads leftmost" convention the plain
   * two-button case already follows via flex-row-reverse below. Omit
   * for the ordinary Cancel/confirm case - most callers. */
  secondaryLabel?: string;
  secondaryIcon?: React.ReactNode;
  onSecondary?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onCancel}
    >
      <div
        className="animate-popup-pop w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-center shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading text-xl font-black tracking-tight">{title}</h2>
        {message && <p className="mt-2 text-sm text-zinc-500">{message}</p>}

        {/* Destructive (delete) reads leftmost, same rule this app
            already applies everywhere else a delete button sits next
            to a safe one - away from where a thumb instinctively taps
            the "main" action, not toward it. Publish/unpublish keep
            the ordinary Cancel-then-confirm reading order. The
            secondary button (when given) is always that same
            leftmost-destructive slot, so a plain destructive confirm
            (flex-row-reverse) and a Delete-then-Cancel-then-Activate
            three-button row both read the same left-to-right. */}
        <div className={`mt-4 flex gap-2 ${destructive && !secondaryLabel ? "flex-row-reverse" : ""}`}>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="btn-glossy-red font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white"
            >
              {secondaryIcon}
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className={`btn-glossy-light font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-300 font-semibold text-zinc-900 ${
              secondaryLabel ? "py-3 text-sm" : "py-3 text-base"
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 font-semibold text-white ${
              secondaryLabel ? "text-sm" : "text-base"
            } ${destructive && !secondaryLabel ? "btn-glossy-red bg-red-600" : "btn-glossy-blue bg-blue-600"}`}
          >
            {confirmIcon}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
