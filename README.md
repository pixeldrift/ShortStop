# ShortStop
A Schoolbus Routing Solution

## First prototype

A minimal PWA that steps a driver through a route's navigation
instructions one at a time — the "first working demonstration" described
in the project doc: tap Start Route, turn-by-turn with spoken audio, stop
announcements, advanced via a Bluetooth media remote.

Built as a Next.js / React / Tailwind web app per the doc's stated tech
platform, rather than a native app, so it can be validated and deployed
quickly (Vercel) before any native investment.

No real map or GPS-triggered advancing yet (a placeholder map image now
sits in the upper third of the step screen — see Visual design below).
Route data is real: Bus 125's actual route sheet, transcribed to CSV
(`public/data/route-125.csv`) following the exact schema the doc
proposes (`sequence,time,action,from_at,onto_at,rider_count,notes`),
fetched and parsed client-side at load (`src/lib/parseRouteCsv.ts`).
`rider_count` is filled in with randomized placeholder values (1–10) for
each stop; `time` and `notes` are still blank since no real data exists
for them yet.

### Stack

- [Next.js](https://nextjs.org) (App Router, v16) — chosen mainly because
  it deploys to Vercel with zero config, which is where this is headed
- React + TypeScript
- Tailwind CSS

### Project layout

```
src/
  app/
    page.tsx           Renders the Start screen or the step screen
    layout.tsx          Root layout, metadata
    globals.css         Tailwind
  components/
    StartScreen.tsx     Route summary + trip stats + "Start Route" button
    StepScreen.tsx       The step-through screen, incl. rider check-in
    TopBar.tsx            Logo / route number / bus number header
    RouteProgressBar.tsx  The road-styled progress bar (see below)
    Logo.tsx               Wraps the logo asset at two sizes
    icons.tsx              Icons: turn-arrow image, pause/triangle/chevron/
                            person (outline + solid) SVGs
  lib/
    types.ts             Route / NavigationStep types
    parseRouteCsv.ts     CSV → Route parsing (see below)
    useRouteStepper.ts   State + all input wiring, incl. pause (see below)
    useRiderRoster.ts    Per-stop rider check-in state (see below)
    time.ts               addMinutesToTimeString - trip ETA math
    silence.ts           A tiny silent audio loop (see below)
public/
  manifest.json          PWA manifest
  data/route-125.csv     Bus 125's route data
  assets/
    logo.png              ShortStop wordmark
    pin.png                Stop marker (background removed)
    bus.png                Position indicator (background removed)
    turn-arrow.png          Turn-sign icon (supplied with transparent bg)
    map-placeholder.jpg     Placeholder art for the step screen's map area
```

### Running locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. Works in any modern browser; test the
Bluetooth remote on an actual iPad/iPhone in Safari.

### Deploying

Push to GitHub, then in Vercel: **Add New Project** → import this repo.
It's a separate Vercel project from anything else in your account (e.g.
Tabi) — same platform/login, its own deployment and domain, zero shared
config. No build settings to change; Vercel auto-detects Next.js.

All work so far lives on the `claude/ipad-iphone-nav-app-ss8dsk` branch —
`main` only has the original README. If Vercel's **Production Branch**
(Project Settings → Git) is set to `main`, that's why a deploy shows
"file not found": there's no app there yet. Either point Production
Branch at `claude/ipad-iphone-nav-app-ss8dsk`, or merge that branch into
`main`.

### Route data

`public/data/route-125.csv` follows the doc's proposed CSV schema:
`sequence,time,action,from_at,onto_at,rider_count,notes`. Transcribed
from Bus 125's handwritten route sheet (turns as `Left`/`Right` with the
road being left and the road being turned onto; `Stop` rows as the road
plus cross street, or a bare address). A few rows only give one road name
for a turn (e.g. row 12: `Left, Riverwood Ln`, `onto_at` blank) — the
parser treats a lone value as the turn's destination, matching the source
sheet's shorthand, but that's an interpretation worth double-checking
against the original sheet.

### Bluetooth hardware input

The Bluetooth clickers linked in the project doc (bike/handlebar-mount
remotes with rewind / play-pause / fast-forward buttons) use the AVRCP
media-control profile — the same mechanism that skips a podcast from a
pair of earbuds. In a browser, that surfaces as the
[Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API),
not as keyboard events.

