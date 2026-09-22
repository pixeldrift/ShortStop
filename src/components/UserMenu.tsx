"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CheckboxIcon, CloseIcon, PersonSolidIcon } from "./icons";
import type { CurrentUser } from "@/lib/currentUser";
import { ADMIN_PERMISSIONS } from "@/lib/permissions";
import type { Permissions } from "@/lib/permissions";

/** Every Permissions field off (permissions.ts's own NO_PERMISSIONS
 * equivalent, inlined here rather than exported there since this is the
 * only place that ever needs "everything off" as a value) - the "Can
 * edit" box's own unchecked state. */
const NO_PERMISSIONS: Permissions = {
  canAccessAdmin: false,
  canAddRoutes: false,
  canEditRouteDetails: false,
  canEditWaypoints: false,
  canDeleteRoutes: false,
  canPublishRoutes: false,
};

/** User-facing role labels - cosmetic only for now (nothing reads
 * `role` to decide what a driver can do, `permissions` is what actually
 * gates anything), a fixed dropdown rather than free text now that the
 * permissions themselves collapsed to one box - once real roles exist
 * server-side this becomes real data instead of a fixed list. */
const ROLE_OPTIONS = ["Admin", "Driver", "Tech"];

/** The driver icon that floats top-right on every screen except
 * StepScreen's own turn-by-turn (page.tsx renders exactly one instance,
 * gated on its own showsPinnedLogo - same "one persistent instance
 * outside ScreenTransition" pattern the pinned Logo already uses, see
 * its own doc comment there) - tapping it opens this account/
 * permissions popup. Skipped during an active drive on purpose: a
 * driver already had to sign in to see their own assigned routes
 * before ever reaching StepScreen, so there's nothing left to do here
 * mid-route, and its old fixed top-right spot sits close enough to
 * ExpandableMap's own expand button (also top-right, StepScreen's map
 * box has no header above it to push either one down) that the two
 * competed for the same corner. `user`/`onChange` are page.tsx's own
 * currentUser state (currentUser.ts), edited directly here rather than
 * through a separate save step - every field change (a text box, a
 * permission checkbox) commits immediately, the same "no explicit
 * Save" a plain settings toggle anywhere else in the app already works
 * like.
 *
 * The "Can edit" box is this feature's actual point: a real per-user
 * permissions row doesn't exist yet (see permissions.ts's own doc
 * comment), so this is the one place a demo driver can flip it on/off
 * and immediately see the app's own gates (RouteListScreen's New Route/
 * publish/delete controls, EditRouteScreen's Details/Waypoints editing,
 * StepScreen's in-drive quick-edit) respond, without needing a real
 * signed-in account system built first. */
export function UserMenu({
  user,
  onChange,
}: {
  user: CurrentUser;
  onChange: (user: CurrentUser) => void;
}) {
  const [open, setOpen] = useState(false);

  // Every permission field lives or dies together for now - see
  // NO_PERMISSIONS/ADMIN_PERMISSIONS's own doc comments. "On" means
  // every field reads true; anything less (all off, or a mix left over
  // from before this collapsed to one box) reads as "off" so the box
  // never shows a false "fully on" for a partial state.
  const canEdit = Object.values(user.permissions).every(Boolean);

  function toggleCanEdit() {
    onChange({
      ...user,
      permissions: canEdit ? NO_PERMISSIONS : ADMIN_PERMISSIONS,
    });
  }

  return (
    <>
      {/* Fixed, not part of any one screen's own layout - floats at the
          same top-right spot on every screen that renders this at all
          (page.tsx's own showsPinnedLogo gate skips StepScreen
          entirely - see this component's own doc comment above). No
          explicit stacking above content - z-0 keeps it behind every
          popup in the app (the lowest of them is z-20 - see the grep of
          "fixed inset-0 z-" across src/components), the same "sits in
          the background, never floats over an open modal" spot the
          pinned Logo next to it already has just by being in normal
          document flow rather than fixed. Blue, not the neutral zinc it
          used to be - this is a real tappable button (opens the account
          popup), not passive chrome like the Logo it sits beside, so it
          reads as one now the same way every other icon-button in the
          app already does. Sized a notch smaller than it used to be, a
          quieter presence than something meant to be tapped often. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Driver account and permissions"
        className="fixed top-3 right-4 z-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-blue-600 active:bg-blue-50 active:text-blue-800"
      >
        <PersonSolidIcon className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 pt-16"
          onClick={() => setOpen(false)}
        >
          <div
            className="animate-popup-pop w-full max-w-sm rounded-xl bg-[var(--background)] p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-xl font-black tracking-tight">
                Account
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-zinc-400 active:text-zinc-600"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <Field
                label="Name"
                value={user.name}
                onChange={(name) => onChange({ ...user, name })}
              />
              <RoleField
                value={user.role}
                onChange={(role) => onChange({ ...user, role })}
              />
              <Field
                label="Email"
                type="email"
                value={user.email}
                onChange={(email) => onChange({ ...user, email })}
              />
              <Field
                label="Phone"
                type="tel"
                value={user.phone}
                onChange={(phone) => onChange({ ...user, phone })}
              />
            </div>

            <div className="mt-5 border-t border-zinc-200 pt-4">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Permissions
              </p>
              {/* Demo-only framing, not app copy that belongs anywhere
                  a real driver would see it once real accounts exist -
                  kept here rather than left implicit, so it's clear why
                  a driver's own account screen lets them toggle their
                  own permission at all. One box, not the six granular
                  ones this started as - everything-or-nothing until
                  there's an actual stakeholder ask for anything more
                  specific to build against (the individual Permissions
                  fields still exist, permissions.ts, unused by this UI
                  for now rather than removed). */}
              <p className="mt-0.5 text-xs text-zinc-400">
                For testing - toggle to see the app&apos;s own permission
                gates respond immediately. Granular permissions come
                later.
              </p>
              <button
                type="button"
                onClick={toggleCanEdit}
                aria-pressed={canEdit}
                className="mt-2 flex items-center gap-2 rounded-lg py-1.5 text-left text-sm font-medium text-zinc-900 active:bg-zinc-100"
              >
                <CheckboxIcon
                  checked={canEdit}
                  className="h-5 w-5 shrink-0 text-blue-600"
                />
                Can edit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** One labeled text input, account-info section's own repeated shape -
 * same input styling EditRouteScreen's own text fields already use
 * (rounded-lg border, blue focus ring), so this popup's form reads
 * consistently with every other text box in the app. */
function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel";
}): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {label}
      </span>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none ${
            value ? "pr-9" : ""
          }`}
        />
        {/* The same "clear search" X RouteListScreen/SchoolListScreen's
            own search boxes already use, applied here too - every
            free-text field in the app gets the same fast way to clear
            instead of select-all-backspace by hand. */}
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-zinc-400 active:text-zinc-600"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </label>
  );
}

/** The Role field - a fixed dropdown (ROLE_OPTIONS above) rather than
 * Field's free text, since a made-up role string couldn't mean
 * anything to anyone reading it yet either way. Same input styling as
 * Field's own text boxes so it reads as part of the same form. Whatever
 * value a user already has that isn't one of ROLE_OPTIONS (only
 * possible if that ever changes later) is still shown as its own
 * option, rather than silently swapped for the first one in the list. */
function RoleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Role
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      >
        {!ROLE_OPTIONS.includes(value) && <option value={value}>{value}</option>}
        {ROLE_OPTIONS.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
  );
}
