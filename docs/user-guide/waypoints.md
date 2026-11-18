# Building the waypoint list

A route is an ordered list of **waypoints**: the stops and turns the bus makes.
Open a route's editor and tap **Edit Waypoints** to work on it.

## Waypoint types

Choose a waypoint's type in the **Type** select.

| Type | Use it for | The driver hears |
| --- | --- | --- |
| **Depart** | The start of the route (defaults to the route's school) | "Depart from ..." |
| **Stop** | A place riders get on or off | "Stop here at Elm St & Oak Ave. Pick up 4 students on the right." (PM routes say "Drop off") |
| **Stop Sign** | A full stop that is not a rider stop, typically just before a railroad crossing | "Stop Sign at ..." |
| **Railroad Crossing** | Placed on the tracks | "Railroad Crossing at ..." |
| **Turn Left / Turn Right** | A turn onto another road | "Turn left onto Main St." |
| **Continue** | Staying on a road | "Continue on ..." |
| **U-Turn** / **Turn Around** | Reversing direction | "U-Turn on ..." / "Turn Around onto ..." |
| **Proceed** | Going on to a place | "Proceed to ..." |
| **Pull Over** | Pulling off the road | "Pull Over onto ..." |
| **Return** | Heading back to a place | "Return to ..." |
| **Arrive** | The end of the route (defaults to the route's school) | "Arrive at ..." |

**Stops** have extra fields:

- **Side** - Left or Right, which side of the road the riders are on.
- **Riders** - how many are expected (1-10). This drives the rider check-in
  box and the spoken "Pick up N students".

Every type has a **Driver Notes** field. Notes are **spoken aloud** after the
instruction and shown on the driver's screen.

A row with no type, an unrecognized type, or no location is flagged in red.

## Entering a location

The edit popup has two fields: **From** and **Location**.

- **A street address** (starts with a house number, e.g. `120 Elm St`) is
  looked up as an address.
- **Two roads** (an intersection) is looked up as a crossing. Type the road
  you are on in **From** and the other road in **Location**, or type
  `Elm St & Oak Ave` in Location.
- **From** is usually left blank. The app infers it from the previous
  waypoints: after a turn, the road you turned onto becomes the road you are
  on. Set **From** explicitly when the bus has jumped somewhere (for
  example, the first stop after leaving the school).
- **A school or address-book place** can be picked by name, and it resolves
  immediately if it has coordinates.
- Names containing **ramp** or **roundabout** are never looked up on the map.
  **Driveway** and **parking lot** resolve to the school address.
- **Instructions only - no location coordinates** is a checkbox for a
  waypoint that should be spoken but never placed on the map. It then shows
  "- Instructions Only -" and is not counted as unresolved.

The **Location** box suggests road names as you type, drawn from names the app
has already seen.

## Editing the list

- **Edit** - tap the blue pencil on a row.
- **Reorder** - press and hold the drag handle and drop on the target
  ("Drop Here").
- **Add** - tap a blue **+** before the first row or after any row. The popup
  title is "Add Waypoint"; save it to put it in the list.
- **Delete** - open the row and tap **Delete**.
- **Previous / Next arrows** in the popup header step through the list, and
  the **+** there adds a new waypoint after the current one.
- **Cancel** discards the popup's edits. **Save** in the popup only commits to
  the list on screen; the screen's own **Save** is what stores it.

Between rows there are two small icons on the dashed line:

- **Scissors (Split route here)** - carves the waypoints above or below that
  point into a new route, either moving or copying them.
- **Compass (Autoroute)** - fills in real turn-by-turn directions between the
  two stops on either side. Both neighbours must already have coordinates.

The toolbar above the list has a stop count, a toggle between **stops only**
and **stops and directions**, a toggle to **show errors only**, and a **Next**
button that jumps to the next unresolved waypoint.

Stop numbers are fixed by position and do not change when you filter.

## Fetching coordinates

Waypoints need real map coordinates so the driver sees them on the map and so
GPS can tell when the bus has reached them. Tap **Fetch Coordinates...**:

- **Fetch Missing** looks up only waypoints that have no coordinates yet.
- **Re-fetch All** looks up everything.
- A progress bar shows "Fetching N of M..." and the **Missing** and **Valid**
  tallies update as it goes.
- Rows you placed by hand (an override) are skipped.

You can also fetch a single row with the globe button in its edit popup.

Fetching needs the route's **School** to be a real school or an address-book
place with coordinates. Every waypoint also needs a type and a location first;
otherwise the app tells you "Every stop needs at least a type and a location
before locations can be checked."

If the lookup is rate-limited you will see "OpenRouteService's rate limit was
reached - wait a bit before fetching more." Wait a minute and try again.

### Verified and unverified

A waypoint is **verified** when it has coordinates (from a lookup or placed by
hand). The screen shows "All N locations verified" or "X of N coordinates
could not be verified". Instructions-only rows are not counted either way. A
row that is not found shows why, for example `"Elm Ct" not found`, and if
another stop on the route confirmed one of the roads, it says so.

### When the lookup is not sure

Fetching a **single row** (the globe button) may offer a correction in a
**Confirm Match** window instead of silently guessing. It explains what it
searched for and what it found, for example:

- a nearby road with a different street type that looks like the same one
- a similar spelling
- the same distinctive name with a different or missing direction
- two roads that do not meet at a simple intersection (often a loop or
  circle), placed at the closest point to your route

Nothing is saved until you choose **Accept**; **Reject** leaves the row as it
was. The batch buttons never apply corrections, so these only appear when you
fetch one row at a time.

## Editing a route as a spreadsheet

For large changes, edit the route in a spreadsheet.

1. On the Waypoints screen, tap **Download**. You get `<route>-stops.csv`
   with these columns: `row_number, action, location, from_location,
   rider_count, side, notes, skip, status, lat, lon`. The last three
   (`status`, `lat`, `lon`) are for your information and are ignored when you
   upload.
2. Edit it. Do not change `row_number` on rows you want to keep.
3. Tap **Upload**, choose the file (or paste), and tap **Apply**.

How the upload is applied:

| In your file | Result |
| --- | --- |
| A row with a `row_number` | Updates that existing waypoint |
| A blank cell | Keeps the current value |
| The word `null` | Clears that field |
| A row with no `row_number` | Added as a new waypoint |
| An existing waypoint with no row in the file | Deleted |
| A `row_number` that matches nothing | Error - fix it or clear it to add as new |

Nothing is stored until you press the screen's **Save**.

> **Caution: commas in notes.** The importer splits on the delimiter without
> understanding quotes. If a Driver Note contains a comma, re-uploading the
> downloaded CSV will misread that row. Save the file as **tab-separated**
> (TSV) instead, or avoid commas in notes.

Column headers can be in any order and are matched loosely. Only `action` and
`location` are ever required. A file with no header row is read as one stop
or turn per line, and `Elm St & Oak Ave` is split into its two roads.
