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
.env.local.example        Copy to .env.local (gitignored) - needs ORS_API_KEY
.github/
  workflows/
    geocode-route.yml     Auto-refreshes every route's own *-waypoints.json (see below)
    prototype-overpass.yml Manual-only re-test harness for src/lib/overpassGeocode.ts
src/
  app/
    page.tsx           Renders the route list, the Start screen, or the
                            step screen
    layout.tsx          Root layout, metadata
    globals.css         Tailwind
    api/geocode/route.ts  Server-side geocode endpoint behind EditRouteScreen's
                            Fetch Location/Fetch All Locations (see below)
  components/
    RouteListScreen.tsx Home screen: searchable, sortable, scrollable route
                            list, plus the admin-only "Edit Mode" toggle (see below)
    StartScreen.tsx     Route summary + trip stats + "Start Route" button,
                            plus the admin-only "Edit Route" link (see below)
    EditRouteScreen.tsx    Admin-only Add/Edit Route screen (see below)
    ConfirmModal.tsx       Shared yes/no overlay - activate/deactivate/delete (see below)
    StepScreen.tsx       The step-through screen, incl. rider check-in
    RouteMap.tsx           Real OSM tile map, no route drawn yet (see below)
    StepTransition.tsx    Odometer-style roll between steps (see below)
    TopBar.tsx            Logo / route number / bus number header
    RouteProgressBar.tsx  The road-styled progress bar (see below)
    Logo.tsx               Wraps the logo asset at two sizes
    icons.tsx              Icons: turn-arrow image, pause/triangle/chevron/
                            person (outline + solid) SVGs
  lib/
    types.ts             Route / NavigationStep types
    parseRouteCsv.ts     Steps CSV → Route parsing (see below)
    parseRouteMasterList.ts Master list → route-level metadata, one row per route (see below)
    parseSchoolsCsv.ts     Schools sheet → address-by-school-name lookup (see below)
    useRouteStepper.ts   State + all input wiring, incl. pause (see below)
    useRiderRoster.ts    Per-stop rider check-in state (see below)
    useFitLines.ts        Shrink text to fit N lines (see below)
    useFitGrid.ts          Shrink a bubble grid to fit (see below)
    time.ts               addMinutesToTimeString/parseTimeToMinutes - trip ETA math
    demoRoutes.ts          Fabricates filler rows for the route list (see below)
    deriveWaypoints.ts     CSV row -> geocodable address/intersection/unresolvable (see below)
    geocode.ts              Swappable free-text geocoding providers (ORS active, see below)
    overpassGeocode.ts       Structured intersection lookup via the Overpass API (see below)
    waypointCache.ts         Cache key + entry types shared with scripts/geocodeRoute.ts
    parseRouteImport.ts      Graceful column/header matching for a pasted or
                                uploaded route (see below) - used by EditRouteScreen.tsx
    routeResolutionStatus.ts Per-row auto-resolve status (resolved/unresolved/
                                skipped) against a WaypointCache (see below)
    resolveWaypoint.ts       Shared "resolve one query for real" logic - used by
                                scripts/geocodeRoute.ts and api/geocode/route.ts
    routeReadiness.ts        Is a route's own cache fully resolved? (list-level
                                Activate check, see below)
    placeholderMeta.ts     Shared driverName/distance placeholders + favorites
    silence.ts           A tiny silent audio loop (see below)
scripts/
  geocodeRoute.ts        `npm run geocode` - refreshes every active route's own
                            *-waypoints.json sidecar cache (see below)
  prototypeOverpassGeocode.ts `npm run prototype:overpass` - re-test harness, see below
  tsconfig.json            Standalone tsc config so the scripts need no bundler
public/
  manifest.json          PWA manifest
  data/125-PM-EL.csv           Bus 125's turn-by-turn steps
  data/120-AM-EL.csv           Bus 120's AM Elementary run steps
  data/120-AM-MS.csv           Bus 120's AM Middle run steps
  data/120-AM-HS.csv           Bus 120's AM High run steps
  data/120-PM-EL.csv           Bus 120's PM Elementary run steps
  data/120-PM-MS.csv           Bus 120's PM Middle run steps (incomplete, status: inactive)
  data/120-PM-HS.csv           Bus 120's PM High run steps (incomplete, status: inactive)
  data/route-master-list.csv   Route-level metadata for every real route (see below)
  data/schools.csv             School name → address, one row per school (see below)
  data/125-PM-EL-waypoints.json  Bus 125's geocoding cache, generated - see "Maps, part two"/
                                  "part ten" below (one such sidecar per active route, named
                                  to match its own steps CSV - not listed individually here)
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

Every active route's own geocoded waypoint cache (`{route}-waypoints.json`,
one sidecar per steps CSV - see "Maps, part two"/"part ten" below)
refreshes itself automatically - a GitHub Actions workflow
(`.github/workflows/geocode-route.yml`) runs `npm run geocode` and
commits whatever changed whenever any `public/data/*.csv` file changes,
so there's normally nothing to do by hand. To run it yourself anyway (a
manual local check, or to retry a failed lookup without touching a
CSV): `npm run geocode`. Needs a real `ORS_API_KEY` (addresses, and the
one-time per-route anchor point Overpass's intersection lookups use)
and real outbound network access to `api.openrouteservice.org` and
`overpass-api.de` - not available in every environment (this one
included), so run it somewhere that has both.

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

`public/data/125-PM-EL.csv` (Bus 125's PM Elementary run - file names
follow the district's own route/AM-PM/school-type convention, e.g.
`120-AM-MS.csv`, not this app's tripType/schoolLevel spelling) follows
the doc's proposed CSV schema (originally plus one addition, a leading
`sequence` column, since dropped - see "Route data: two CSVs now, and a
dropped column" further below): `time,action,from_at,onto_at,rider_count,side,notes`.
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

`Route.schoolName`/`schoolAddress` (`schoolName` now sourced from
`route-master-list.csv`, `schoolAddress` looked up by school name from
`schools.csv` - see "Route data: two CSVs now", "Route data: the master
list", and "Route data: real school addresses" further below) are
what the trip-summary screen's subtitle (`schoolName` is folded into
`route.name` there, not its own row - see "Route flow and screens"
further below) and the "Starting route..." announcement (see Audio
below) both read from. They used to be
hardcoded directly in `StartScreen.tsx`'s JSX instead of coming from the
route data at all - harmless while only one screen used them, but it
meant the spoken announcement had no way to say the same name, so
they're proper `Route` fields now. Also corrected the school's name
along the way: "Laverne Lake Elementary" was a typo for "Lavergne Lake
Elementary" - this route is set in La Vergne, TN (Sam Ridley Pkwy is a
real road there), so "Lavergne" is very likely what was actually meant.

`notes` is spoken and shown on screen the same way as a turn's - two
stops carry a placeholder note as an example of what this field is for:
Bill Stewart Blvd & Ruth Ln has "Wheelchair user requires assistance",
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
"Pkwy" → "Parkway", etc. - covers what's in `125-PM-EL.csv` plus the
common USPS suffixes) so the TTS engine doesn't read "Rd" as a word or
garble it; on-screen text keeps the abbreviated form.

