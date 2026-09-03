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

`public/data/route-125.csv` follows the doc's proposed CSV schema, plus
one addition:
`sequence,time,action,from_at,onto_at,rider_count,side,notes`.
Transcribed from Bus 125's handwritten route sheet (turns as
`Left`/`Right` with the road being left and the road being turned onto;
`Stop` rows as the road plus cross street, or a bare address). A few rows
only give one road name for a turn (e.g. row 12: `Left, Riverwood Ln`,
`onto_at` blank) — the parser treats a lone value as the turn's
destination, matching the source sheet's shorthand, but that's an
interpretation worth double-checking against the original sheet.

`side` (`Left`/`Right`) is only meaningful on `Stop` rows — which side of
the road the stop is on, so the driver knows which way to expect riders
without guessing from the map. The real route sheet doesn't record this
yet, so every stop's value here is randomly assigned as a placeholder
(see the red arrow next to the pin icon in `StopContent`, described
under Visual design above, and `parseRouteCsv.ts` for the spoken "On the
right"/"On the left" announcement) — replace with the real values once
they exist.

`notes` is spoken and shown on screen the same way as a turn's - two
stops carry a placeholder note as an example of what this field is for:
Bill Stewart Rd & Ruth Ln has "Wheelchair user requires assistance",
Judge Mason & Carmen Way has "Rider waits inside for safety until bus
arrives". A stop's note is spoken last, after the rider-count part of
its announcement (`parseRouteCsv.ts`), and shown on screen right below
the street name as plain text (no highlighted box - an earlier version
put one around it, matching the yellow box a turn's special instruction
uses, but a lone note reads as informational rather than a warning, so
the box was dropped for stops and turns alike). That line is always
rendered, with a `min-h-[1.4em]` floor, whether or not the current step
actually has a note - otherwise the street name and everything below it
would shift up a line on a step without one, which reads as
distracting/jumpy when it happens on every other stop.

### Bluetooth hardware input

The Bluetooth clickers linked in the project doc (bike/handlebar-mount
remotes with rewind / play-pause / fast-forward buttons) use the AVRCP
media-control profile — the same mechanism that skips a podcast from a
pair of earbuds. In a browser, that surfaces as the
[Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API),
not as keyboard events.

`src/lib/useRouteStepper.ts` handles this:

- **Next / fast-forward** → advance to next step (`nexttrack`)
- **Previous / rewind** → back to previous step (`previoustrack`)
- **Play/pause** → most of these remotes have one button for this, not
  separate play and pause buttons; the OS decides which action to send
  based on the page's own *reported* `playbackState`, not the physical
  button itself. So while driving (`playbackState: "playing"`), a press
  sends `play`, treated the same as `nexttrack` - advance to the next
  step, matching the doc's "play-pause is the primary go gesture."
  While paused (`playbackState: "paused"`, kept in sync with the app's
  own paused state), the same button instead sends `pause` or `play`
  depending on what the OS/remote believes it's toggling from - both are
  handled (`pause` pauses, `play` resumes) so either one un-pauses the
  route rather than silently doing nothing, which is what happened
  before `playbackState` was kept in sync: it stayed permanently
  `"playing"`, so a remote could get stuck only ever sending one action
  and never the other.

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
speaks as four separate utterances ("Stop 3." / "Bill Stewart Road and
Hidden Forest." / "On the right." / "5 riders expected."), queued
individually via `speechSynthesis.speak()` in `useRouteStepper.ts` so
there's an audible pause between each rather than one run-on sentence.
Road-suffix abbreviations are spelled out for speech only
(`speakRoadNames` in `src/lib/speech.ts`: "Rd" → "Road", "Ln" → "Lane",
"Pkwy" → "Parkway", etc. - covers what's in `route-125.csv` plus the
common USPS suffixes) so the TTS engine doesn't read "Rd" as a word or
garble it; on-screen text keeps the abbreviated form.

The route itself also gets a "Starting route." announcement, spoken
right before the first step's own announcement the moment the driver
taps "Start Route", and a "Route completed." announcement, spoken right
after the final step's own announcement. Both are queued in the same
`speechSynthesis.speak()` batch as the step's own parts (in
`useRouteStepper.ts`) rather than in a separate effect, since a separate
effect's own `speechSynthesis.cancel()` call would otherwise wipe out
whichever one queued first before it had a chance to play.

### Visual design

Built for a tablet mounted on the dashboard, not a phone someone scrolls
- so the whole app is locked to the viewport (`h-dvh overflow-hidden` on
`body` in `layout.tsx`) and nothing on it scrolls, ever. The step screen
(`StepScreen.tsx`) is split into a map/rider region and everything else
(header, progress bar, step content, footer) - stacked map-on-top in
portrait, side by side map-on-the-left in landscape, via Tailwind's
`landscape:` variant (`flex-col landscape:flex-row` on the root, with
the map/rider region switching from `h-[30vh] w-full` to
`landscape:h-full landscape:w-[42%]`). Landscape is the more likely real
orientation for a dash-mounted tablet, and the one where stacking would
have wasted the most width on an unused map. Content that would
otherwise overflow is scaled down to fit via CSS `clamp()` on font/icon
sizes (more on that below) rather than being allowed to scroll or
getting clipped - verified across both iPad portrait (820×1180) and iPad
landscape (1180×820) viewports.

- **Map/rider region**: a fixed-size block - the top third in portrait,
  the left 42% in landscape - holding the placeholder map image at all
  times. On a stop with expected riders, the rider check-in box (see
  Rider check-in below) floats over that same spot as its own smaller,
  opaque, shadowed card (sized to 86%×78% of the region, centered),
  rather than replacing the map outright - the map stays visible all
  around it, dimmed by an extra `bg-black/35` layer, so it never fully
  disappears and there's always enough of the dimmed map showing at the
  edges to read as "still there, just covered for now." Reserving the
  same overall region size either way - map or map-plus-roster, never
  neither - means the header and main content in the rest of the screen
  always sit at the identical position, whether the current step is a
  turn or a stop - confirmed by comparing the header's on-screen position
  between the two rather than just assuming the CSS does what it's
  supposed to.
- **Map/content divider**: a thin glossy blue bar (`.btn-glossy`, the
  same bevel/shadow/highlight treatment as the buttons) between the
  map/rider region and everything else - a horizontal bar under the map
  in portrait, a vertical bar to the map's right in landscape.
- **Header**: logo top-left, route number large and bold top-center
  (with a small "Route #" label above it), bus number top-right. Pinned
  at the top of the "everything else" region (below the map/rider region
  in portrait, to its right in landscape), doesn't scroll away.
- **Progress bar** (`RouteProgressBar.tsx`): styled like a road - gray
  bar, dark border, dashed white center line (precisely centered via
  `top-1/2 -translate-y-1/2`, not just `top-1/2` on a zero-height
  element, which left it a hair off), with a small circle - a little
  larger than the bar's own height - capping each true end of the track
  like a cul-de-sac. Turn steps get a small circular marker with a mini
  direction arrow, sitting close above the road without touching it
  (`bottom-5`); stop steps get a small map-pin marker at the same height.
  Every step gets its own
  marker at a fixed 48px spacing (`PX_PER_STEP`) - no thinning/hiding -
  so a longer route just makes the underlying track wider than the
  visible window instead of crowding markers together. That window
  (`overflow-hidden` outer container) shows a `ResizeObserver`-measured
  slice of the track, auto-scrolled (via a CSS `transform:
  translateX()`, not native scrolling - nothing on this app scrolls, see
  above) to keep the current position roughly centered, clamped so it
  never scrolls past either end of the track - concretely, that clamp is
  what makes the bus track toward the screen's center as the route
  starts, hold dead center for as long as there's track on both sides to
  show, then stop being re-centered once the trailing/leading edge of
  the whole route comes into view (the offset pins to its min/max) and
  instead keep sliding the rest of the way to the true edge, exactly
  like a side-scroller camera that stops panning once it hits the level
  boundary. A CSS `mask-image` fades whichever edge(s) actually have
  hidden content - neither edge fades if the whole route fits without
  scrolling, only the trailing edge fades near the very start, only the
  leading edge fades near the very end. A bus icon sits directly
  overlaid on the road at the current position, given a slight
  `drop-shadow-sm` and a `z-10` above the road/markers so it visually
  rides on top of the bar rather than hovering above it with a caret
  pointing down, which is what it did before. It's vertically centered
  on the road's own center (`bottom-2 translate-y-1/2` - the *positive*
  half-height nudge is what actually lands it there: `bottom` alone
  anchors the icon's bottom edge, not its middle, so centering on that
  anchor point needs a translate in the same direction the box already
  extends, not the opposite one. This was backwards for a while - a
  `-translate-y-1/2` there quietly floated the bus a full icon-height
  above the road instead of centering it, caught by measuring both
  elements' actual bounding boxes in a headless browser rather than
  trusting the CSS by eye). Its horizontal position is clamped a bit
  short of the track's own start/end so the icon (wider than a marker)
  doesn't get clipped there. The container's `px-6` padding leaves enough
  room that the cul-de-sac circles capping each end of the track (see
  above) are never clipped either, even though they hang half outside
  the track's own bounds - verified the same way, by measuring the
  circles' rendered edges against the container's, at both true ends of
  the route.
