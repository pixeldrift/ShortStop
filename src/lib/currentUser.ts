import { ADMIN_PERMISSIONS } from "./permissions";
import type { Permissions } from "./permissions";

/** The signed-in driver, this demo phase's own stand-in for a real
 * account row - name/role/contact info alongside their own Permissions
 * (permissions.ts), all editable from one place (UserMenu.tsx) rather
 * than split across a separate "profile" and "permissions" screen.
 * Plain in-memory state (page.tsx's own useState, same pattern
 * `adminMode` already uses), not persisted anywhere - a page refresh
 * resets back to DEFAULT_CURRENT_USER below, which is fine for what
 * this exists to do today (toggle a permission, immediately see its
 * gate take effect); a real implementation replaces this with whatever
 * a signed-in session actually looks up. */
export interface CurrentUser {
  name: string;
  role: string;
  email: string;
  phone: string;
  permissions: Permissions;
}

/** Every permission granted, same as ADMIN_PERMISSIONS itself
 * (permissions.ts) - this demo's own starting point, matching what
 * `permissionsFor` always returned before CurrentUser existed, so nothing
 * anywhere in the app is more restricted on a fresh load than it was
 * before this feature. */
export const DEFAULT_CURRENT_USER: CurrentUser = {
  name: "John Smith",
  role: "Driver",
  email: "j.smith@example.com",
  phone: "555-123-4567",
  permissions: ADMIN_PERMISSIONS,
};