`src/lib/useRouteStepper.ts` handles this:

- **Next / fast-forward / play-pause** → advance to next step
  (`nexttrack`, `play` action handlers)
- **Previous / rewind** → back to previous step (`previoustrack`)

As a fallback, it also listens for arrow/space/enter key presses, in case
a specific device pairs as a keyboard instead.

**Important browser-specific detail:** unlike some native platforms,
browsers only route media-remote button presses to a page that has an
*actively playing* media element — registering action handlers alone
isn't enough. `src/lib/silence.ts` is a tiny (0.25s) silent WAV, looped
via a hidden `<audio>` element starting the moment the driver taps "Start
Route" (which doubles as the user gesture browsers require before audio
can play). This is a standard technique, but it's untested against the
actual hardware — verify on a real device and real remote before relying
on it.

### Audio

Turn and stop announcements are spoken aloud via the Web Speech API
(`SpeechSynthesisUtterance`), matching the doc's audio-first UX — the
driver isn't expected to read the screen while moving. Announcement text
is generated from each CSV row's action/road names (see
`parseRouteCsv.ts`), not hand-authored, so it's serviceable but blunt
rather than polished driving directions.

Each step's `announcement` is an array of parts, not one string - a stop
speaks as three separate utterances ("Stop 3." / "Bill Stewart Road and
Hidden Forest." / "5 riders expected."), queued individually via
`speechSynthesis.speak()` in `useRouteStepper.ts` so there's an audible
pause between each rather than one run-on sentence. Road-suffix
abbreviations are spelled out for speech only (`speakRoadNames` in
`src/lib/speech.ts`: "Rd" → "Road", "Ln" → "Lane", "Pkwy" → "Parkway",
etc. - covers what's in `route-125.csv` plus the common USPS suffixes)
so the TTS engine doesn't read "Rd" as a word or garble it; on-screen
text keeps the abbreviated form.

### Visual design

The step screen (`StepScreen.tsx`) is split into three regions: a fixed
map strip on top, a scrollable middle (progress bar + step content, for
routes/rosters too tall to fit), and a footer that's always pinned so
Back/Pause/Next never require scrolling to reach.

- **Map**: the upper third of the screen (`h-[33vh]`) is a placeholder
  image (`map-placeholder.jpg`) with a "Demo only placeholder, not
  actual map" overlay - there's no real routing/map integration yet, see
  Next steps.
- **Header**: logo top-left, route number large and bold top-center
  (with a small "Route #" label above it), bus number top-right. Pinned
  below the map, doesn't scroll away.
- **Progress bar** (`RouteProgressBar.tsx`): styled like a road - gray
  bar, dark border, dashed white center line. Turn steps get a small
  circular marker with a mini direction arrow; stop steps get a small
  map-pin marker. With a 22-step route these would overlap into an
  unreadable clump at full density, so markers are thinned (greedy,
  left to right, minimum gap between shown markers) - the current step
  and both route endpoints always show, everything else only shows if
  it's far enough from the last shown marker. Markers sit in their own
  row above the road (not on top of it). A bus icon rides above that, at
  the current position, with a yellow/black caret pointing down at it;
  its position is clamped a bit short of 0%/100% so the icon (wider than
  a marker) doesn't get clipped by the screen edge at the very start/end.
- **Progress caption**: "Stop X of Y" rather than a raw instruction
  count - the number of turn steps between stops isn't meaningful to a
  driver, so it always shows the stop just reached or the one being
  driven toward (`stopNumberByIndex` in `useRouteStepper.ts`).
- **Turn steps**: the actual turn-arrow road sign (`turn-arrow.png`,
  user-supplied, already had a transparent background) instead of "TURN
  LEFT" text - large on the step screen, small on the progress bar's
  markers - mirrored horizontally for a left turn, since the source art
  is a right turn. Street name renders below it in much larger type than
  anything else on screen.
- **Stop steps**: the pin icon, with the stop number set inside its
  white circle (absolutely positioned over the image - tuned by eye
  against a screenshot, not derived from the art's actual geometry, so
  it'll need re-tuning if `pin.png` ever changes) instead of a separate
  "STOP n of m" line, which the header's "Stop X of Y" caption already
  covers. Same large-street-name treatment as turn steps.
- **Controls**: filled-triangle Back/Next buttons (larger icons than
  before) with a round, blue Pause button between them. Pausing shows a
  "Route Paused" message in place of the step content, disables
  Back/Next and screen-tap-to-advance, stops the spoken announcement,
  and - since the Bluetooth remote is the primary input - ignores
  `nexttrack`/`previoustrack`/`play` events from it too, so a stray
  remote press doesn't sneak the route forward while paused. Tapping
  Pause again (now showing a play triangle) resumes.

`public/assets/pin.png` and `bus.png` started as stock/generated images
with solid (checkerboard and white, respectively) backgrounds; both were
background-removed with a flood-fill script (border-connected near-white
regions → transparent) before being added here, so they composite
cleanly over the road bar and the rest of the UI. `turn-arrow.png`
already had a transparent background as supplied.

### Rider check-in

At each stop, `StopContent` renders one button per expected rider
(`step.studentCount`, from the CSV's `rider_count`), numbered underneath
- an outline person icon means not yet checked in, a solid one means
checked in. Tapping rider N works like a star rating: it checks in
everyone from 1 through N and un-checks anyone after N, rather than
toggling one at a time (`fillTo` in `useRiderRoster.ts`) - there's no
separate "check all" control, since tapping the last rider does that.
**+** (styled the same as the numbered buttons, an outline person with a
small "+" inside it) appends one more rider, already checked in (it's
recording someone who's visibly boarding right now, not someone
expected) - it doesn't participate in the star-rating fill, so it can
leave a "gap" (e.g. riders 1-2 checked, 3-5 not, plus one added rider
checked) if the driver hasn't finished checking in the expected riders
yet. That's intentional: the added rider is a real, separate event, not
a retroactive claim that 3-5 also boarded.

State lives in `useRiderRoster.ts`, instantiated once in `RouteApp`
(`page.tsx`) rather than inside the stop screen itself, so it survives
navigating back and forth between stops - checking in riders at stop 3,
then tapping Back to stop 2, still shows stop 2's own roster exactly as
left. The running **N onboard** badge next to the header's "Stop X of Y"
caption sums checked-in riders across every stop on the route so far,
and stays visible on turn steps too (not just at stops) - the idea being
a driver can get a headcount at any point during an incident, not only
while parked at a stop. It only ever adds (pickup-only route, no
drop-offs modeled yet - see Next steps).

### Next steps

- Fill in the CSV's missing `time` and `notes` columns (departure/stop
  times, special instructions) once that data exists
- It'd be nice to show each stop's estimated time alongside the actual
  current time, once real stop-time estimates exist (depends on the
  `time` column above and, eventually, real routing/traffic data) - lets
  a driver see at a glance whether they're running ahead or behind
- `driverName: "Otto Mann"`, `distance: "8.4 mi"`, and
  `durationMinutes: 28` in `page.tsx` are all placeholders, not real
  data - swap them in once there's an actual driver/routing source
- The progress bar's marker-thinning is a stopgap for density, not a
  real fix - a scrollable/zoomable bar, or clustering nearby stops into
  one marker with a count, would scale better on longer routes
- Move route data into the doc's actual data model
  (District/School/Route/RouteStop/etc.) instead of a flat CSV, once
  there's more than one route
- Real map integration in place of the placeholder image, tied to
  wherever the bus actually is
- GPS-based auto-advance as students are picked up / stops are passed —
  the doc treats manual button-advance as the first-prototype mechanism
  and GPS auto-advance as a later step
- Rider check-in state resets on page reload (it's in-memory React
  state, not persisted) - fine for a demo, not for a real trip
- Drop-off stops/routes aren't modeled, so onboard count can only ever
  go up; a real deployment needs riders leaving the bus too
- Real PWA icons (`public/manifest.json` currently has none) and an
  install prompt, so it can live on the dashboard tablet's home screen
- Persist route progress / handle the tab backgrounding mid-route
- A native driver app remains the doc's long-term plan for the
  GPS/background/offline-heavy driver experience; this web prototype is
  step one, not a replacement for that
