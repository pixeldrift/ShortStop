# ShortStop User Guide

ShortStop gives school bus drivers hands-free, spoken turn-by-turn directions
along a district's own routes, and gives operators (district admins) the tools
to build and maintain those routes.

This guide is written for **operators**. It covers what the app can do, how to
add and edit routes, and the tricky situations that come up when building real
routes.

## Contents

| Guide | What it covers |
| --- | --- |
| [Managing routes](managing-routes.md) | Edit Mode, creating a route, the route details form, publishing, duplicating and reversing |
| [Building the waypoint list](waypoints.md) | Waypoint types, entering locations, reordering, fetching coordinates, bulk edit by file |
| [Tricky situations](tricky-situations.md) | Roads passed twice, loops and cul-de-sacs, manual pin placement, overrides, and other gotchas |
| [What drivers experience](driver-experience.md) | What the driver hears and sees, so you know what your edits change |

## What the app can do

**For drivers**

- Spoken turn-by-turn instructions for every stop and turn on a route, with
  early warnings ("In 500 feet, stop at...") and a short cue right before.
- A live map with the bus's position, the route ahead and the route behind.
- Automatic advance from GPS, so the driver never has to tap Next, with Next,
  Back, a Bluetooth media remote or the progress bar as manual fallbacks.
- A rider check-in box at stops with expected riders (can be turned off per
  user with the "Log riders" setting).
- Alerts for a skipped stop and for leaving the route.

**For operators**

- Create routes from scratch, from a pasted or uploaded CSV/TSV, or by
  duplicating or reversing an existing route.
- Edit any waypoint, reorder by dragging, and add or delete waypoints.
- Look up real map coordinates automatically, and place a pin by hand when
  the automatic lookup gets it wrong.
- Download a route's waypoints as a CSV, edit it in a spreadsheet, and
  upload the changes back.
- Print a driver sheet for any route.
- Keep routes in **Draft** while you work and **Publish** them when they are
  ready for drivers.
- Fix a waypoint from inside a drive (the Edit and Add buttons on the
  driving screen).

## Before you start

- **There is no sign-in yet.** Anyone with the link can use the app. The
  account menu (person icon, top right) has a "Can edit" checkbox that turns
  the admin features on or off for the current browser. See
  [Managing routes](managing-routes.md#permissions).
- **Nothing is saved until you press Save.** Edits to the waypoint list live
  on screen until the screen's own **Save** is pressed. The exceptions are
  called out where they happen (for example, "Update Every Instance" writes
  immediately).
- **Edit in Draft.** Drivers only see published routes. A draft can be
  edited freely without affecting anyone driving.