- **Progress caption**: "Stop X of Y" rather than a raw instruction
  count - the number of turn steps between stops isn't meaningful to a
  driver, so it always shows the stop just reached or the one being
  driven toward (`stopNumberByIndex` in `useRouteStepper.ts`).
- **Turn steps**: the actual turn-arrow road sign (`turn-arrow.png`,
  user-supplied, already had a transparent background) instead of "TURN
  LEFT" text - large on the step screen (`clamp(3.5rem,14vh,8rem)`,
  trimmed down a size from where it started), small on the progress
  bar's markers - mirrored horizontally for a left turn, since the
  source art is a right turn. Street name renders below it in larger
  type than anything else on screen (`clamp(1.35rem,5.25vh,2.75rem)`,
  also trimmed down from its original, larger clamp range).
- **Stop steps**: the pin icon (same trimmed-down `clamp(3.5rem,14vh,8rem)`
  as the turn arrow), with the stop number set inside its white circle
  (absolutely positioned over the image - tuned by eye against a
  screenshot, not derived from the art's actual geometry, so it'll need
  re-tuning if `pin.png` ever changes) instead of a separate "STOP n of
  m" line, which the header's "Stop X of Y" caption already covers. Same
  street-name treatment as turn steps. Which side of the road the stop
  is on (`step.sideOfRoad`, from the CSV's `side` column) is shown as a
  filled triangle (`TriangleIcon`, the same shape used on the Back/Next
  buttons) right next to the pin - on the pin's left for a left-side
  stop, its right for a right-side stop - colored to match the pin
  art's own red (`#d54e48`, sampled from the pixels in `pin.png` itself
  rather than guessed, since Tailwind's `red-700` turned out noticeably
  more brick-red than the art). It's a bare triangle now, not a button -
  an earlier version wrapped it in a glossy circular badge, which read
  as another tappable control next to a pin that isn't one; it's also
  scaled to two-thirds width relative to its height (unlike the
  perfectly-triangular `TriangleIcon` on the actual buttons) so the
  point reads as a softer, more "which-way" directional hint than a
  sharp arrowhead. It's positioned at `top-[31%]` with `-translate-y-1/2`,
  the exact same anchor the stop-number span uses, so its center lines
  up with the center of the pin's white circle/number regardless of how
  big the pin itself is rendering at a given viewport height. This
  replaced an on-screen "Stop on the right/left side" text line - now
  conveyed visually instead - which freed up that line for notes (see
  below).
