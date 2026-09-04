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
    page.tsx           Renders the route list, the Start screen, or the
                            step screen
    layout.tsx          Root layout, metadata
    globals.css         Tailwind
  components/
    RouteListScreen.tsx Home screen: searchable, scrollable #/Name/Start list
    StartScreen.tsx     Route summary + trip stats + "Start Route" button
    StepScreen.tsx       The step-through screen, incl. rider check-in
    StepTransition.tsx    Odometer-style roll between steps (see below)
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
    useFitLines.ts        Shrink text to fit N lines (see below)
    useFitGrid.ts          Shrink a bubble grid to fit (see below)
    time.ts               addMinutesToTimeString/parseTimeToMinutes - trip ETA math
    demoRoutes.ts          Fabricates filler rows for the route list (see below)
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

`Route.schoolName`/`schoolAddress` (set in `ROUTE_META`, `page.tsx`) are
what the start screen's "School" row and the "Starting route..."
announcement (see Audio below) both read from. They used to be
hardcoded directly in `StartScreen.tsx`'s JSX instead of coming from the
route data at all - harmless while only one screen used them, but it
meant the spoken announcement had no way to say the same name, so
they're proper `Route` fields now. Also corrected the school's name
along the way: "Laverne Lake Elementary" was a typo for "Lavergne Lake
Elementary" - this route is set in La Vergne, TN (Sam Ridley Pkwy is a
real road there), so "Lavergne" is very likely what was actually meant.

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

The route itself also gets an announcement naming the route and school
right before the first step's own announcement, the moment the driver
taps "Start Route" - e.g. "Starting route 125 from Lavergne Lake
Elementary." - and a "Route completed." announcement right after the
final step's own announcement. "From" vs "to" follows `tripType`: a
dropoff route starts *from* the school (that's where the bus departs),
a pickup route heads *to* it. Both are queued in the same
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

  The map's height (`h-[30vh]`, "about a third of the screen") is fixed
  - `shrink-0` in portrait now, not `shrink` - rather than condensing to
  make room for anything. This went back and forth a couple of times: an
  earlier version let the map shrink generically whenever the column
  ran short on space, then gated that behind "does the current step's
  text need a third line" to stop it shrinking more than it needed to,
  then dropped that gating again after it turned out to cause a worse
  problem (an *ordinary* step could still add up to more than a short
  phone's viewport once header/progress bar/footer were included, and
  with the map rigid there was nothing left to absorb the deficit - it
  pushed the footer off the bottom of the screen entirely). The map
  itself is fixed now on principle, not as a side effect of that
  back-and-forth: the rider check-in card and the step content are what
  compress instead (their own bubble-shrink and two-line-then-shrink
  mechanisms, described where each is built below) - so the footer-off-
  screen risk that came from a rigid map had to be solved a different
  way, by tightening chrome padding and moderating the icon/street-name
  `clamp()` ranges (both described below) enough that even a short
  phone's ordinary content comfortably fits under a full-height map.
  Verified at 375×667 (iPhone SE class, the shortest viewport this app
  is expected to run on) with both an ordinary step and an
  intentionally pathological long street name - footer fully on-screen
  either way - and confirmed the ample-iPad case is unaffected.
- **Map/content divider**: a thin glossy blue bar (`.btn-glossy`, the
  same bevel/shadow/highlight treatment as the buttons) between the
  map/rider region and everything else - a horizontal bar under the map
  in portrait, a vertical bar to the map's right in landscape.
- **Start screen** (`StartScreen.tsx`): `justify-center`'d vertically by
  default, which reads fine on a shorter viewport but left a visibly
  dead gap above the logo *and* below the "Start Route" button on a
  taller phone, since centering just splits whatever's left over evenly
  on both sides. Portrait now top-aligns instead (`justify-start`, with
  a `pt-10` in place of the centering to still give the logo some
  breathing room from the very top edge), so the excess collects below
  the button instead of splitting above/below it; landscape keeps the
  original centering (`landscape:justify-center`), since that's the
  primary orientation this app targets and centering there hasn't shown
  the same problem.
- **Header**: logo top-left, route number large and bold top-center
  (with a small "Route #" label above it), bus number top-right. Pinned
  at the top of the "everything else" region (below the map/rider region
  in portrait, to its right in landscape), doesn't scroll away. The "Stop
  X of Y" caption and the "N onboard" rider-count badge below it were
  both bumped up a size and to full black/bold weight - they started at
  `text-xs font-semibold`, easy to lose track of at a glance while
  driving. The onboard badge lost its pill background too (plain text
  now, matching the stop caption beside it) - the box read as a chunkier
  UI element than this small a piece of status text warranted.
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
  trusting the CSS by eye).

  Horizontally, the bus now sits exactly at the true start (`left: 0`)
  on the first step and exactly at the true end (`left: trackWidth`) on
  the last, landing right on the cul-de-sac circle at either end instead
  of stopping a little short of it - every step in between is already 48px
  clear of both edges (`PX_PER_STEP`), so no separate inset/clamp is
  needed there. Getting the icon to actually *reach* those exact edges
  surfaced a real CSS bug along the way: the bus (and, at the very last
  stop, the last pin marker too) would collapse to zero width right at
  the route's true end - not a rendering glitch, but the standard CSS
  behavior for an absolutely positioned box with `left` set and no
  explicit width: its shrink-to-fit size is bounded by "containing block
  width minus `left`", which hits exactly zero once `left` reaches the
  track's own width. `w-max` (`width: max-content`) on both the bus and
  marker wrappers fixes it by sizing to the image's own content instead
  of that (nonexistent) available space - confirmed by measuring the
  bus's rendered width at every single step of a full route, which held
  constant instead of tapering off to 0 right at the end. The container's
  generous `px-8` padding leaves enough room that neither the bus nor the
  cul-de-sac circles capping each end of the track (see above) are ever
  clipped horizontally, even at the exact edges. Vertically, both the bus
  and the circles are centered on the road, which is itself anchored to
  the *bottom* of a taller box (originally `h-24`, 96px) rather than
  centered within it - so both extend a few px below that box's own
  bottom edge everywhere along the route, not just at the ends. The
  outer container only had top padding (`pt-1`) to begin with, so with
  nothing absorbing that overflow at the bottom, its own
  `overflow-hidden` was quietly clipping a few px off the bottom of the
  bus and every circle - a bug that measuring against the container's
  left/right edges never would have caught, since it was purely
  vertical. `pb-4` fixes it. Verified by measuring rendered edges
  against the container's on all four sides, not just the two that were
  checked before, at the first, a middle, and the last step.

  That `h-24` box was also just taller than the road/markers/bus
  clustered near its bottom actually need - since everything is
  bottom-anchored, the top ~56px of it (out of 96px total) was pure dead
  space, showing up as a visible gap above the progress bar with nothing
  reclaiming it for the rest of the screen. Reduced to `h-12` (48px, an
  8px buffer above the tallest marker) - measured against the container
  on all four sides again to confirm nothing clips at that height,
  across the first/middle/last step and both orientations.