The route itself also gets an announcement naming the route and school -
e.g. "Starting route one twenty five from Lavergne Lake Elementary." -
which is the entire spoken content of the `depot` phase (see "Route flow
and screens" further below): it plays once, the moment the driver taps
"Start" from the depot screen, before the first real step's own
announcement gets its turn. "From" vs "to" follows `tripType`: a dropoff
route starts *from* the school (that's where the bus departs), a pickup
route heads *to* it.

The route number itself is spoken the way a driver would actually say
it, not as a raw number - `speakRouteNumber` in `speech.ts` reads the
first digit alone, then the remaining two digits as one two-digit
number, space-joined rather than punctuated so a TTS engine reads it as
one continuous phrase instead of pausing between the two parts: "124" →
"one twenty four", "403" → "four oh three", "254" → "two fifty four",
"101" → "one oh one" (confirmed against all of those, plus "110" → "one
ten"). One deliberate exception to that "oh" treatment: a round hundred
(last two digits both zero) reads as "one hundred", not "one oh zero" -
nobody says it that way. Only three-digit route numbers get this
treatment - anything else falls back to its raw digits, though every
route in this app (real or `demoRoutes.ts`-fabricated) is three digits.

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
  Every step gets its own marker, and the underlying track itself is
  still sized off a fixed 48px-per-step increment (`PX_PER_STEP`/
  `pixelFor`) - no thinning/hiding - so a longer route just makes the
  track wider than the visible window instead of crowding markers
  together. The markers' own on-screen positions are a separate matter
  from that track sizing (evenly re-spaced and inset from the true ends
  - see "Progress bar: evenly distributed markers" further below); only
  the road/bus/cul-de-sac geometry still uses the raw `pixelFor`
  increments directly. That window
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

  Horizontally, the bus sits exactly at the true start (`left: 0`)
  during the `depot` phase and exactly at the true end (`left:
  trackWidth`) during `arrived`, landing right on the cul-de-sac circle
  at either end instead of stopping a little short of it - that's
  `busPx`'s own job (see "Progress bar: evenly distributed markers"
  further below for its full per-phase formula, including how it tracks
  the turn/stop marker positions during the `step` phase in between).
  Getting the bus icon to actually *reach* those exact edges
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
that used to sit on the map image (see "Maps, part four" further below
- it's a real map now). The randomization uses a tiny seeded PRNG
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

### Route list: AM/PM filter toggles

The search box shrank from `w-full` to `flex-1` inside a new row
(`flex ... gap-2`) to make room alongside it for two pill toggle
buttons, "AM" and "PM" - filtering the list to morning-pickup or
afternoon-dropoff routes. Every route in this app is one or the other
(`demoRoutes.ts`'s `TRIP_LABELS` only ever fabricates "Morning Pickup"
or "Afternoon Drop Off"), so the toggles filter on the existing
`Route.tripType` field (`"pickup"` = AM, `"dropoff"` = PM) rather than
needing a new one. Each button toggles independently in
`activeTrips: Set<TripType>` - neither active (the default) or both
active both mean "no filter, show every trip type," only one active
narrows the list to just that type - combined with the existing text
search (`matchesQuery && matchesTrip` in the same `filtered` `useMemo`).
The empty-state message now branches on which kind of "nothing matched"
it is: quoting the search query when there is one, or "No routes match
the selected filters." when the toggles alone emptied the list. Visual
treatment matches the Back/Pause buttons from the color-darkening round
above - gray (`border-zinc-400 bg-zinc-200`) when off, filled blue
(`bg-blue-600`) when on - so an active filter reads as "on" the same
way the rest of the app already signals it.

### Progress bar: evenly distributed markers

First pass at pulling the first/last marker off the cul-de-sac circles
(so the very first turn icon didn't visually sit right on top of the
start circle, and likewise at the end) only special-cased those two:
`markerPixelFor` returned an inset position for `index === 0` and
`index === total - 1`, but left every marker in between on the plain
`pixelFor(index)` grid. That created its own visible problem - the gap
between marker 0 and marker 1 was `PX_PER_STEP` minus the inset (a
shorter gap than everywhere else), not the same pitch as every other
pair of markers. The fix, on explicit feedback ("don't just indent the
first and last... make that the starting point of the bar that they are
all divided equally spaced between"): `markerPixelFor(index, total,
trackWidth)` now divides the *entire* span between an inset start and
an inset end (`MARKER_EDGE_INSET_PX`, still 22px, still capped at
`PX_PER_STEP / 2` so it can never cross into a neighboring marker's
position on a very short route) into `total - 1` perfectly equal
segments, and places every marker - not just the first and last - on
that even grid: `MARKER_EDGE_INSET_PX + (index / (total - 1)) *
(trackWidth - 2 * MARKER_EDGE_INSET_PX)`. Measured the actual rendered
gap between every consecutive marker pair on the real 22-step route
after this change - a constant ~46px throughout, first marker centered
22px from the start circle and the last 22px from the end circle,
matching `MARKER_EDGE_INSET_PX` exactly.

That round left `busPx` on the plain `pixelFor(currentIndex)`, uninset -
which was correct for *reaching* the true `0`/`trackWidth` ends, but
wrong everywhere in between: once the markers moved to the evenly
re-spaced grid above, the bus (still on the raw `pixelFor` grid) no
longer landed on top of whichever marker was actually current - caught
immediately ("the bus doesn't line up with the stops anymore now that
we've properly spread them out"). `RouteProgressBar` now takes a
`phase` prop and computes `busPx` per phase instead of one formula for
all of them: `0` for `depot` (centered on the start circle - the literal
track start, not a marker), `trackWidth` for `arrived` (centered on the
end circle, for the "all stops complete" message), and
`markerPixelFor(currentIndex, total, trackWidth)` - the exact same
function the marker icons themselves use - for `step`, so the bus
always lands precisely on the current turn/stop icon rather than a
separate, no-longer-matching grid. Confirmed by measuring each phase's
actual rendered bus-center against the corresponding marker/circle
center on the real route: depot ≈ start circle (0 vs. 2px), the first
real step exactly matches the first marker (22 vs. 22px), the last real
step (Stop 11) exactly matches the last marker (986 vs. 986px), and
arrived ≈ the end circle (1008 vs. 1006px) - the couple-px differences
are the circles' own border width, not misalignment. The auto-scroll
centering logic (which keeps the current position roughly centered in
the visible window) was updated to center on this same `busPx` instead
of the old raw `pixelFor(currentIndex)`, so it now settles the view on
wherever the bus/marker pair actually is rather than a slightly
different, no-longer-used position.

### Route data: two CSVs now, and a dropped column

`public/data/route-125.csv` (the turn-by-turn steps) had its leading
`sequence` column dropped entirely, on request ("we don't need the
numbers") - each row's position in the file already gives it an order,
so the column was purely redundant. Schema is now
`time,action,from_at,onto_at,rider_count,side,notes`; `parseRouteCsv.ts`
updated its destructure to skip one leading column instead of two.

A second file, `public/data/route-125-meta.csv`, now sits alongside it -
the route-level metadata (`name`, `routeNumber`, `driverName`,
`busNumber`, `departureTime`, `schoolName`, `schoolAddress`, `tripType`,
`distance`, `durationMinutes`) used to live as a hardcoded `ROUTE_META`
object directly in `page.tsx`; per "I'm building [a CSV] to keep track
of the route metadata... move all the stuff you created into that
file," it's now sourced from this real, tab-separated sheet instead
(`route_number, route_name, bus_number, school_name, pickup_dropoff,
start_time, end_time, stop_count, rider_count` - one header row, one
data row per route), parsed by the new `parseRouteMetaCsv.ts`. Its
schema doesn't happen to cover every `RouteMeta` field though:
`driverName`, `schoolAddress`, and `distance` have no column in it, so
those three stay hardcoded placeholders in `page.tsx`
(`PLACEHOLDER_META`), merged in alongside whatever the CSV parses out
(`{ ...parseRouteMetaCsv(metaCsv), ...PLACEHOLDER_META }`) - the same
"flag it as a placeholder rather than silently fabricate it" spirit as
`distance`/`durationMinutes` were before, just narrowed down to only the
fields that genuinely have nowhere else to come from yet.
`durationMinutes` is one that *does* get to stop being a guess now: the
metadata sheet gives `start_time`/`end_time` instead of a duration
directly, so `parseRouteMetaCsv` computes it (wrapping across midnight
the same way `addMinutesToTimeString` does), which happens to land on
30 real minutes rather than the previous guessed 28. `stop_count`/
`rider_count` are in the sheet too, but deliberately not parsed into
anything - the app already derives both, live, from the real steps CSV
(`parseRouteCsv`), which stays correct if a stop is ever added or
removed there; re-deriving the same numbers from this file's own copy
would just be a second source that could quietly drift out of sync with
it.

### Maps, part one: deriving a geocodable location for every step

First step toward a real map: before anything can be geocoded or routed
(planned: OSM tiles + OpenRouteService for the actual driving directions
- ORS over self-hosting something like Valhalla, since a prototype's
usage is well within its free tier and it doesn't need a server of its
own to run), every turn/stop needs a real-world location to look up.
`route-125.csv` doesn't carry coordinates, and most of its turn rows
don't even carry two road names to treat as a crossroads - the source
paper route sheet's own shorthand is a single road name (`onto_at`
blank) meaning "turn onto this road," not an intersection.

The insight that unlocks this: a plain turn like that isn't really
locationless, it's just that its location depends on context - "turn
left onto Riverwood Ln" only means something at the specific point the
bus was already traveling on some other road and reached Riverwood Ln.
That other road is recoverable by walking the CSV in order and tracking
"the current road" - `deriveWaypoints.ts`'s whole job. The rule: a turn
row's current road becomes whichever road it turns onto; a stop row's
current road is the road it's stopped *on* (the cross street is just
where along that road the stop is, not a new heading), except a
literal-address stop with no cross street at all (`"216 Lake Forest
Dr"`), where the road name is pulled out of the address text itself.
Any row that states its own road(s) explicitly always wins over the
tracked value and resets it - which matters because the source sheet
has at least one real gap: `route-125.csv` turns right onto "Fergus Rd"
(row 4), then, three rows later, has an explicit stop on "Bill Stewart
Rd" with no turn in between. Not a missing turn after all, it turns out
- Fergus Rd just becomes Bill Stewart Rd along its own length with no
turn required, confirmed and now noted directly on that turn row's
`notes` column ("Fergus Rd becomes Bill Stewart Rd," spoken as its own
utterance right after the turn instruction - see below). Either way -
a genuinely missing turn, or a road renaming without one - the tracked
"current road" goes stale for those few rows in between, but that's
harmless, since a stale tracked value never propagates past the next
row that states its own road explicitly.

Every row ends up as one `WaypointQuery`: either `{ kind: "address",
text }` (a literal street address, or the school's own address for the
one generic, non-geocodable placeholder in the sheet, `"School Parking
Lot"`, standing in for wherever the bus meets the road right at the
school) or `{ kind: "intersection", roadA, roadB }` (a crossroads
to resolve as one point). Verified against the real 22-row route: every
derived intersection for a plain turn immediately following a stop
lines up exactly with that stop's own two roads (e.g. row 11, "Left,
Riverwood Ln," derives to "Bill Stewart Rd × Riverwood Ln" - the same
intersection row 10's stop is already at), which is exactly what should
happen when a bus turns right where it just finished a stop. Checked by
compiling `parseRouteCsv.ts`/`deriveWaypoints.ts` standalone (`tsc`
straight to CommonJS, no bundler) and running them against the real CSV
in plain Node, since neither is wired into any UI yet - this is
groundwork, not a visible change. `parseRouteCsv.ts` picked up a small
refactor alongside it: the CSV-row-splitting half of its work is now
`parseRouteCsvRows` (returns `RawRouteRow[]`, the shared input type both
`parseRouteCsv` and `deriveWaypoints` build on) instead of being inlined
in `parseRouteCsv` itself - confirmed byte-for-byte identical `Route`
output before/after (22 steps, 11 stops, same first step) so this was
purely a "share the parsing" extraction, not a behavior change.

Adding that note surfaced two small real bugs in how notes get spoken,
fixed alongside it in `parseRouteCsv.ts`: a turn row's `notes` was
already shown on screen (`TurnContent` already rendered
`step.specialInstruction`) but was never actually included in that
step's `announcement` array, unlike a stop's - so a note on a turn
would silently never be spoken at all. And neither a turn's nor a
stop's note was run through `speakRoadNames()` before being spoken, so
a note that happens to mention an abbreviated road name (exactly this
one - "Fergus Rd becomes Bill Stewart Rd") would have had the TTS
engine reading "Rd" as a raw abbreviation instead of "Road." Both now
match how every other spoken road name in the app is handled - notes
still display in their raw, abbreviated CSV form on screen, same as
`from_at`/`onto_at` always have; only the *spoken* version runs through
`speakRoadNames()`. Confirmed by intercepting the actual
`SpeechSynthesisUtterance` text in a headless browser while stepping
through to that turn: "Turn right from Ramp toward Murfreesboro onto
Fergus Road." immediately followed by "Fergus Road becomes Bill
Stewart Road." as its own utterance, with "Fergus Rd becomes Bill
Stewart Rd" (abbreviated) shown on screen underneath.

Not yet wired up: actually geocoding these queries (Nominatim, free,
matches the "don't run our own server" preference for a prototype),
caching the results (probably back into the CSV, or a sibling file, so
a rebuild doesn't re-geocode everything), calling ORS with the ordered
list of resolved coordinates, and rendering any of it. Next steps.

### Button/road color: darker gray, less glossy highlight, Pause is gray now too

The Back button (`bg-zinc-100`/`border-zinc-300`) read noticeably
lighter than everything else around it - flagged directly: "the back
button is so much lighter, we need to reduce the shading effect to
compensate." Two changes, together:

- `.btn-glossy`'s white top-highlight (`globals.css`) was toned down -
  the gradient stop from `rgba(255,255,255,0.35)` to `0.2`, the inset
  top highlight from `0.55` to `0.32` - since that highlight is what was
  washing the light gray fill out the most; the drop-shadow/bottom-inset
  components were left close to where they were (one nudged slightly
  darker, `0.18` → `0.2`) so buttons still read as glossy/dimensional,
  just without the glare on a light background.
- The gray itself darkened a step: `bg-zinc-100`/`border-zinc-300` →
  `bg-zinc-200`/`border-zinc-400`, on both places that combination was
  used - the footer's Back button (`StepScreen.tsx`) and the
  trip-summary screen's round back-arrow button (`StartScreen.tsx`).
  "The route" (`RouteProgressBar.tsx`'s road and both cul-de-sac
  circles) got the same one-step darkening for consistency -
  `border-zinc-600`/`bg-zinc-400` → `border-zinc-700`/`bg-zinc-500`.

The Pause button was solid `bg-blue-600` with a white icon - changed to
match the (now-darker) Back button's gray exactly, border included
(`border-zinc-400 bg-zinc-200`), with the play/pause icon itself
recolored from white to `text-zinc-700` for contrast against the
lighter fill: "Back button and pause button (I want that gray too, not
blue)." The Start Route/Next/End buttons stay blue - only Back and
Pause were named.

### Step content: flush against the progress bar, fading in from below

The step-content box (`StepTransition.tsx`, holding the current
turn/stop's icon and street name) sat a few px below the progress bar
- the flex column wrapping both had its own `gap-1.5`. On an outgoing
step (sliding straight up and off, see the odometer-roll doc comment on
that component), that gap meant the content visibly vanished into a
strip of plain background for a beat before it would have reached the
bar, rather than reading as ducking under it: "make the directions
container box reach all the way to the bottom of the progress bar...
rather than being cut off before that." Removing that `gap-1.5`
(`StepScreen.tsx` - the flex column has exactly the two children,
`RouteProgressBar` and `StepTransition`, so there was nothing else the
gap was doing double duty for) puts the step box's top edge flush
against the bar's own bottom edge (confirmed at 0px in a headless
browser across all three viewports); an outgoing step now gets clipped
right at that shared line instead of a beat early, which is what
actually sells "goes underneath the bar" - the box's `overflow-hidden`
top edge was already a hard clip, it just needed to be in the right
place.

The bottom edge got the opposite treatment: a soft `mask-image` fade
(`BOTTOM_FADE_PX = 24`, the same `linear-gradient(to bottom, black
calc(100% - Npx), transparent 100%)` technique the progress bar's own
left/right edge fades already use) rather than a hard line, since an
*incoming* step slides up through that edge from below and a sharp
cutoff there read as an abrupt pop-in right as it crossed it: "put a
fade mask so it's not a hard clipped line as the directions fly in from
below." Confirmed on a slowed-down transition (`animation-duration`
overridden to 1600ms via an injected stylesheet, several screenshots
taken through it) that the incoming icon's leading edge now dissolves
in smoothly rather than snapping into view. The two edges are
deliberately asymmetric - hard clip at the top so it reads as sliding
behind an opaque bar, a soft fade at the bottom so it reads as
materializing rather than popping in - matching what's actually
adjacent to each: the progress bar at the top, empty space (no
adjacent element to "duck under") at the bottom.

### Maps, part two: geocoding, cached in a separate file

The next piece after deriving a `WaypointQuery` for every row (part
one, above): actually resolve each one to real coordinates, without
re-querying the geocoder every time the app loads or (worse) every
time someone glances at `route-125.csv`. `npm run geocode`
(`scripts/geocodeRoute.ts`) does this as a standalone step, writing
`public/data/route-125-waypoints.json` - `route-125.csv` stays the one
source of truth for the route; the waypoints file is a derived,
disposable cache that can be regenerated from it at any time, not a
second place route data has to be kept in sync by hand.

**Cache keys are content-addressed, not row-indexed** - the whole
mechanism behind "editing the CSV triggers a refresh" without any
separate staleness tracking. `waypointCacheKey` (`waypointCache.ts`)
turns a `WaypointQuery` straight into its key: `address:<text>` for a
literal address, `intersection:<roadA> & <roadB>` (roads sorted first,
so "A & B" and "B & A" - the same real intersection, however a given
row happens to state it - always land on one shared entry) for a
crossroads. Edit a row's road name and its derived query changes,
which changes its key, which is simply a cache miss next run - geocoded
fresh, no explicit invalidation step needed anywhere. Leave a row
untouched and it derives the identical query it always did, so it
keeps hitting the same cache entry indefinitely. The script also prunes
any cache entry no longer referenced by the current CSV before writing,
so the file never accumulates entries from since-edited-away rows -
genuinely one source of truth, not two files that can silently drift
apart.

**Failures aren't cached, only successes are** (`geocode.ts` returns a
`status: "error"` entry for "no result," but `geocodeRoute.ts`
deliberately never writes those to the file) - a failed lookup almost
always means the query wording needs a fix in the CSV, and leaving it
out of the cache means it's retried automatically on the very next run
rather than staying silently stuck failed forever with no cache-clearing
step to remember. The real route surfaced two of these on a mocked test
run: "Ramp toward Murfreesboro" (an unnamed highway ramp, unlikely to
resolve as a named road in OSM) appears in two derived intersections and
failed both, exactly as expected - a real, expected gap to either
accept or word around later, not a bug in the derivation.

**Geocoding is behind a one-line-swappable provider abstraction**
(`geocode.ts`) from the start - every caller (`scripts/geocodeRoute.ts`)
talks only to `geocodeQuery`, a `GeocodeProvider` function value, never
to a specific service's own request/response shape. Originally that was
Nominatim (OSM's own geocoder, free, no API key - matching the "don't
run our own server for a prototype" reasoning behind picking ORS over
Valhalla for routing); see "Maps, part five" below for why the active
provider changed and what stayed the same. `queryTextFor` and
`extractCityState` are shared across every provider, since building
"Road A and Road B, City, ST" out of a `WaypointQuery` isn't specific to
who resolves it - every query other than the school's own full address
needs that geographic hint to disambiguate a road name that could exist
in more than one town, pulled off the end of
`PLACEHOLDER_META.schoolAddress` (the same address `page.tsx` displays,
its own module specifically so the script and the app share one copy
instead of a second hardcoded one that could drift out of sync with it).

Not yet wired up: rendering any of this on a map, and the ORS routing
call itself.

### Maps, part three: keeping the waypoint cache fresh without redeploying every time

The obvious next question once the cache exists: who runs `npm run
geocode`, and when? Regenerating it on every Vercel deploy was the
first idea considered, and rejected - not because ~20 seconds (19
unique queries at a conservative 1-request/second pace) is slow, but
because it means a live third-party API sits in the build's critical
path (it rate-limits or blocks you → your build fails, for content
that hasn't even changed) and repeatedly re-fetching the exact same 19
queries on every single deploy is exactly the kind of pattern a free
geocoding API's usage policy exists to discourage - risking the very
rate-limiting/blocking that would then break builds. (This reasoning
held for Nominatim originally and holds just as well for ORS now - see
"Maps, part five" below for the provider switch itself.)

The actual answer is that the committed JSON file already *is* the
persistent, safe location - that was the whole point of caching it in
its own file in the first place rather than computing it live - so
Vercel's build never needs network access to a geocoder at all; it just
reads whatever's already committed. What was still manual was the
"refresh it and commit the result" step, now automated by
`.github/workflows/geocode-route.yml`: triggered by a `push` that
touches `public/data/route-125.csv` specifically (path-filtered, and
scoped to `main`/`claude/ipad-iphone-nav-app-ss8dsk`, the only two
branches in play), it runs `npm run geocode` in GitHub's own runner
(real network access, unlike this session) and, only if the resulting
`route-125-waypoints.json` actually changed, commits and pushes it back
under a `github-actions[bot]` identity. Committing straight to the
branch rather than opening a PR, for now - same direct-commit workflow
this session has used throughout - though a PR-based review step (in
case a lookup ever resolves somewhere unexpected) is an easy switch
later if that starts to matter more than it does at this route's small
scale. The workflow's own commit only ever touches
`route-125-waypoints.json`, never `route-125.csv` itself, so it can't
re-trigger its own path-filtered listener - no infinite loop risk.

### Maps, part four: a real OSM tile map, no route drawn yet

The first genuinely visible piece of the maps work: `RouteMap.tsx`
replaces the static `map-placeholder.jpg` (deleted - nothing references
it anymore) and its "Demo only placeholder, not actual map" overlay
with an actual pannable/zoomable OpenStreetMap tile map, in the same
spot in `StepScreen.tsx`. Deliberately minimal for now, on request -
just centered on La Vergne, TN (`[36.0134, -86.5581]`, zoom 13, both
approximate - a general "somewhere in town" anchor, not tied to any
specific address in the route data) with no route line, stop markers,
or bus position drawn. Those come once the geocoded waypoint cache
(`route-125-waypoints.json`, "Maps, part two"/"three" above) is
actually populated and wired in - still blocked on not having a real
`ORS_API_KEY` yet to test the provider switch described in "Maps, part
five" below.

Library choice: plain `leaflet` (+ `@types/leaflet`), not
`react-leaflet` - for a map this simple (one tile layer, nothing
declarative to bind to React state yet), an imperative `L.map()`/
`L.tileLayer()` setup in a single `useEffect` is less code and one
fewer dependency than wiring up a React binding layer, and sidesteps
any question of whether that binding's peer-dependency range has
caught up to React 19 yet. Worth reconsidering once markers/a route
line need to stay in sync with React state on every render, which is
exactly the shape `react-leaflet` is built for.

**The SSR trap, and how this avoids it**: `leaflet` touches `window` as
soon as its JS module is evaluated - completely normal for a
browser-only mapping library, but fatal if that import happens at
module top level in a "use client" component, because Next still
server-renders that component's first HTML (client components hydrate,
they don't skip SSR entirely) and `window` doesn't exist there. Two
imports needed splitting apart because of this: `import
"leaflet/dist/leaflet.css"` is fine at the top of the file (CSS has no
`window` dependency), but the JS side (`import("leaflet")`) is deferred
to *inside* the mount effect - which only ever runs in the browser -
via a dynamic `import()` rather than a static one. A `cancelled` flag
closed over by the effect's cleanup guards against the narrow race
where React unmounts before that dynamic import resolves (React
StrictMode's dev-only mount/unmount/remount is the realistic case) -
without it, a map could get initialized on a container that's already
being torn down, with nothing left to call `.remove()` on it.

**Verified without the real tiles ever loading** - this sandboxed
session can't reach `tile.openstreetmap.org` either (same organization
network policy that blocks Nominatim), confirmed the same way. Playwright
intercepted the tile requests with a stand-in 1×1 image so the browser
wouldn't just hang or fail-loop on the sandbox's own network block, and
that isolated exactly the questions that mattered: `.leaflet-container`
mounted, the OSM attribution control rendered ("Leaflet | © OpenStreetMap
contributors"), the map fired the expected 15 tile requests for a
1180×820 viewport at zoom 13 to a well-formed, correctly-parameterized
URL (subdomain rotation and all - `https://c.tile.openstreetmap.org/13/
2126/3216.png`), and there were zero console/page errors. What that
run can't confirm - and won't be knowable from inside this session -
is what the actual OSM tile imagery looks like; that needs checking
somewhere with real network access to `tile.openstreetmap.org`, same
caveat as the waypoint cache.

### Maps, part five: swapping the geocoding provider, and why it was only a one-line change

Three identical failures confirmed the geocode workflow's real problem
wasn't fixable from this side: Nominatim's usage policy is enforced by
*IP address*, not an API key, and GitHub Actions' shared runner IPs are
used by enormous numbers of unrelated jobs worldwide - exactly the kind
of traffic that policy exists to block, regardless of what `User-Agent`
a given request carries. First attempt was strengthening the
`User-Agent` (pointing it at the repo's Issues page instead of just its
root) on the theory that Nominatim's "identify your application" policy
language was the issue; re-ran the workflow against that fix
(`workflow_dispatch`, added temporarily for exactly this, and kept
afterward - see below) and it failed the same way a third time,
ruling that out and confirming the IP-block theory instead.

`geocode.ts` was written as a provider abstraction from the start (see
"Maps, part two" above) specifically so this kind of swap wouldn't
touch anything else in the codebase - `GeocodeProvider` is the one
shared shape (`(query, locationContext, apiKey, fetchImpl?) =>
Promise<WaypointCacheEntry>`) every implementation returns, and
`geocodeQuery`, the name every caller actually imports, is just
`export const geocodeQuery: GeocodeProvider = geocodeViaOpenRouteService;`
at the bottom of the file. Switching providers was changing that one
line (from `geocodeViaNominatim`) - `scripts/geocodeRoute.ts` didn't
change at all. `geocodeViaNominatim` stays in the file rather than
getting deleted - nothing about Nominatim itself was wrong for this
app's data, only for automated traffic from a shared CI IP, so it's
still there for a human running `npm run geocode` from their own
machine, where that policy isn't an issue. `queryTextFor`/
`extractCityState` (plain query-text construction, no service-specific
shape) stayed shared across both.

**Why OpenRouteService specifically**: it's key-based, not IP-based, so
CI works; and this app already needs an ORS key regardless for the
actual routing/directions call once that's built, so this doesn't add
a second external service to configure - one key covers geocoding and
routing both. Its geocoding is Pelias-based, which blends OSM data with
a few other open sources, so it's still fundamentally OSM-rooted, in
keeping with "OSM for our data." One real shape difference from
Nominatim worth calling out: ORS returns coordinates as GeoJSON
`geometry.coordinates`, `[lon, lat]` order - the *opposite* of
Nominatim's separate `lat`/`lon` string fields - so
`geocodeViaOpenRouteService` destructures that tuple explicitly
(`const [lon, lat] = first.geometry.coordinates;`) rather than reusing
Nominatim's field-name-based extraction; got this backwards once while
writing it, then caught it with a mocked-response test asserting the
unpacked `lat`/`lon` numbers landed the right way round; different
requests need an `api_key` query param now too, absent from Nominatim's
call. `WaypointCacheEntry` picked up a `provider` field on both its "ok"
and "error" shapes (`waypointCache.ts`) so a cache entry stays labeled
with which service actually resolved it - useful now that entries could
in principle come from either provider over the cache's lifetime.

**The API key itself is a real, unresolved blocker** - `ORS_API_KEY`
needs to be a free key from openrouteservice.org, provided by a human
(sign-up isn't something this session can do), then made available two
places: as a GitHub repository secret (`Settings → Secrets and
variables → Actions`, referenced in `geocode-route.yml` as
`${{ secrets.ORS_API_KEY }}`) for the automated workflow, and locally
(shell-exported, or in a gitignored `.env.local` - `.env.local.example`
in the repo root documents the one line needed) for a manual `npm run
geocode`. `scripts/geocodeRoute.ts` fails fast with a clear message
if it's unset, before attempting any network call, rather than a
confusing failure deeper in - confirmed directly (ran the compiled
script with the var unset: threw immediately, no request attempted).
Without a real key, the actual ORS response shape is unverified beyond
what the documented API contract and a hand-built mocked response
(matching that contract, including the `[lon, lat]` GeoJSON ordering)
confirm - `workflow_dispatch` on `geocode-route.yml` (added for the
User-Agent test, kept afterward) is there specifically to run a real
test the moment a key exists, without needing an unrelated CSV edit to
trigger it.

### Maps, part six: retina tiles, and why the check-in popup needed a z-index fix too

Two map-adjacent bugs, reported together once someone actually loaded
the app somewhere with real network access to see the tiles for the
first time (this sandbox still can't - see "Maps, part four" above):

**The tiles looked soft on a retina display.** `tile.openstreetmap.org`
only serves standard-resolution 256px tiles - no `{r}`-style `@2x`
variant - so Leaflet was stretching those same-resolution images to
cover more physical pixels on any retina screen, same symptom as the
janky, low-quality maps in other schools'-transportation tools
screenshotted for comparison. Leaflet's own `detectRetina` option is a
no-op unless the tile URL template actually has an `{r}` placeholder a
server can fill, so the fix wasn't a flag - it was switching
`TILE_URL` to CARTO's free Voyager basemap
(`{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`,
`abcd` subdomains, no API key required), which does serve a real `@2x`
tile, styled close to the standard OSM look so this doesn't read as a
different map. Deliberately *not* the "request one zoom level higher
and downscale" trick some retina workarounds use instead - that
roughly quadruples tile requests per view against whatever server is
serving them, and this project already learned the hard way (the
Nominatim IP-block story in "Maps, part five" above) what happens when
automated traffic leans on an OSM-adjacent service's usage policy.
Verified structurally the same way "Maps, part four" verified the
original tile requests - intercepted in a headless browser at
`deviceScaleFactor: 2` - confirming every tile request actually
resolves to the `@2x` URL across all four subdomains, with the
attribution control correctly crediting both OpenStreetMap and CARTO
and zero console/page errors; actual tile imagery still needs eyes
somewhere with real network access, same caveat as before.

**The rider check-in popup was getting hidden behind the map.**
Unrelated to retina specifically, but found and fixed alongside it:
neither the map's container nor its parent in `StepScreen.tsx` set an
explicit `z-index`, so several of Leaflet's own internal panes/controls
that *do* carry one (the zoom control's `1000`, the tile pane's `200`)
escaped to the nearest ancestor stacking context and could paint above
the dimmed-map-plus-popup overlay despite it being later in the DOM -
on a real device, with tiles actually loading, the popup could end up
fully buried instead of merely having its corner clipped by the zoom
control (which is what a no-tile-network repro here showed). Fixed by
giving the map its own stacking context (`z-0`) and lifting the
overlay above it (`z-10`), so the two no longer compete for a shared,
unbounded stacking order.

### Maps, part seven: jumping/scrubbing the progress bar, and a live position dot

Two independent additions, landed together:

**RouteProgressBar is now interactive**, not just a display - tapping
any marker (or the road between them) jumps straight to that step, and
dragging scrubs live through the route, both directions, exactly like
scrubbing a video's timeline. One shared gesture handles both: a plain
tap is just a drag that never moved. `useRouteStepper`'s `jumpTo(target:
SeekTarget)` is the one new entry point both go through -
`SeekTarget` is `{ phase: "depot" }`, `{ phase: "arrived" }`, or `{
phase: "step", index }`, mirroring `StepPhase` itself so the depot/
arrived virtual states (not real indices into `route.steps[]`) stay
directly reachable rather than only approachable by clamping to step 0/
last. `RouteProgressBar` does the pixel math - `seekTargetForLocalX` is
the inverse of the existing `markerPixelFor`, with a small zone past
each end marker (closer to that end's cul-de-sac circle than to its
marker) landing on depot/arrived instead of getting stuck one step
short. Pointer events (not mouse/touch separately) with
`setPointerCapture` on pointerdown, so a drag keeps tracking even once
the finger/cursor leaves the bar's own bounds. `disabled` (wired to
`paused`) mirrors the same gating the Back/Next footer buttons and the
tap-to-advance step content already had - the route shouldn't move out
from under the driver via a fourth gesture that skipped it.

Two gotchas worth flagging for next time. **First**: the pointerdown
handler's `stopPropagation()` only stops that *drag* from reaching
StepScreen's own tap-anywhere-to-advance handler - the browser's
`click` event fires separately, on release, and needed its own
`stopPropagation()` too, same fix `RiderCheckInBox` already has and for
the same reason (any interactive control living inside that
tap-to-advance region has to opt out of both). Caught by the first
verification pass reading `Stop 1 of 11` after a tap clearly aimed
elsewhere - turned out to be a genuine extra `advance()` firing on top
of the real jump, not a pixel-math bug. **Second**: verifying this in a
headless browser needs clicking against the *outer*, `overflow-hidden`,
viewport-sized container's bounding box, not the *inner* track div's -
the inner one is `transform: translateX()`-shifted and, on a route
longer than the visible window, genuinely wider than the viewport, so a
naive "70% of the inner div's own width" coordinate can land off-screen
entirely. Also confirmed: the recentering transform is skipped while
actively dragging (snaps instantly instead) so the bar doesn't lag
behind the pointer, and - a nice side effect of that same recentering
logic - a single drag gesture across just the visible window's width
can still reach the very end of a route much longer than that window,
since the window itself keeps recentering on the current step as the
drag moves it forward.

**RouteMap now shows a live "you are here" dot.** `watchPosition`, not
a one-shot `getCurrentPosition` - the bus is moving for the whole trip,
so a single fetched position would go stale immediately. The dot itself
is a Leaflet `divIcon` built from a plain Tailwind-classed HTML string
(`bg-blue-600` dot, white ring, `animate-ping` halo for a "this is
live" cue) rather than an image asset - Tailwind's build-time scanner
picks up class names anywhere in a `.tsx` file's text, not just actual
`className` props, so this needed nothing extra. The map recenters on
the dot exactly once, on the first fix, and never again after that -
otherwise every subsequent update would yank the view back out from
under a driver who'd since panned/zoomed elsewhere on purpose. No
permission-denied UI beyond a `console.warn`; the app is fully usable
via the turn-by-turn steps regardless, same as if the device simply has
no GPS fix yet. `navigator.geolocation.clearWatch()` in the effect's
existing cleanup, right alongside `map?.remove()`. Verified structurally
in a headless browser with a mocked `geolocation` context permission/
coordinate (real GPS obviously isn't available here) - confirmed a
`.leaflet-marker-icon` containing the `animate-ping` element actually
appears after the mocked position fires. Still just a dot, not tied to
the route itself yet - no route line exists on the map at all yet (see
"Maps, part four" above), so there's nothing yet to check the dot's
position *against*.

### Maps, part eight: stop markers, wired up ahead of having any real data to show

The marker-rendering side is done and merged, but deliberately shows
nothing yet - still blocked on the same `ORS_API_KEY` gap "Maps, part
five" describes, and this sandbox has no more network access to a real
geocoder than it does to the tile servers themselves (confirmed the
same way - `photon.komoot.io` and `api.openrouteservice.org` both fail
the same `CONNECT tunnel failed` the org's egress policy already gives
tile.openstreetmap.org and Nominatim). Asked rather than guessing:
given the choice between fabricating plausible-looking coordinates
from general knowledge of the area (unverifiable from here) or shipping
the wiring with an honestly-empty cache, the latter won.

`parseRouteCsv.ts` now calls `deriveWaypoints`/`waypointCacheKey` itself
(previously only `scripts/geocodeRoute.ts` did) and stamps the result
onto every step as `NavigationStep.waypointKey` - the same key
`route-125-waypoints.json` will eventually be keyed by, so a step can
look itself up in that cache with no client-side re-derivation.
`RouteMap`'s new `stops` prop (`{ waypointKey, number }[]`, built in
`StepScreen` from `route.steps` once per trip) is what it fetches that
cache against, `fetch(...).catch(() => ({}))`-style - a 404 (the
current, real state) or any other failure resolves to an empty cache
rather than an error, so a stop with nothing to look up is just quietly
skipped, not a broken map. Each hit becomes a Leaflet `divIcon` reusing
`/assets/pin.png` plus the stop's own number, same look as the pin
already drawn on RouteProgressBar and StopContent, so a stop reads as
the same thing everywhere it appears once it does have a real
position. Verified end-to-end by dropping a temporary test cache file into
`public/data/` (never committed - deleted again right after, confirmed
via `git status` showing nothing untracked left behind): exactly the
expected pins appeared, correctly numbered, at the fed-in coordinates,
with zero console errors.

Still no route line between stops - next step, on request, once
markers themselves are confirmed working.

### Route data: the master list, and Bus 120's six routes

`route-125-meta.csv` is gone, replaced by `public/data/route-master-list.csv`
- one tab-separated sheet covering every real route instead of one file
per route. New columns: `am_pm` (AM/PM, maps to `tripType`), `school_type`
(EL/MS/HS, maps to `schoolLevel`), and `status` (active/inactive/demo,
per real district data now distinguishing itself from the fabricated
filler routes - see `RouteStatus` in `types.ts`). `route_id` comes
through blank on every real row so far; `parseRouteMasterList.ts`
generates it with the same `${routeNumber}-${tripType}-${schoolLevel}`
convention `Route.id` has always documented, same as `demoRoutes.ts`
already did for the fabricated ones. `parseRouteMetaCsv.ts` is gone too
- its 24-hour time parsing (now handling `H:MM:SS`, not just the old
sheet's `H:MM`) moved into shared `time.ts` helpers
(`parse24HourTimeToMinutes`, `format24HourAsAmPm`,
`durationBetween24HourTimes`) that `parseRouteMasterList.ts` uses as
well, rather than duplicating it.

It turns out Bus 120 runs the same six-way split every other real bus
apparently will: AM pickup and PM dropoff, crossed with elementary/
middle/high school, each its own real path with its own steps sheet
(`120-AM-EL.csv` through `120-PM-HS.csv` - file names follow the
district's own route/AM-PM/school-type convention, e.g. `120-AM-MS.csv`,
rather than this app's own tripType/schoolLevel spelling) - exactly the
scenario `Route.id`'s convention was written for, now confirmed against
real data instead of just demo filler. `parseRouteCsv.ts`'s row parser
(`parseRouteCsvRows`) had to become header-driven rather than assuming
fixed comma-separated columns: Bus 120's sheets are tab-separated, have
a populated `time` column (still not parsed into anything -
`NavigationStep` has no per-step time field) instead of `125-PM-EL.csv`'s
always-blank one, and drop the `side` column entirely rather than
leaving it blank. `page.tsx` now fetches the master list,
builds a real `Route` for every `active`-status row that has a steps
sheet, and feeds all of them into `buildDemoRoutes` (which now reserves
every real route's number, not just one, and picks its filler-content
template from the first real route rather than assuming there's only
ever one).

Of Bus 120's six routes, `120-dropoff-high` came in with visibly
incomplete steps data - it cuts off six rows in, mid-neighborhood,
versus its AM counterpart's eighteen. It's marked `status: "inactive"`
in the master list rather than wired into the app, and its sheet is
still saved to `public/data/` as sent, in case the rest arrives later.
Asked whether the missing part could just be inferred by reversing its
AM counterpart, and declined: turn directions and which side of the
road a stop is on don't mirror simply from a route run the other way
(one-way streets, and pickup order that isn't just dropoff order
backwards), and this is real "active"-status data a driver could
actually use, not demo filler - worth being honestly incomplete rather
than quietly wrong. `120-dropoff-middle` looked similarly suspect at
first pass - it ends mid-street with no closing "arrive" marker after
it - but that's actually how a real dropoff route's data normally ends
in this district's paperwork (`120-dropoff-elementary` and the original
125 route both end the same way, at the last kid's stop rather than any
explicit "return to yard" row), confirmed and corrected to
`status: "active"`.

`schoolAddress` now varies by school instead of one hardcoded value -
`placeholderMeta.ts`'s `SCHOOL_ADDRESSES` keys it by `schoolName`.
Lavergne Lake Elementary keeps its real address; Middle and High don't
have one yet, so they get an honestly-labeled non-address ("Address not
yet provided, Smyrna, TN 37167") that still ends in a real city/state so
`extractCityState` has something to geocode stops against once
addresses do exist. `driverName`/`distance` stay flat placeholders
regardless of route, same "Otto Mann" spirit as before - not
per-route fabrications, just the same "don't have this yet" stand-in
everywhere. Only route 125 defaults to a Favorite; the new real routes
default to not-favorited like demo routes do, absent any real signal
for which routes a driver actually favorites.

### Route data: real school addresses, in their own sheet

`placeholderMeta.ts`'s `SCHOOL_ADDRESSES` object (above) is gone -
addresses now live in `public/data/schools.csv` (`school_name`,
`address` - one header row, one row per school), parsed by the new
`parseSchoolsCsv.ts` into the same by-school-name lookup `page.tsx` and
`scripts/geocodeRoute.ts` both already used, just sourced from a real
sheet instead of a hardcoded object - the first step toward "a table of
schools (and eventually school IDs) instead of addresses living in
app code," with room to grow more columns later the same way
`route-master-list.csv` did. `placeholderMeta.ts` keeps only
`driverName`/`distance` (still flat placeholders) and
`SCHOOL_ADDRESS_NOT_YET_PROVIDED`, now just a fallback for a school the
sheet doesn't have a row for yet, not a hardcoded default for two
specific schools.

Lavergne Middle School (382 Stones River Rd) and Lavergne High School
(250 Wolverine Trail), both La Vergne, TN 37086, replace the
"Address not yet provided" placeholder that filled that gap before -
looked up via NCES's public school directory (the federal Common Core
of Data), cross-checked against several independent real-estate/school
listing sites, not guessed.

That same search also turned up a different address for Lavergne Lake
Elementary - 201 Davids Way, La Vergne, TN 37086 (also NCES, also
cross-checked) - than the "1425 Lake Forest Dr, Smyrna, TN 37167" this
app had treated as real, verified data since early on (originally from
`route-125-meta.csv`), with no record of where that one actually came
from. Confirmed with the district and corrected in `schools.csv` -
"Davids Way" showing up repeatedly in `125-PM-EL.csv`'s own stop data
was the tell that something was off with the old one. Changing
`schoolAddress` changes what `deriveWaypoints` produces for every
stop on the route, so `route-125-waypoints.json` needs a fresh
`npm run geocode` run - the `geocode-route.yml` workflow now watches
`schools.csv` too (previously only `125-PM-EL.csv`), so pushing this
change triggers that automatically once `ORS_API_KEY` is set as a
repository secret (still outstanding - see Next steps).

### Maps, part nine: prototyping intersection lookups against the real OSM road graph, not a general geocoder

The standing problem: every waypoint (`deriveWaypoints.ts`) is either a
literal address or a "Road A & Road B" crossroads, but the active
geocoder (ORS/Pelias's `/geocode/search`, see `geocode.ts`) resolves
both the same way - free text sent to a general-purpose search index.
Fine for a real address; a real intersection lookup it isn't, so a
cross-street query is really just hoping the text search happens to
land on the right point. Asked whether anchoring to the school's known
address and resolving stops one at a time in sequence would help, or
whether there's a better approach.

`scripts/prototypeOverpassGeocode.ts` is the answer, as a prototype
against `125-PM-EL.csv` - not wired into the app or
`scripts/geocodeRoute.ts` itself. Rather than text search, it asks
OpenStreetMap's Overpass API a structured graph question for each
crossroads: find a node that's a member of both roads' ways (the
standard `node(w.a)(w.b)` street-intersection recipe), inside a
bounding box. Road names get the same abbreviation expansion
`speakRoadNames` already does for speech ("Rd" -> "Road") since OSM's
own `name` tags are spelled out in full, matched case-insensitively so
capitalization doesn't matter either.

Where "start from a known address" actually turned out to matter:
not resolving stops one at a time in sequence (each intersection query
is still independent, order doesn't matter) - it's what the *search
box* is centered on. The school's own address is still geocoded once,
normally (a real address, ORS handles it fine), and that point plus a
fixed radius (~4-5 miles - route 125 is 8.4 miles round trip) becomes
the bounding box every Overpass query is scoped to, so a same-named
road elsewhere in the metro area can't produce a wrong match. Sequence
does earn a place, but only as a tie-breaker: `pickNearest` picks the
closest candidate to wherever the route was last resolved to, for the
rare case Overpass returns more than one shared node (two roads
legitimately crossing twice, or a road split across multiple OSM ways
that each touch the other one).

Verified the query-building and response-parsing logic against route
125's real data with a hand-fabricated Overpass response (single-node,
zero-node, and multi-node cases) - all correct, including the
abbreviation expansion showing up in the actual query text sent for
"Rock Springs Rd & Old Nashville Hwy". What's *not* verified: real
coordinates. This sandbox's network egress policy blocks
`overpass-api.de` outright (confirmed the same "gateway answered 403 to
CONNECT" way `tile.openstreetmap.org`/Nominatim/ORS already are - see
"Maps, part four") - the same policy also currently blocks the ORS call
this prototype needs first, to geocode the school address itself.

`.github/workflows/prototype-overpass.yml` (`workflow_dispatch` only -
no push trigger, no commit step, doesn't touch the repo) runs it
somewhere that actually has network access instead: `npm run
prototype:overpass` (new script, compiles the same way `npm run
geocode` does - `tsc --project scripts/tsconfig.json`, then plain
`node` on the output, no runtime TS-execution dependency needed), with
its console output written to the run's job summary and
`scripts/prototype-overpass-results.json` uploaded as an artifact.
Still blocked on the same missing `ORS_API_KEY` repository secret
everything geocoding-related is (see Next steps) - the workflow itself
is ready, but a run before that secret exists will fail at the same
"ORS_API_KEY isn't set" check `scripts/geocodeRoute.ts` already has,
confirmed locally.

First real run (once `ORS_API_KEY` was added): the school-address
anchor geocode worked fine (a real address, ORS handles it same as
always - 201 Davids Way resolved to 36.038689, -86.555189), but all 20
of route 125's real crossroads came back `406 Not Acceptable` from
Overpass - not "no intersection found," an outright rejection before
Overpass even looked at the query. Turned out to be the same class of
problem `geocode.ts`'s `NOMINATIM_USER_AGENT` comment already warns
about: no identifying `User-Agent` on the request. Added one (plus an
explicit `Accept: application/json`), same string Nominatim already
uses - not optional in practice for either service, whatever the HTTP
spec says 406 is supposed to mean.

Second run, same fix: **5 of 20 real crossroads resolved to exactly one
node**, 1 came back ambiguous (2 shared nodes - `pickNearest` correctly
picked the one closer to the previous stop), 4 were transient
infrastructure failures (429/504 from hitting the public
`overpass-api.de` instance too fast, back-to-back with no pacing - not
a verdict on the method, just a "needs rate-limiting before this is
more than a prototype" finding), and the other 10 came back "no shared
node in the search box." That last bucket isn't evenly spread: 8 of
those 10 are every single query naming "Bill Stewart Rd" - one road,
consistently, regardless of which cross street it's paired with. Every
other road name (Rock Springs Rd, Old Nashville Hwy, Sam Ridley Pkwy,
Holland Ridge Dr, Judge Mason Way, Carmen Way) resolved fine at least
once, including one pair queried twice landing on the exact same
coordinates both times (36.0441259, -86.5478848 for Carmen Way &
Holland Ridge Dr) - a real consistency check a text-search geocoder
has no equivalent of. That pattern pointed at a name mismatch, same
kind of issue as "Lavergne" vs. "La Vergne" for the school address -
confirmed: it's "Bill Stewart **Blvd**," not "Rd." `125-PM-EL.csv` had
it wrong in all 8 of its own occurrences (7 stops plus the "Fergus Rd
becomes Bill Stewart Rd" note), corrected now - not a flaw in the
Overpass approach, a bad name in the source data it was querying with.
"Sam Ridley Pkwy & Ramp toward Murfreesboro" coming back empty is
expected, not a miss - "Ramp toward Murfreesboro" is the paper sheet's
own description of an unnamed highway ramp, not a real road name to
look up.

Re-ran just the 8 "Bill Stewart Blvd" intersections after the fix
(`PROTOTYPE_FILTER=Bill Stewart` - see below): **4 resolved cleanly**
(Hidden Forest Ln -> 36.0406636, -86.5404985; Ruth Ln -> 36.0442348,
-86.5400776; Drennan Ln -> 36.0450625, -86.5398457; Lake Forest Dr ->
36.0395056, -86.5406313), 3 hit 429/504 again (this public instance
clearly doesn't tolerate back-to-back calls with no pacing - a real
finding on its own, not a resolution problem), and 1 - Red Bud Ln -
came back with no shared node. Zero-for-eight to four-for-five
(excluding the rate-limited ones) confirms the diagnosis: the name was
the whole problem for this road, not the method.

Red Bud Ln turned out to be the same class of mistake, just smaller -
confirmed against a real map: it's "Redbud Ln," one word, not "Red
Bud" as two. Fixed in `125-PM-EL.csv` alongside Bill Stewart, then
re-run on its own (`PROTOTYPE_FILTER=Redbud` - a single query, no rate
limiting to worry about): resolved clean on the first try, 36.0434458,
-86.540132. Every single "why didn't this match" question this
prototype has raised so far has turned out to be a real name mismatch
in the source data, not a limitation of the Overpass approach -
`125-PM-EL.csv` had two of them (Bill Stewart Blvd, Redbud Ln), the
school address had a third (see "Route data: real school addresses"
above).

### Maps, part ten: wiring Overpass into the real pipeline, one cache per route

The prototype in "Maps, part nine" above answered the two open
questions (does the Overpass approach work? does pacing fix the
429/504s?) well enough to stop being a side script and become the real
provider. Four changes landed together, since none of them was useful
alone:

**"Unresolvable" rows, detected before ever spending a query.**
`deriveWaypoints.ts` gained a third `WaypointQuery` kind alongside
`address`/`intersection` - `unresolvable`, for a route-sheet road
description that reads like a name but never was one. Right now that's
just `/\bramp\b/i` - "Ramp toward Murfreesboro" (see "Maps, part nine"
above - this is the exact case that prototype's one genuinely-expected
empty result turned out to be) - caught by pattern instead of by a
human flagging it row-by-row. Deliberately narrow: a false positive
here silently drops a real, resolvable stop, which is worse than an
unresolvable one occasionally still getting queried and failing loudly
with "no shared node found." Expand the pattern only against another
confirmed real case, not preemptively. `waypointCacheKey` and
`geocode.ts`'s `queryTextFor`/`GeocodeProvider` both had to account for
the new kind - the latter by narrowing its accepted type to exclude it
entirely (`GeocodableQuery`), so a caller holding a full `WaypointQuery`
has to filter unresolvable ones out before it type-checks, not just
remember to at runtime.

**Pacing and retry, not just pacing.** The prototype's 429/504s came
from zero delay between back-to-back calls to the same public Overpass
instance. `overpassGeocode.ts` (below) adds both: a fixed delay between
calls (reusing the same 1100ms the Nominatim era already established),
and up to two retries with a pause when a single call itself comes back
429 or 504, rather than counting a rate-limited response as a real miss.

**The prototype's Overpass code, promoted to `src/lib/overpassGeocode.ts`.**
`boundingBoxAround`, `buildIntersectionQuery`, `parseIntersectionResponse`,
`pickNearest`, and `resolveIntersection` (now with the retry above) moved
out of `scripts/prototypeOverpassGeocode.ts` into a real `src/lib` module,
the same way `geocode.ts` already holds the ORS/Nominatim providers.
The prototype script now imports from it instead of keeping its own
copy - it's still useful as a re-test harness (`PROTOTYPE_FILTER` to
re-check just one road name fix without spending a whole route's worth
of calls), just no longer the only place this code lives.

**`scripts/geocodeRoute.ts`, generalized from one hardcoded route to
every active one.** It now reads `route-master-list.csv` itself, computes
each active row's steps-CSV basename via `stepsCsvBaseName`
(`parseRouteMasterList.ts` - the exact inverse of how that file derives
`tripType`/`schoolLevel` from the sheet's own `am_pm`/`school_type`
columns), and - skipping any active row whose steps CSV doesn't exist on
disk yet, or whose school has no address in `schools.csv`, the same kind
of gap `page.tsx` already tolerates - geocodes each one's waypoints into
its **own** sidecar cache file (`{basename}-waypoints.json`), not one
shared `route-125-waypoints.json`. Addresses still go through ORS
(`geocode.ts`); intersections now go through the promoted Overpass module
instead of ORS's free-text search; an `unresolvable` row is skipped
entirely, spending no query and needing no cache entry. `RouteMap.tsx`
follows the same convention on the read side - it now takes a
`waypointsUrl` prop (computed by `StepScreen.tsx` from the current
route, the same `stepsCsvBaseName` call) instead of a single hardcoded
constant, so each route's step screen loads its own cache file. A demo
(fabricated) route's computed URL simply 404s, resolving to an empty
cache exactly like a real route whose geocode run hasn't populated one
yet - no special-casing needed.

`geocode-route.yml`'s trigger broadened from the one CSV path it used to
watch to `public/data/*.csv` (every steps sheet, `schools.csv`, and
`route-master-list.csv` itself - adding/removing an active row, or
changing which school/trip/level it names, changes which sidecar gets
built), and its commit step now stages `public/data/*-waypoints.json`
as a whole rather than one named file.

None of this has run for real yet - still blocked on the same missing
`ORS_API_KEY` "Maps, part five"/"Next steps" have been tracking, and
this sandbox's own network restrictions (see "Maps, part four") mean
verification has to happen via `geocode-route.yml`/`workflow_dispatch`
in CI, same as every other real-network check this project has needed
so far.

### Next steps

- **Get an `ORS_API_KEY`** (free at openrouteservice.org) and add it as
  a GitHub repository secret, plus locally in a gitignored `.env.local`
  if running `npm run geocode` by hand - see "Maps, part five" above.
  Nothing geocoding-related can actually run for real until this
  exists; once it does, `workflow_dispatch` on `geocode-route.yml` can
  confirm the OpenRouteService switch works without needing a CSV edit
- The Overpass approach (see "Maps, part nine" above) is now wired into
  the real pipeline, pacing/retry included (see "Maps, part ten" above)
  - `scripts/geocodeRoute.ts` uses it for every route's intersections,
  ORS for plain addresses. Still needs one clean full-run verification
  once `ORS_API_KEY` exists (bullet above) - everything so far has only
  been checked via the standalone prototype/type-checking, not a real
  end-to-end `npm run geocode` against live network access
- Fill in the CSV's missing `time` and `notes` columns (departure/stop
  times, special instructions) once that data exists
- It'd be nice to show each stop's estimated time alongside the actual
  current time, once real stop-time estimates exist (depends on the
  `time` column above and, eventually, real routing/traffic data) - lets
  a driver see at a glance whether they're running ahead or behind
- `driverName: "Otto Mann"` and `distance: "8.4 mi"` (`placeholderMeta.ts`)
  are still placeholders on every route, not real data - swap them in
  once there's an actual driver/routing source. `durationMinutes` no
  longer needs one for any `active` route - the master list's
  `start_time`/`end_time` cover that now
- `120-dropoff-high` is sitting on `status: "inactive"` because its
  steps sheet came in incomplete (see "Route data: the master list"
  above) - once the rest of its stop data arrives, flip it to `active`
  in `route-master-list.csv` and add its entry to `page.tsx`'s
  `ROUTE_STEPS_CSV_PATHS`
- Lavergne Lake Elementary's address is corrected in `schools.csv`
  (201 Davids Way, not the old 1425 Lake Forest Dr - see "Route data:
  real school addresses" above), but no route's sidecar waypoint cache
  has actually been generated against it yet - blocked on the same
  missing `ORS_API_KEY` as the bullet above. Once that's in place,
  either wait for `geocode-route.yml` to pick up this change or run
  `npm run geocode` by hand
- Pinch-zoom on a very long route would help the progress bar - right
  now the fixed 48px-per-step spacing just makes the track (and the
  auto-scrolling) longer rather than ever shrinking markers down to fit
  more of the route in view at once (tap-a-step and drag-to-scrub are
  both in now - see "Maps, part seven" below)
- Move route data into the doc's actual data model
  (District/School/Route/RouteStop/etc.) instead of a flat CSV per route
  plus a master-list sheet gluing them together - there's more than one
  real route now (see "Route data: the master list" above), which is
  exactly the condition this was waiting on
- The map now shows the driver's own live position (see "Maps, part
  seven" below), but still has no route line or stop markers drawn on
  it - those still need the geocoded waypoint cache actually wired in
  (blocked on `ORS_API_KEY`, above). Once they're there, decide how the
  map should coexist with the rider check-in box that currently
  overlays the same spot on a stop (side by side? a toggle? the box
  just wins, like now?)
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
- **Add Route / Edit Route, second pass - built.** RouteListScreen's
  bottom link is "Edit Mode," not a direct "Add Route" - toggling it on
  (or using a route's own "Edit Route" link on StartScreen) reveals
  inactive real routes on the list, dimmed with a status label, and a
  "New Route" link next to "Exit Edit Mode" (only shown once already in
  edit mode - there's no direct route to it otherwise). Each admin-only
  row also gets its own quick actions: Deactivate on an active route,
  Activate + Delete on an inactive one, all three behind a shared
  `ConfirmModal.tsx` (delete's is the only one styled destructive/red).
  Deleting only makes sense for an inactive route - an active one has
  to be deactivated first, mirroring how the district would actually
  want to retire something that's currently running.

  Adding a route is deliberately two steps: `EditRouteScreen.tsx` in
  `mode: "add"` only offers the metadata form, the stops paste box
  (`parseRouteImport.ts`'s graceful column matching still applies - the
  app's full schema, a properly-headered sheet missing optional
  columns, or a header-less plain list of stops or stops-and-turns all
  work), and a "Create Route" button - no validation, no per-row
  review, no activate control, since there's nothing to review yet for
  a route that isn't a saved entity. Saving creates it `status:
  "inactive"` and hands control straight to `mode: "edit"` for the same
  route, where the real review lives: an always-visible per-row list
  (resolved/unresolved/skipped, `routeResolutionStatus.ts`) against
  whatever's already geocoded, "Make Active" replaced by a ⚠️ warning
  until every geocodable stop resolves, and `Make Inactive` staying
  available on an already-active route regardless of readiness (that
  direction never needs the check).

  **"Fetch Location" and "Fetch All Locations" now make real calls.**
  A new route handler, `src/app/api/geocode/route.ts`, resolves a
  query (or a batch of them) exactly the way `scripts/geocodeRoute.ts`
  does - ORS for an address, Overpass for an intersection, anchored on
  the school's own geocoded point - server-side, so `ORS_API_KEY` never
  reaches the browser. Both the script and the route handler now share
  the actual "resolve one query" logic (`src/lib/resolveWaypoint.ts`),
  split out specifically so a bug in it (like the duplicate-anchor-query
  403 from "Maps, part ten" above) can only exist once. "Fetch
  Location" (one row) and "Fetch All Locations" (every row not already
  resolved) both call this endpoint; the school's own anchor point,
  once known, is cached client-side for the rest of the edit session so
  repeated single-row fetches don't re-geocode the school address every
  time. Needs `ORS_API_KEY` set as a real environment variable
  wherever the app itself runs (Vercel's project settings, not just the
  GitHub Actions secret `geocode-route.yml` uses) - Next.js reads
  `.env.local` for this automatically, no loader needed the way the
  standalone script has its own.

  The list's own "Activate" click (and the edit screen's own control)
  both run the same readiness check (`src/lib/routeReadiness.ts`)
  against a route's own committed sidecar cache merged with whatever
  this session has fetched-but-not-yet-committed for it - an
  inactive route that isn't actually ready skips the confirm modal
  entirely and opens the edit screen instead, where the real warning
  and the Fetch buttons that can actually fix it already live.

  Explicitly still not the full spec: no Excel-file import (CSV/TSV/
  plain-text paste only), no manual per-row step editor (an "Add Step"
  button, a stop/turn dropdown per row) for building or fixing a route
  without touching the paste box, and no retry/manual-coordinate-entry
  or map-picker for a single unresolved row.

  **Still session-only, not real persistence** - `onSave` hands the
  built Route (and this session's own fetched waypoint cache) to an
  in-memory admin-route store in page.tsx, the same "real workflow, no
  persistence yet" honesty this app already applies to rider check-in
  state (see useRiderRoster.ts): a page reload loses every admin edit,
  every fetched coordinate, and every delete. "Make Active" doesn't
  write back to `route-master-list.csv` or commit a real steps CSV
  anywhere, and a freshly-fetched coordinate here doesn't reach
  RouteMap.tsx either (it still only reads the real, committed sidecar
  file) - this is for review, not yet what actually puts a pin on the
  map. Writing admin edits back to real committed files (or a real
  datastore) instead of session state is its own follow-up - worth
  deciding deliberately (a GitHub-committing API route? a real
  database?) rather than defaulting into whichever's easiest to bolt on
- Surfacing API usage/quota in the Add/Edit Route UI would be nice, but
  it's not actually clear yet what OpenRouteService's or Overpass's
  real gating criteria are (a request quota? a rate limit? both?) -
  worth understanding before promising a usage meter that might not
  mean what it looks like it means. OpenRouteService's free tier does
  have *some* quota, confirmed the hard way - see "Maps, part ten"
  above
- For whatever's left unresolved after a validate pass: a per-row
  "Retry" button, and a manual fallback - a single paste-able "lat, lon"
  text field standing in for the two separate coordinate columns on
  that row, so a real coordinate found some other way doesn't need
  typing into two boxes. Longer term, a small map under an unresolved
  row, centered on the last successfully-resolved point, to drag/tap a
  pin into place instead of typing coordinates blind - and eventually
  showing the already-resolved pins/turns for reference on that same
  map, maybe even drawing the route so far, so placing the next one is
  a visual "where does this fit" instead of guessing from street names
  alone