- **Controls**: filled-triangle Back/advance buttons with a round, blue
  Pause button between them. The advance button always reads "Next" now,
  on both turn and stop steps - it used to switch to "Continue Route" on
  stops, but that made the same button read differently depending on
  step type for no real benefit, and the rider check-in box now has its
  own dedicated advance control (see Rider check-in below) for the "I've
  checked riders in, keep driving" case. Pausing shows a "Route Paused"
  message in place of the step content, disables both buttons and
  screen-tap-to-advance, stops the spoken announcement, and - since the
  Bluetooth remote is the primary input - ignores
  `nexttrack`/`previoustrack`/`play` events from it too, so a stray
  remote press doesn't sneak the route forward while paused. Tapping
  Pause again (now showing a play triangle) resumes.
- **Step transitions**: switching steps no longer instantly swaps the
  icon and street name/signage - the incoming content slides up from
  below with a small overshoot bounce, while the outgoing content slides
  up and fades out on top of it, via a small `StepTransition.tsx`
  wrapper. The bounce comes entirely from the enter animation's easing
  curve (a "back-out" `cubic-bezier(0.34, 1.56, 0.64, 1)`, which
  overshoots past its end value before settling), not extra keyframe
  steps. The new content stays in normal document flow the whole time -
  it's still what determines the rendered height of this area, so the
  two-line street-name guarantee that makes the map shrink to
  accommodate it (see below) keeps working unchanged; only the *outgoing*
  content is briefly pulled out of flow (absolutely positioned on top)
  for the ~300ms it takes to animate away, keyed by step id (or
  `"paused"`) so a genuine step change is what triggers it, not every
  re-render.