- **Progress caption**: "Stop X of Y" rather than a raw instruction
  count - the number of turn steps between stops isn't meaningful to a
  driver, so it always shows the stop just reached or the one being
  driven toward (`stopNumberByIndex` in `useRouteStepper.ts`).
- **Turn steps**: the actual turn-arrow road sign (`turn-arrow.png`,
  user-supplied, already had a transparent background) instead of "TURN
  LEFT" text - large on the step screen (`clamp(3.25rem,12vh,8rem)`,
  trimmed down more than once from where it started), small on the
  progress bar's markers - mirrored horizontally for a left turn, since
  the source art is a right turn. Street name renders below it in larger
  type than anything else on screen (`clamp(1.25rem,4.5vh,2.75rem)`,
  likewise trimmed a couple of times from its original, larger clamp
  range) - the `vh` middle value in both is what got trimmed most
  recently, so the map could stay a fixed, un-condensing size (see Map/
  rider region above) without an ordinary short-phone step overflowing
  the screen; the floor/ceiling stayed close to where they were, so
  neither looks meaningfully smaller on a tablet.
- **Stop steps**: the pin icon (same trimmed-down `clamp(3.25rem,12vh,8rem)`
  as the turn arrow), with the stop number set inside its white circle
  (absolutely positioned over the image - tuned by eye against a
  screenshot, not derived from the art's actual geometry, so it'll need
  re-tuning if `pin.png` ever changes) instead of a separate "STOP n of
  m" line, which the header's "Stop X of Y" caption already covers. Same
  street-name treatment as turn steps. Which side of the road the stop
  is on (`step.sideOfRoad`, from the CSV's `side` column) is shown as a
  filled triangle (`RoundedTriangleIcon`, a softer-cornered cousin of the
  `TriangleIcon` on the Back/Next buttons - same fill/stroke color, but
  `strokeLinejoin="round"` on a stroke matching the fill rounds off the
  corners instead of a crisp point, matching a reference play-style icon)
  right next to the pin - on the pin's left for a left-side stop, its
  right for a right-side stop - colored to match the pin art's own red
  (`#d54e48`, sampled from the pixels in `pin.png` itself rather than
  guessed, since Tailwind's `red-700` turned out noticeably more
  brick-red than the art). It's a bare triangle, not a button - an
  earlier version wrapped it in a glossy circular badge, which read as
  another tappable control next to a pin that isn't one; it's also
  narrow - half its height in width (trimmed down again from an initial
  two-thirds) - so the point reads as a soft, low-key "which-way"
  directional hint rather than competing with the pin for attention.
  It's positioned at `top-[31%]` with `-translate-y-1/2`,
  the exact same anchor the stop-number span uses, so its center lines
  up with the center of the pin's white circle/number regardless of how
  big the pin itself is rendering at a given viewport height. This
  replaced an on-screen "Stop on the right/left side" text line - now
  conveyed visually instead - which freed up that line for notes (see
  below).
- **Controls**: filled-triangle Back/advance buttons with a round, blue
  Pause button between them. The advance button reads "Next" on an
  ordinary step, but "Start" on the very first step and "End" on the
  very last - it used to just say "Next" throughout, with the button
  disabled entirely once the driver reached the last step, which left no
  way to explicitly wrap up the trip. Tapping "End" announces "Route
  ended.", then resets and returns to the start screen (`endRoute` in
  `useRouteStepper.ts` - it stops the silent keep-alive audio, clears the
  step index/pause state/"has announced start" flag, and hands control
  back to `RouteApp`, which renders `StartScreen` again once `started`
  goes false) - confirmed a subsequent "Start Route" tap begins clean
  from step one, the "Starting route..." announcement and all, rather
  than picking up where the previous trip left off. Pausing shows a "Route Paused" message in
  place of the step content, disables both buttons and
  screen-tap-to-advance, stops the spoken announcement, and - since the
  Bluetooth remote is the primary input - ignores
  `nexttrack`/`previoustrack`/`play` events from it too, so a stray
  remote press doesn't sneak the route forward while paused. Tapping
  Pause again (now showing a play triangle) resumes.
