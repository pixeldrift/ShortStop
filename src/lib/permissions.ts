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

/** Every permission granted - this phase's own stand-in for a real
 * per-user permissions row, until real authentication exists.
 * permissionsFor (below) is the only thing that reads this constant
 * directly; every other caller in the app reads named fields off
 * whatever Permissions object that function hands back, so swapping
 * this phase's "everyone in Edit Mode gets everything" for a real
 * fetch/lookup is a change to permissionsFor alone. */
const ADMIN_PERMISSIONS: Permissions = {
  canAccessAdmin: true,
  canAddRoutes: true,
  canEditRouteDetails: true,
  canEditWaypoints: true,
  canDeleteRoutes: true,
  canPublishRoutes: true,
};

/** This session's own permissions - always the full set, for this demo
 * phase, since there's no real signed-in user to look one up for yet.
 * Deliberately NOT keyed off `adminMode` (page.tsx's client-side Edit
 * Mode toggle): that toggle switches RouteListScreen's own admin view
 * (draft routes revealed, per-row publish/unpublish/delete controls,
 * bulk selection) on and off, which is a real, deliberate before/after
 * a demo driver still wants to control - it's a different question
 * from "can this person reach admin features at all," which is what
 * Permissions answers, and today always answers "yes" to. A real
 * implementation replaces this one function's body with a fetch/lookup
 * keyed off the signed-in user (taking that user as a param, in place
 * of no params at all) - every caller already reads named fields off
 * whatever Permissions object it hands back, never `adminMode`
 * directly, so nothing else in the app needs to change when that
 * happens; a role with less than everything (someone who can edit
 * waypoints but not delete routes, say) starts working the moment this
 * function can tell them apart, no other caller touched. Returns the
 * one fixed constant above rather than building a fresh object each
 * call, so callers that memoize against it never see a spurious
 * "changed" reference. */
export function permissionsFor(): Permissions {
  return ADMIN_PERMISSIONS;
}
