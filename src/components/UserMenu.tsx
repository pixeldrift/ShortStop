"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CheckboxIcon, CloseIcon, DriverIcon } from "./icons";
import type { CurrentUser } from "@/lib/currentUser";
import type { Permissions } from "@/lib/permissions";

/** Every Permissions field (permissions.ts), paired with the plain-
 * English label this popup shows it under - one flat list, not grouped
 * under any "role" of its own (Permissions itself is deliberately flat
 * for the same reason - see its own doc comment), so a tap toggles
 * exactly the one gate it's labeled as, no bundling to second-guess. */
const PERMISSION_FIELDS: { key: keyof Permissions; label: string }[] = [
  { key: "canAccessAdmin", label: "Access admin (Edit Mode)" },
  { key: "canAddRoutes", label: "Create routes" },
  { key: "canPublishRoutes", label: "Publish routes" },
  { key: "canDeleteRoutes", label: "Delete routes" },
  { key: "canEditRouteDetails", label: "Edit route details" },
  { key: "canEditWaypoints", label: "Edit route waypoints" },
];

/** The driver icon that floats top-right on every screen (page.tsx
 * renders exactly one instance, same "one persistent instance outside
 * ScreenTransition" pattern the pinned Logo already uses - see its own
 * doc comment there) - tapping it opens this account/permissions
 * popup. `user`/`onChange` are page.tsx's own currentUser state
 * (currentUser.ts), edited directly here rather than through a
 * separate save step - every field change (a text box, a permission
 * checkbox) commits immediately, the same "no explicit Save" a plain
 * settings toggle anywhere else in the app already works like.
 *
 * The permissions checkboxes are this feature's actual point: a real
 * per-user permissions row doesn't exist yet (see permissions.ts's own
 * doc comment), so this is the one place a demo driver can flip any of
 * them on/off and immediately see the app's own gates (RouteListScreen's
 * New Route/publish/delete controls, EditRouteScreen's Details/
 * Waypoints editing, StepScreen's in-drive quick-edit) respond, without
 * needing a real signed-in account system built first. */
export function UserMenu({
  user,
  onChange,
}: {
  user: CurrentUser;
  onChange: (user: CurrentUser) => void;
}) {
  const [open, setOpen] = useState(false);

  function togglePermission(key: keyof Permissions) {
    onChange({
      ...user,
      permissions: { ...user.permissions, [key]: !user.permissions[key] },
    });
  }

  return (
    <>
      {/* Fixed, not part of any one screen's own layout - floats at the
          same top-right spot regardless of which screen is showing,
          including StepScreen's own compact TopBar (which has no room
          for it in its own 3-column grid). z-30 keeps it above ordinary
          screen content but below any open modal (most of which sit at
          z-20-z-40), so a modal already open never has this button
          floating on top of it. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Driver account and permissions"
        className="btn-glossy-blue fixed top-3 right-4 z-30 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white active:scale-95"
      >
        <DriverIcon className="h-6 w-6" />
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
              <Field
                label="Role"
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
                  own permissions at all. */}
              <p className="mt-0.5 text-xs text-zinc-400">
                For testing - toggle any of these to see the app&apos;s own
                permission gates respond immediately.
              </p>
              <div className="mt-2 flex flex-col">
                {PERMISSION_FIELDS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePermission(key)}
                    aria-pressed={user.permissions[key]}
                    className="flex items-center gap-2 rounded-lg py-1.5 text-left text-sm font-medium text-zinc-900 active:bg-zinc-100"
                  >
                    <CheckboxIcon
                      checked={user.permissions[key]}
                      className="h-5 w-5 shrink-0 text-blue-600"
                    />
                    {label}
                  </button>
                ))}
              </div>
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
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      />
    </label>
  );
}
