# What drivers experience

Knowing what the driver sees and hears makes it clear what each edit changes.

## Starting a route

- The route's info page shows the route, school, stops and map. **Start
  Route** begins navigation. **View Stops** lists every stop.
- The first screen is the **depot** ("Ready to Depart" within five minutes of
  the scheduled start, otherwise "Depart at ..."). Pressing **Start** speaks
  the departure announcement, including whether the bus is on time, ahead of
  or behind schedule.

## While driving

- Every step speaks its instruction when it becomes current.
- **Early warnings** speak before a stop or turn: "In 500 feet, turn right
  onto Main Street," then a short cue just before ("Turn right." / "Stop
  ahead."). Stops get a longer lead because a bus needs more room.
- **Stops**: the full instruction ("Stop here at Weakly Street. Pick up 4
  students on the right.") is spoken while the bus is still approaching.
  Driver Notes follow it.
- **Advance is automatic** from GPS. A turn clears when the bus passes it. A
  stop clears when the bus has actually stopped there, held a few seconds, and
  pulled away. The footer's **Next** and **Back** buttons, the progress bar,
  and a Bluetooth media remote also move between steps.
- If the bus drives through a stop without stopping, the driver hears "You
  skipped the stop at ..." and the trip moves on.
- If the bus leaves the route for about eight seconds, navigation pauses
  ("You are no longer on the route. Pausing navigation.") and resumes by itself
  once the bus is back ("Back on route. Resuming navigation.").

## Rider check-in

At a stop with expected riders, a check-in box opens over the map and the
driver taps through the riders. It is hidden while the bus is moving, closes
itself when the bus pulls away, and has controls to look at other stops and to
add an unexpected rider.

Each user can turn it off: account menu, **Settings**, uncheck **Log riders**.
With it off, there is no pop-up at stops and no rider button on the map. The
spoken "Pick up N students" instruction is unchanged.

## The map

The map shows the bus, the route behind it, and the route ahead. Controls:
expand to full screen, and **Jump to current location** to re-center on the
bus. The stop pin shows the stop number and the expected rider count.

## Editing from the driver's seat

Operators (with **Can edit** on) see **Edit this waypoint** and **Add a
waypoint after this one** buttons on the current step. They open the same
popup, save immediately, and return to the same place in the trip. This is the
fastest way to fix a stop's pin, side or note while testing a route on the
road.

## Voices and pronunciation

- Road suffixes are spoken in full ("Dr" becomes "Drive", "Cr" becomes
  "Circle", "N" becomes "North").
- A road or place name the speech voice mispronounces can be fixed with a
  one-line substitution in `src/lib/speech.ts` (`PHONETIC_OVERRIDES`). Ask a
  developer to add an entry such as `enon: "Ee-non"`. It only changes how the
  name is spoken, never how it is displayed.
- The account menu's speech-balloon icon opens **Speech Lab** to preview the
  voices available on a device.
