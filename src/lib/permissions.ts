/**
 * Named, per-action permissions - the granular alternative to a single
 * "adminMode" boolean, so a future real permissions table (one row of
 * these per user, or per group, once real authentication exists - see
 * README's own roadmap) slots in without every call site needing to
 * change: only permissionsFor's own body (below) gets swapped for a
 * real lookup. Every caller reads the one specific named permission it
 * actually needs ("canEditWaypoints"), never the whole object or a
 * generic "isAdmin" check, so a more restricted role later (someone who
 * can edit waypoints but not delete routes, say) never means auditing
 * every gated action again - each one already only checks the one flag
 * it cares about.
 *
 * Deliberately flat booleans, not nested under a "role" or "group" of
 * any kind - a role is just a named bundle of these same booleans, and
 * building that bundling machinery now, with no real user table to
 * attach it to yet, would be speculative. The day real accounts exist,
 * a "group" is simply a saved Permissions object several users share.
 */
export interface Permissions {
  /** Can reach the admin UI at all (RouteListScreen's own Edit Mode
   * toggle, and everything behind it) - the same coarse gate
   * `adminMode` (page.tsx) already was before this existed. Every
   * other permission below is meaningless without this one too, but
   * each is still checked independently rather than nested under it,
   * so a caller only ever asks the one specific question it has. */
  canAccessAdmin: boolean;
  canAddRoutes: boolean;
  canEditRouteDetails: boolean;
  canEditWaypoints: boolean;
  canDeleteRoutes: boolean;
  canPublishRoutes: boolean;
}

/** Every permission granted - the initial value the driver-menu
 * checkboxes (UserMenu.tsx) start from, and CurrentUser's own default
 * (currentUser.ts) for a session that's never touched localStorage.
 * Not otherwise privileged over any other Permissions object - once a
 * driver unchecks a box, `permissionsFor` (below) hands back whatever
 * they actually left checked, this constant included nowhere in that
 * path. */
export const ADMIN_PERMISSIONS: Permissions = {
  canAccessAdmin: true,
  canAddRoutes: true,
  canEditRouteDetails: true,
  canEditWaypoints: true,
  canDeleteRoutes: true,
  canPublishRoutes: true,
};

/** The signed-in driver's own permissions - `user` is CurrentUser's own
 * live, checkbox-editable state (currentUser.ts's useCurrentUser hook),
 * this demo phase's stand-in for a real per-user row a future
 * authentication system would look up instead. Deliberately NOT keyed
 * off `adminMode` (page.tsx's client-side Edit Mode toggle): that
 * toggle switches RouteListScreen's own admin view (draft routes
 * revealed, per-row publish/unpublish/delete controls, bulk selection)
 * on and off, which is a real, deliberate before/after a demo driver
 * still wants to control - it's a different question from "can this
 * person reach admin features at all" (canAccessAdmin, below), which
 * `adminMode` used to answer unconditionally "yes" to and now genuinely
 * depends on this same driver's own checkboxes. A real implementation
 * replaces this one function's body with a fetch/lookup keyed off the
 * signed-in user's real id, in place of reading `user.permissions`
 * straight off local/localStorage state - every other caller already
 * reads named fields off whatever Permissions object this function
 * hands back, never `user` or `adminMode` directly, so nothing else in
 * the app needs to change when that happens. */
export function permissionsFor(user: { permissions: Permissions }): Permissions {
  return user.permissions;
}
