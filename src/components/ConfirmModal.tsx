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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-center shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading text-xl font-black tracking-tight">{title}</h2>
        {message && <p className="mt-2 text-sm text-zinc-500">{message}</p>}

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-3 text-base font-semibold text-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-base font-semibold text-white ${
              destructive ? "bg-red-600" : "bg-blue-600"
            }`}
          >
            {confirmIcon}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
