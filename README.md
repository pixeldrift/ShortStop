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

No maps or GPS-triggered advancing yet. Route data is real: Bus 125's
actual route sheet, transcribed to CSV (`public/data/route-125.csv`)
following the exact schema the doc proposes
(`sequence,time,action,from_at,onto_at,rider_count,notes`), fetched and
parsed client-side at load (`src/lib/parseRouteCsv.ts`). It only has
turn-by-turn directions and stop locations so far — no times, rider
counts, or special instructions in this transcription — so those fields
render empty for now rather than being invented.

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
    StartScreen.tsx     Route summary + "Start Route" button
    StepScreen.tsx       The step-through screen
    TopBar.tsx            Logo / route number / bus number header
    RouteProgressBar.tsx  The road-styled progress bar (see below)
    Logo.tsx               Wraps the logo asset at two sizes
    icons.tsx              Inline SVG icons (arrow, pause, play, chevron)
  lib/
    types.ts             Route / NavigationStep types
    parseRouteCsv.ts     CSV → Route parsing (see below)
    useRouteStepper.ts   State + all input wiring, incl. pause (see below)
    silence.ts           A tiny silent audio loop (see below)
public/
  manifest.json          PWA manifest
  data/route-125.csv     Bus 125's route data
  assets/
    logo.png              ShortStop wordmark
    pin.png                Stop marker (background removed)
    bus.png                Position indicator (background removed)
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
("Turn left onto Riverwood Ln.") rather than polished driving directions.

### Visual design

The step screen (`StepScreen.tsx`):

- **Header**: logo top-left, route number large and bold top-center
  (with a small "Route #" label above it), bus number top-right.
- **Progress bar** (`RouteProgressBar.tsx`): styled like a road - gray
  bar, dark border, dashed white center line. Turn steps get a small
  circular marker with a mini direction arrow; stop steps get a small
  map-pin marker. With a 22-step route these would overlap into an
  unreadable clump at full density, so markers are thinned (greedy,
  left to right, minimum gap between shown markers) - the current step
  and both route endpoints always show, everything else only shows if
  it's far enough from the last shown marker. A bus icon rides above the
  bar at the current position, with a small caret pointing down at it;
  its position is clamped a bit short of 0%/100% so the icon (wider than
  a marker) doesn't get clipped by the screen edge at the very start/end.
- **Turn steps**: a very large direction arrow (left/right) instead of
  "TURN LEFT" text, with the street name below it in much larger type
  than anything else on screen.
- **Stop steps**: the pin icon instead of/alongside "STOP n of m", same
  large-street-name treatment.
- **Controls**: Back (`<`) / Next (`>`) buttons with a round Pause button
  between them. Pausing shows a "Route Paused" message in place of the
  step content, disables Back/Next and screen-tap-to-advance, stops the
  spoken announcement, and - since the Bluetooth remote is the primary
  input - ignores `nexttrack`/`previoustrack`/`play` events from it too,
  so a stray remote press doesn't sneak the route forward while paused.
  Tapping Pause again (now showing a play icon) resumes.

`public/assets/pin.png` and `bus.png` started as stock/generated images
with solid (checkerboard and white, respectively) backgrounds; both were
background-removed with a flood-fill script (border-connected near-white
regions → transparent) before being added here, so they composite
cleanly over the road bar and the rest of the UI.

### Next steps

- Fill in the CSV's missing `time`, `rider_count`, and `notes` columns
  (departure/stop times, student counts, special instructions) once
  that data exists
- `driverName: "Otto Mann"` in `page.tsx` is a placeholder, not real
  driver data - swap it in once there's an actual driver to assign
- The progress bar's marker-thinning is a stopgap for density, not a
  real fix - a scrollable/zoomable bar, or clustering nearby stops into
  one marker with a count, would scale better on longer routes
- Move route data into the doc's actual data model
  (District/School/Route/RouteStop/etc.) instead of a flat CSV, once
  there's more than one route
- Map view (the doc's MVP calls for displaying the route on a map, not
  just text instructions)
- GPS-based auto-advance as students are picked up / stops are passed —
  the doc treats manual button-advance as the first-prototype mechanism
  and GPS auto-advance as a later step
- Real PWA icons (`public/manifest.json` currently has none) and an
  install prompt, so it can live on the dashboard tablet's home screen
- Persist route progress / handle the tab backgrounding mid-route
- A native driver app remains the doc's long-term plan for the
  GPS/background/offline-heavy driver experience; this web prototype is
  step one, not a replacement for that
