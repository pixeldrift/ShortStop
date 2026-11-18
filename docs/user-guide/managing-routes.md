# Managing routes

## Getting into Edit Mode

1. Open the account menu (person icon, top right) and make sure **Can edit**
   is checked. Without it there is no Edit Mode and New Route, publishing and
   deleting are disabled.
2. On the route list, tap **Edit Routes** (under the table).
3. To leave, tap **Exit Edit Mode** or the back arrow.

In Edit Mode:

- Tapping a route opens its editor (outside Edit Mode it opens the trip).
- Draft routes appear in the list, dimmed.
- The heart column becomes an **eye** that shows and controls publish state.
- **New Route** and **Download** (routes.csv) appear below the list.

Handy list controls (each is a single icon you tap to cycle): trip type
(all / AM / PM / SP), school level, favorites, and in Edit Mode a
published/hidden filter. A toggle switches between a flat list and a grouped
view, with **Expand all groups** / **Collapse all groups**.

## Draft and Published

| State | Who sees it | Icon |
| --- | --- | --- |
| Published | Drivers and operators | Open eye |
| Draft | Operators only, in Edit Mode | Struck-through eye |

- Tap the eye on a **draft** and choose **Publish**. (**Delete** is offered
  there too, if you have permission.)
- Tap the eye on a **published** route and confirm **Unpublish**. The route
  goes back to Draft and stays editable.
- In the grouped view, the eye on a route-number or trip-type heading
  publishes or unpublishes everything in that group at once, with no
  confirmation.
- You can publish a route that still has unverified locations. The app warns
  you ("Some locations aren't verified yet - the map may not accurately
  display this route once published.") but does not stop you.
- There is no Publish button inside the editor. Publishing happens only from
  the route list.

## Creating a route

Tap **New Route**. You will see two collapsible sections, **Route Details**
and **Stops and Turns**.

### Route Details

| Field | Notes |
| --- | --- |
| **#** (or **# / Name**) | Required. The bus route number, e.g. `123`. For a Special trip it is a free-form name, e.g. `Zoo Trip`. |
| **Trip** | Required. AM (pickup), PM (dropoff), Special (field trip), or Other. |
| **Start** | Optional start time such as `7:05 AM`. Accepted: `H`, `H:MM`, `H:MM:SS`, with optional am/pm. With no am/pm, hours 1-11 on a PM route are read as PM; otherwise the time is taken as typed (24-hour). Saved as 24-hour. |
| **School** | Required for AM and PM routes, optional for Special and Other. Type a name or tap **Choose from address book**. A match shows as a chip with its address. |
| **Bus number** | Optional. |
| **Next Action** | What happens when the route ends: **Nothing - End Route**, **Return to Depot**, or **Begin Next Route** (another route of the same trip type). It defaults to the next school level up when one exists. |

The route's identity is built from route number, trip type and school level,
so renaming a route may create a new route id.

Pickup and dropoff routes need a School because it is the anchor for
looking up locations (see [Fetching coordinates](waypoints.md#fetching-coordinates)).

### Stops and Turns

You can add waypoints now or later:

- **Upload File** - a CSV or TSV. Route #, Trip and School are filled in from
  the file name and from its Depart/Arrive rows, but never over values you
  already typed.
- **Or paste manually** - one stop or turn per line, or delimited fields with
  a header row. Tap **Details** to see the accepted columns.
- Skip both and add waypoints one by one afterwards.

Tap **Create Route**. The route is created as a **Draft** and the edit hub
opens with "New Route Created!".

## The edit hub

Opening an existing route's editor shows the same Route Details form plus:

- A tally of how many waypoints are **valid** and how many are **unresolved**
  (see [verified locations](waypoints.md#verified-and-unverified)).
- **Edit Waypoints** - opens the waypoint list.
- **Duplicate Route** and **Reverse Route** (below).
- **Cancel** and **Save**. Save is disabled until you change something, and
  Cancel reads **Done** when nothing has changed.

### Duplicate Route

Saves an immediate copy as a Draft, with the route number prefixed `Copy-`.
Useful as a starting point for a similar route at a different school.

### Reverse Route

Builds the return trip as a new Draft with the route number prefixed
`Reverse-`:

- Waypoint order is reversed.
- Left and Right turns are swapped, Depart and Arrive are swapped, and the
  stop side is flipped.
- AM becomes PM and PM becomes AM (Special and Other stay as they are).
- The start time is cleared.

> **Always review a reversed route.** The reversal is deliberately simple. It
> cannot know about one-way streets, turn restrictions or median breaks, and
> the cross-street wording on turns usually needs a second look.

## Permissions

The account menu has one **Can edit** checkbox that switches every admin
feature on or off for the current browser: Edit Routes, New Route, editing
route details and waypoints, publishing, and deleting. Real, per-person
permissions are planned for when sign-in exists.

The **Role** field in the account menu (Admin, Driver, Tech) is cosmetic for
now.

## Schools and the address book

- The **Schools** link under the route list opens a read-only list of schools
  with search, level filters (ES / MS / HS), sorting, and a route count per
  school. Tapping a school shows its routes.
- Places that are not schools (a depot, a bus yard, a field-trip destination)
  live in the **address book**, reached from **Choose from address book**
  next to any School or Location field. Each entry shows a green or red icon
  for whether it has coordinates, and you can add or edit entries there.

## Printing

On the Waypoints screen, **Print** opens the browser's print dialog for a
driver sheet: route number, bus, school, trip type and start time, blank
Driver and Date lines, and a numbered list of every step with riders, side
and notes.
