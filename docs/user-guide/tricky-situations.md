# Tricky situations

Real routes have quirks that a map lookup cannot always resolve. This page
covers the ones operators hit most, and what to do about each.

## A road pair that shows up twice

**The situation.** The bus crosses (or meets) the same two roads at two
different places on one route. Typical examples:

- A loop road or circle that meets another road at both ends.
- A double-ended street, such as a road that enters a neighborhood at one end
  and leaves at the other, where both ends meet the same cross street.
- A route that goes down a road, turns around, and comes back past the same
  intersection later.

In each case the waypoint reads the same ("Cedar Park Cir & Holland Ridge
Dr") but means two different spots on the ground.

**Why it matters.** A location lookup knows the two road names, not which of
the two spots you mean. Left alone, both waypoints could end up pinned to the
same spot. The driver would then be told to stop in the wrong place, or the
bus would be "at" a stop before it actually gets there.

**What the app does for you.**

- When a lookup finds that a pair of roads meets in more than one place, the
  app keeps **both** points, and labels them by which way they sit relative to
  each other: **North / South** or **East / West**. The first one is pinned
  near the school.
- If you have that waypoint's edit popup open when the answer arrives, it
  appends a label such as **(North)** to the **Driver Notes**. It adds to any
  notes already there and never replaces them. This is a suggestion you can
  keep, reword or delete.
- Because notes are spoken, the driver hears the label ("North.") after the
  instruction, which helps them tell the two apart on the road. The road names
  themselves carry no direction.
- When the route is drawn and driven, the app walks it in order and, for each
  stop, picks whichever known point for that road pair is closest to the
  **previous** stop. That usually puts the second crossing at the second spot
  without any help from you.

**What you should do.** Do not assume the second crossing landed in the right
place. Check it, and fix it if not:

1. Fetch coordinates as usual, then open the **second** waypoint of the pair
   (the pencil on its row).
2. Look at its position on the small map. If it is on the wrong crossing, or
   on the same spot as the first one, fix it by hand:
   - Optionally add a direction to the **Driver Notes**, such as `(South)`.
   - Tap the map-pin button, **Manually place coordinates on a map**.
   - Drag the map so the fixed pin sits exactly on the intersection you mean.
     The route's blue line is drawn to help.
   - Choose **Override Once** (almost always the right choice - see below).
3. Tap **Save** in the popup, then **Save** on the screen.

> A single-row **fetch** will not move the second crossing for you. A fetch
> for the same road pair returns the known point nearest the school, which is
> the first crossing. For the second one, place the pin by hand.

### Override Once or Update Every Instance?

The pin-placement window has two buttons. They are very different.

| | **Override Once** | **Update Every Instance** |
| --- | --- | --- |
| What it changes | Only this waypoint, on this route | The shared location for that road pair, used by every route |
| When it takes effect | When you save the route | Immediately, even if you never save the route |
| Shows as | "Overridden - Location manually placed", with a **Clear** link | The new coordinate in the shared location cache |
| Use it when | This stop's spot is specific to this route (a second crossing, an unusual stop position) | The shared point is simply wrong everywhere (a bad map lookup) |

**Rule of thumb:** use **Override Once** for the second crossing of a road
pair. Use **Update Every Instance** only when the lookup itself got the
intersection wrong for every route that passes through it, and you are sure
that moving it everywhere is right.

Typing a latitude and longitude into the coordinates box behaves like
**Update Every Instance**: it is stored in the shared cache when you save.

### Fetching a row you overrode

Fetching a single overridden row opens **Replace Override?**, because a fresh
lookup would replace your hand-placed pin. Choose **Keep Override** to leave it
or **Replace** to look it up again. Batch fetches simply skip overridden rows.

To remove an override, open the row and tap **Clear** next to "Overridden -
Location manually placed".

## Loops, circles and cul-de-sacs

Two roads that do not meet at a plain intersection (a loop, a circle, or a
cul-de-sac bulb) cannot be found as a crossing. When you fetch the row, the
**Confirm Match** window may say the roads do not meet as a simple
intersection, and offer a point on one of the roads closest to your route.

That point is **an approximation, not a real crossing**. Accept it if it is
close enough for the stop, or reject it and place the pin by hand
(**Override Once**).

## Stops that are mid-block

An address-only stop in the middle of a block is the most important kind to
get right: it has no intersection for the driver to recognize, so the spoken
instruction ("Stop here at 120 Elm St") and the pin are everything.

- Enter it as an **address** (starts with the house number) so it is looked up
  as an address, not an intersection.
- Set **Side** and **Riders**. The driver hears "Pick up 4 students on the
  right."
- Fetch coordinates and look at the pin on the small map. If it is on the
  wrong side of the street, or on the wrong block, place it by hand.
- Add anything unusual to **Driver Notes** (for example "gray house, mailbox
  on the left"). Notes are spoken.

The app warns the driver as the stop approaches ("In 700 feet, stop at ...",
then "Stop ahead.") and then gives the full instruction while the bus is still
rolling in. How accurate the pin is determines how well those warnings are
timed.

## A stop and a turn at the same corner

If a stop is within about 65 feet of the next waypoint (a stop immediately
followed by a turn at the same corner), the app does not count down distances
between the two. It says the turn right after the stop's own announcement
("After that, you will be turning left onto ..."), and when the driver closes
the rider check-in box the app moves straight on to the turn.

## Instructions only waypoints

Some waypoints do not need a map position: a reminder, a hand-off note, a
spot too vague to pin. Tick **Instructions only - no location coordinates**.
The waypoint is spoken and shown to the driver, never placed on the map, and
never counted as unresolved. Because it has no map position, GPS has nothing
to detect for it, so the driver may need to tap **Next** to move past it. Use
it sparingly, and test the route on the road before publishing.

## Publishing with unverified locations

You may publish a route that has unresolved locations. The map may then be
inaccurate and GPS auto-advance may behave poorly near those points. Fix them
first if you can; use **Next** on the Waypoints screen to jump from one
unresolved waypoint to the next.

## Quick checklist for a new route

1. Create the route as a Draft with the right Trip and School.
2. Add every waypoint, with Side and Riders on stops.
3. **Fetch Coordinates**, then fix every red or unresolved row.
4. For any road pair the route uses twice, check the second crossing's pin and
   place it by hand if needed.
5. Open the route with **Show stops only** off and look over the whole line on
   the map.
6. If you can, drive it (or have a driver drive it) while it is still a Draft.
   Use the in-drive **Edit** button to fix a waypoint on the spot.
7. **Publish** from the route list.