- **Step transitions**: switching steps no longer instantly swaps the
  icon and street name/signage - it rolls over like an odometer, via a
  small `StepTransition.tsx` wrapper. The outgoing content slides
  straight up and out while the incoming content slides straight up and
  in from below, both clipped to the wrapper instead of spilling past
  its edges, and both on one shared timing (`0.32s`, one symmetric ease)
  so they read as a single continuous belt rather than two independently
  animated pieces. Pure vertical motion, no fade and no overshoot bounce
  - an odometer digit doesn't fade or bounce, it just rolls to a stop.
  (An earlier version faded and bounced instead - closer to a typical UI
  transition, but that's not what was asked for here.) Both layers are
  also centered the same way (`items-center justify-center`, matching
  the wrapper's own centering) so they swap in the same visual "lane"
  instead of drifting to different vertical positions mid-transition,
  which is what it looked like before that was added.

  The new content stays in normal document flow the whole time - it's
  still what determines the rendered height of this area, which is what
  the two-line street-name guarantee (see below) needs to actually get
  its floor honored; only the *outgoing* content is pulled out of flow
  (absolutely positioned on top) for the 320ms it takes to animate away.
  Clipping this element on its own would normally break that guarantee -
  per the flex spec, a flex item's *automatic* minimum size is zero once
  its own overflow isn't visible, which would let this area collapse
  below its two-line floor instead of honoring it. Worked around by
  measuring the incoming content's own height (`ResizeObserver`, the
  same technique `RouteProgressBar.tsx` already uses) and reapplying it
  as an *explicit* min-height via a CSS custom property - unlike `auto`,
  an explicit length isn't zeroed by that rule. It's set through a
  custom property rather than inline `min-height` directly so
  `landscape:min-h-0` from the caller can still win in landscape (an
  inline style always beats a class, `landscape:` variant or not - going
  through a custom property that a class then reads keeps the override
  winnable).

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
`text-[clamp(1.25rem,4.5vh,2.75rem)]` instead of fixed/breakpoint sizes -
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
cream background instead of blending into it, gray when not yet checked
in, filled solid blue (matching that same outline, not a separate green -
one consistent color for "checked in" rather than two blues-and-greens
competing) when checked in. No caption explains this above the buttons;
the pattern (tap a number, it and everything before it fills in) is
meant to read as self-evident, like a star rating. Tapping rider N checks in everyone
from 1 through N and un-checks anyone after N, rather than toggling one
at a time (`fillTo` in `useRiderRoster.ts`) - there's no separate "check
all" control, since tapping the last rider does that; it's a count at
this stage (how many riders have boarded so far), not individually
identified riders. **Additional Rider** (styled and sized the same as
the numbered buttons - a plain "+" instead of a person icon, unlabeled -
it used to carry an "Additional Rider" caption underneath, which read as
redundant once the icon itself was already distinct from the numbered
circles) appends one more rider, already checked in (it's recording
someone who's visibly boarding right now, not someone expected) - it
doesn't participate in the star-rating fill, so it can leave a "gap"
(e.g. riders 1-2 checked, 3-5 not, plus one additional rider checked) if
the driver hasn't finished checking in the expected riders yet. That's
intentional: the added rider is a real, separate event, not a
retroactive claim that 3-5 also boarded.

Below the roster, an **OK** button (`aria-label="Continue route"`, same
glossy blue styling as the footer's advance button, just smaller) calls
the same `onAdvance` handler as the footer's "Next" button - added so a
driver checking riders in doesn't have to look away from the roster down
to the footer to keep driving once they're done. It used to read "Resume
Route," which is accurate but a lot of words for a button whose whole
job is "I'm done, let's go" - the aria-label stays more descriptive for
screen readers even though the visible label is now just "OK."

**Bubbles shrink to fit, the map doesn't**: since the map is a fixed
size now (see Map/rider region above), a stop with a lot of expected
riders (this route has one with 10, plus the Additional Rider button -
11 bubbles) can need more rows than the check-in card has height for at
the bubbles' baseline (`h-11`) size. `useFitGrid.ts` - the same
measure-and-shrink idea as `useFitLines.ts`, but for a 2D grid instead of
wrapped text - shrinks a `--fit-scale` CSS custom property from 1 down
to a floor (0.6, chosen so a bubble never gets too small to tap
reliably) until the roster's `scrollHeight` fits within its actual
rendered height. Every size that matters (bubble diameter, the person
icon inside it, the number label, the gaps between bubbles) reads
`--fit-scale` through a `calc()` expression rather than a fixed size, so
they all shrink together proportionally. Verified against the
11-bubble stop specifically - no clipping, `--fit-scale` lands right at
its floor for that one.

**Held off until the announcement finishes**: the check-in card used to
appear the instant a stop became current, popping up over top of the
driver still hearing the stop's own spoken announcement. `useRouteStepper.ts`
now exposes `announcementDone`, tracking whether the *last* queued
utterance for the current announcement attempt has actually finished (or
errored, or hit an 8-second fallback timeout, in case a browser/voice
never reliably fires `end`) - `StepScreen` only shows the card once that's
true. It's derived by comparing an `attemptKey` (the current step id plus
a count that only bumps on *resuming* from pause, so a re-announcement
after pausing mid-stop is tracked as a fresh attempt) against whichever
key last completed, rather than an effect explicitly resetting a boolean
to false and back to true - the key naturally goes stale the moment a new
attempt starts, so nothing needs to be reset by hand, and every actual
`setState` call happens inside a callback responding to an external event
(the utterance ending, or the timeout), never synchronously in the effect
body. When the card does appear, it's a quick scale-and-fade pop-in
(`animate-roster-pop` in `globals.css`) rather than an instant snap into
place, since it's now arriving deliberately rather than immediately.

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

### Route flow and screens

**Depot and arrived are their own virtual phases, not step 0 and the
last step.** `useRouteStepper.ts` used to treat `currentIndex === 0` as
"the start" (button labeled Start) and `currentIndex === totalSteps - 1`
as "the end" (button labeled End), which meant tapping Start jumped
straight into step 0's real turn-by-turn content, and pressing Next on
the last stop immediately ended the route with no chance to double-check
anything. Neither matched how the depot/end cul-de-sac positions on the
progress bar were already being drawn - the bus visually parking at
either end before or after the actual directions play. The hook now has
a `phase: "depot" | "step" | "arrived"` on top of `currentIndex`:

- **depot** - before step 0. The bus sits on the start cul-de-sac
  (`currentIndex` stays `0`, and `pixelFor(0)` is already the track's
  true left edge, so `RouteProgressBar` needed no changes at all).
  `StepScreen` shows generic `DepotContent` ("Ready to Depart") instead
  of step 0's real turn; the footer reads **Start**. Tapping it moves to
  `phase: "step"` at `currentIndex: 0` - step 0's own content then
  behaves like an ordinary step, labeled **Next**.
- **step** - `currentIndex` 0 through `totalSteps - 1`, always labeled
  **Next**, even on the very last stop. Advancing past the last step
  moves to `phase: "arrived"` without touching `currentIndex` (it's
  already `totalSteps - 1`, which is also already `pixelFor(totalSteps -
  1)` - the track's true right edge), so the bus visually stays parked on
  the end cul-de-sac.
- **arrived** - generic `ArrivedContent` ("All Stops Complete"), footer
  reads **End**. Tapping **Next**/the remote's fast-forward here is
  deliberately a no-op (`advance()` just returns) - only the dedicated
  End button can leave this phase, so the same gesture used to step
  through the whole route can't also accidentally end it.

`goBack` mirrors this: from `arrived` it returns to the last real step
(still labeled Next); from step 0 it returns to `depot`; from `depot` it
does nothing (the Back button is disabled there, via
`phase === "depot"` rather than the old `isFirstStep`).

`isFirstStep`/`isLastStep` are gone from the hook's return value
entirely, replaced by `phase` - `StepScreen` derives everything (button
label/handler, Back's disabled state, which content component to render,
whether a stop can show its rider check-in card) off that one value
instead of two booleans whose meaning was about to change out from under
them. `isStop` is now explicitly `phase === "step" && step.kind ===
"stop"`, guarding against `route.steps[0]` or the last step happening to
*be* a stop and having its roster card pop up during depot/arrived, where
no roster should show at all.

**"Route completed" only speaks when End is actually tapped.** The old
code appended `"Route completed."` onto the last step's own spoken
announcement automatically, purely because `isLastStep` was true - so it
fired the moment the driver reached the final stop, well before they'd
actually finished checking riders in or pressing anything. That line is
gone; the `arrived` phase speaks nothing on its own (its announcement
`parts` array is empty, which short-circuits straight to marking the
attempt done via the same zero-delay `setTimeout` path used when
`speechSynthesis` isn't available at all - `announcementDone` still
resolves correctly even though no utterance was queued). The existing
`endRoute()` announcement, `"Route ended."`, already only fired when the
End button was tapped, so it's unchanged and is now the sole
route-completion utterance. The route-number/school preamble ("Starting
route 125 from Lavergne Lake Elementary.") that used to be prepended to
step 0's first announcement is now the entire spoken content of the
`depot` phase instead - it gets its own turn to speak rather than being
stacked onto step 0, which also meant `announcedStartRef` (a ref tracking
whether that preamble had already played once) could be deleted; depot's
`attemptKey` is keyed off `resumeCount` alone (`depot-${resumeCount}`)
and it only shows up once per route, once, without needing to track "have
I said this yet."

**StartScreen is now the second screen, not the first**, per a
pink-annotated screenshot marking up the old layout: no more "TODAY"
label, no dead space above the logo, no "Complete 3:58 PM" completion
time (dropped from the app entirely, not just hidden), tighter line
height on the school-name subtitle where it wraps to two lines. Distance,
duration, stop count, and rider count are now four stacked stat tiles
(big number, small unit/label underneath) occupying the space the
completion time used to sit in, rather than a single "8.4 mi · 28 min ·
Complete 3:58 PM" line plus separate Stops/~Riders rows further down. The
tile's unit label is parsed out of `route.distance` itself
(`splitValueUnit`, a `/^([\d.,]+)\s*(.*)$/` match) rather than a
hardcoded "mi", so it stays correct if that field's format ever changes.
The remaining detail rows are reordered to Departure/Bus/Driver, and
School is dropped from that list entirely - the school is already named
in the subtitle above, and `schoolAddress` isn't rendered on this screen
now (though it stays on the `Route` type/CSV meta, unused here rather
than deleted, in case a later screen wants it). The big "Route 125"
heading and a round back-arrow button share a row above a
rounded-border box that now contains everything else (subtitle, stat
tiles, detail rows); the Start Route button sits below/outside that box
as the screen's one clear call to action.

`LiveClock`/`useCurrentTime` are still in `StartScreen.tsx`, just no
longer called from the component - "we don't need the clock after all
for now, keep that code ready to implement again later" meant deleting
the call site, not the code, so both are now `export`ed (rather than
module-private) specifically so they don't trip an unused-declaration
lint error while sitting dormant.

**A new route-list screen is the actual first screen now.**
`RouteListScreen.tsx` is a scrollable table; tapping a row calls
`onSelect(route)` and moves to that route's StartScreen, whose back
arrow returns to the list. `page.tsx` tracks this with one
`selectedRoute: Route | null` (the tapped row itself, not just a
boolean - see below) rather than a bigger screen-enum, since there are
still only two screens ahead of the step flow. There's only one real
route (`route-125.csv` + the hardcoded `ROUTE_META`); see below for how
the list gets enough rows to actually be scrollable now.

### Route list: layout, search, and fabricated rows

Reworked per feedback on the first pass at this screen:

- **Two-line names instead of a single truncated line** - `line-clamp-2
  leading-snug` on the name cell (no `truncate`), so a long route name
  wraps instead of being cut off with an ellipsis after a few words.
- **Column headers/labels shortened**: "Number" → "#", "Start Time" →
  "Start", right-aligned (`text-right` on both the header cell and the
  value) so it reads as a right-edge-anchored time column rather than
  competing with the name column for space; the name column keeps `1fr`
  so it absorbs whatever width is left over from the now-narrower `#`
  and `Start` columns (`grid-cols-[2.25rem_1fr_4.25rem]`, down from
  `[3.5rem_1fr_5.5rem]`).
- **Divider lines** between rows were already there (`divide-y
  divide-zinc-200` on the row container) - they just weren't obviously
  visible with only one real row and no scrolling to show them off. See
  below for why they're visible now.
- **A search box** above the table filters by name or route number
  (case-insensitive substring match on both, `useMemo`'d off `[routes,
  query]`), with a "No routes match "…"." empty state rather than a
  silently blank list.

**The single-row list is now a fabricated 25-row one, on explicit
request** ("generate enough fake random ones so we can see the scroll
capabilities") - a deliberate reversal of the previous round's decision
to keep it a single real row rather than invent data. `demoRoutes.ts`
fabricates 24 filler routes on top of the one real one: route numbers,
school-style names (built from word lists, e.g. "Cedar Creek Middle
School — Morning Pickup"), driver names, departure times, and
distance/duration are all randomized, but every fabricated route reuses
the *real* route's actual turn-by-turn `steps` array - so tapping a fake
row still leads to a working trip-summary screen and step-through flow
instead of a dead end, in the same "clearly not real, but not broken
either" spirit as the "Demo only placeholder, not actual map" label
already on the map image. The randomization uses a tiny seeded PRNG
(`mulberry32`, seed `42`) rather than `Math.random()`, computed once via
`useMemo(() => …, [route])` in `page.tsx` - otherwise the list would
reshuffle itself every time the user backs out to it, which would both
look broken and make search results inconsistent between visits. The
combined list is sorted by departure time (`parseTimeToMinutes`, a new
export alongside the existing `addMinutesToTimeString` in `time.ts`) so
it reads like an actual schedule rather than real-route-first-then-
random-order.

Wiring a specific tapped route through actually mattered here for the
first time: before this round, `RouteListScreen`'s `onSelect` callback
received the tapped `Route` but `page.tsx` discarded it
(`onSelect={() => setRouteSelected(true)}`), harmless while there was
only one possible row to tap. `page.tsx` now keeps
`selectedRoute: Route | null` and passes it straight through
(`onSelect={setSelectedRoute}`), so tapping "Route 943" in the list
actually opens Route 943's own trip-summary screen instead of always
reopening the real route regardless of which row was tapped.

### Progress bar: first/last markers no longer sit on the cul-de-sac circles

The turn/stop marker for `route.steps[0]` was drawn at `pixelFor(0)` -
exactly the same pixel position as the start cul-de-sac circle and the
bus's own parked position during the `depot` phase, so the very first
turn icon visually sat right on top of the circle instead of reading as
a distinct upcoming step. Same problem at the other end: the last
marker sat exactly on the end circle. A new `markerPixelFor(index,
total, trackWidth)` in `RouteProgressBar.tsx` pulls just those two
markers in from the true track ends by `MARKER_EDGE_INSET_PX` (22px,
capped at `PX_PER_STEP / 2` so it can never cross into the next marker's
own position on a very short route) while every other marker keeps
using the plain `pixelFor(index)` spacing. Deliberately *not* touching
`busPx` (still `pixelFor(currentIndex)`, uninset) - the bus still needs
to reach the literal `0`/`trackWidth` ends to visibly park on each
circle for the `depot`/`arrived` phases from the previous round; only
the *icons* needed to visually back off, not the bus or the track/circle
geometry itself.

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