### Forcing a single light theme

The app is meant to always look the same - a fixed light theme for a
tablet mounted on a bus dashboard, not something a driver would want to
follow their phone's dark mode. `globals.css` used to flip
`--background`/`--foreground` to near-black/near-white under
`@media (prefers-color-scheme: dark)`, left over from `create-next-app`'s
default template; a handful of components also had `dark:` Tailwind
variants on borders/badges from the same source. Neither was ever
exercised during development (which happens in browsers/environments
that don't default to dark mode), so it went unnoticed until it showed
up as a black background on an actual phone with system dark mode on.
Fixed by removing the dark-mode media query and every `dark:` variant in
the codebase, and setting `color-scheme: light` on `:root` so browser-native
UI (form controls, scrollbar chrome, etc.) doesn't try to go dark either
- confirmed by loading the app with Playwright's color-scheme emulation
forced to `"dark"` and checking the background stays the cream
`#f7f3ea`, not black.

`public/assets/pin.png` and `bus.png` started as stock/generated images
with solid (checkerboard and white, respectively) backgrounds; both were
background-removed with a flood-fill script (border-connected near-white
regions → transparent) before being added here, so they composite
cleanly over the road bar and the rest of the UI. `turn-arrow.png`
already had a transparent background as supplied.

**Scaling to fit, not scrolling**: the turn/stop icon, the street name,
and a few smaller labels use Tailwind arbitrary values like
`text-[clamp(1.35rem,5.25vh,2.75rem)]` instead of fixed/breakpoint sizes -
the middle value is a viewport-height percentage, so on a shorter
viewport (landscape, where there's less vertical room) they shrink
smoothly instead of overflowing; the min/max bounds keep them from ever
getting illegibly small or absurdly large. This is a blunt instrument -
it scales with viewport height only, not with how much content a
specific step actually has - but it's what keeps a route with a longer
street name or a special instruction from silently overflowing the
fixed space in landscape, which is the failure mode that matters most
here given no scrolling is allowed.

**Map shrinks before content does (portrait)**: on a short-viewport
phone in portrait (e.g. an iPhone, as opposed to the iPad this is
primarily built for), the map/rider region and the content column below
it used to compete for vertical space with the map fixed (`shrink-0`)
and the content column allowed to shrink past its own content size
(`min-h-0`) - so a two-line street name could get compressed until the
footer's buttons overlapped/clipped it. That priority is now inverted in
portrait: the map/rider region can shrink (down to a `min-h-[4.5rem]`
floor) while the header/progress-bar/content/footer column is left at
its default `min-height: auto`, so flexbox shrinks the map first and
only touches the content column once the map has hit its floor.
Landscape is unchanged (`landscape:shrink-0` on the map region,
`landscape:min-h-0`/`landscape:overflow-hidden` restored on the content
column) since the tablet-landscape case this was already tuned for has
plenty of vertical room and isn't the failure mode here.

Separately, the street-name text (`useFitLines.ts`) now guarantees room
for at least two lines at its full baseline `clamp()` size - a `min-h`
on the `<p>` reserves that space in `em` units (so it scales with
whatever the current font size is), and a small hook measures the
rendered text after each render/resize and only shrinks the font size
below baseline, in small steps down to a floor, if a specific
combination of street names is long enough that it wouldn't otherwise
fit in two lines. An ordinary route never triggers the shrink; it's a
last resort, not the default sizing mechanism. Verified against the
exact bug report (an iPhone-width viewport on the "Bill Stewart Rd &
Hidden Forest" stop) and an intentionally pathological street-name combo
to confirm the fallback engages without ever overlapping or clipping.

### Rider check-in

At each stop, the rider slot at the top of the screen (`RiderCheckInBox`
in `StepScreen.tsx` - see Visual design above) renders one button per
expected rider (`step.studentCount`, from the CSV's `rider_count`),
numbered underneath - every circle uses the same solid person icon
(color/fill is what changes on check-in, not the icon style), ringed
with a `border-blue-600` outline so the circles read clearly against the
cream background instead of blending into it, gray/outlined when not yet
checked in, green when checked in. No caption explains this above the
buttons; the pattern
(tap a number, it and everything before it goes green) is meant to read
as self-evident, like a star rating. Tapping rider N checks in everyone
from 1 through N and un-checks anyone after N, rather than toggling one
at a time (`fillTo` in `useRiderRoster.ts`) - there's no separate "check
all" control, since tapping the last rider does that. **Additional
Rider** (styled and sized the same as the numbered buttons - a plain "+"
instead of a person icon, labeled instead of numbered) appends one more
rider, already checked in (it's recording someone who's visibly boarding
right now, not someone expected) - it doesn't participate in the
star-rating fill, so it can leave a "gap" (e.g. riders 1-2 checked, 3-5
not, plus one additional rider checked) if the driver hasn't finished
checking in the expected riders yet. That's intentional: the added rider
is a real, separate event, not a retroactive claim that 3-5 also
boarded.

Below the roster, a **Resume Route** button (`aria-label="Continue
route"`, same glossy blue styling as the footer's advance button, just
smaller) calls the same `onAdvance` handler as the footer's "Next"
button - added so a driver checking riders in doesn't have to look away
from the roster down to the footer to keep driving once they're done.

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
- The progress bar auto-scrolls but isn't draggable - a driver can't
  manually pan it to peek further up the route; it only ever tracks the
  current step. Pinch-zoom on a very long route would also help, since
  right now the fixed 48px-per-step spacing just makes the track (and
  the auto-scrolling) longer rather than ever shrinking markers down
- Move route data into the doc's actual data model
  (District/School/Route/RouteStop/etc.) instead of a flat CSV, once
  there's more than one route
- Real map integration in place of the placeholder image, tied to
  wherever the bus actually is - and once that's real, decide how it
  should coexist with the rider check-in box that currently overlays the
  same spot on a stop (side by side? a toggle? the box just wins, like
  now?)
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
- The no-scroll/clamp() approach was tested on two specific iPad-sized
  viewports (see Visual design), not the full range of real tablets -
  a smaller/older tablet in landscape, or a rider count much higher than
  this route's max of 10, could still overflow the fixed regions and get
  silently clipped rather than scrolling, since scrolling is deliberately
  disabled everywhere
- Named-rider attendance, as an opt-in for smaller schools/districts
  that want that level of tracking instead of just a headcount by
  number - would need real student rosters per stop (privacy/FERPA
  implications the project doc already flags), not just a rider count.
  Longer term, RFID transport badges could let students check
  themselves in as they board, rather than the driver tapping for each
  one.
