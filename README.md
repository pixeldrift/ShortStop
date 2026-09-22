# ShortStop

ShortStop is a Progressive Web App for school bus routing. Drivers get
spoken, turn-by-turn navigation through a route's stops and turns,
hands-free. District admins manage routes, stops, and schools from the
same app.

## What it does

**For drivers:** Pick a route from the list and tap Start. Each step
speaks its own instruction aloud (turn direction and street names, or a
stop's cross streets and expected rider count), with a live map showing
the bus's position and the route ahead. Advance with anon-screen button,
a Bluetooth media remote, or automatically based on your GPS location. For
stops with expected riders, a check-in roster overlays the map so the driver
can mark who's boarded without losing their place.

**For admins:** Toggle **Edit Mode** on the route list to add or edit
routes, reorder and edit individual stops/turns, resolve stop locations
to real coordinates, and publish, unpublish, or delete routes.

## Stack

- [Next.js](https://nextjs.org) 16 (App Router), React 19, TypeScript
- Tailwind CSS 4
- Prisma 7 + Postgres — routes, schools, stops, and the geocoding cache
  all live here
- [MapLibre GL JS](https://maplibre.org) rendering a self-hosted
  [PMTiles](https://protomaps.com) vector basemap (`src/lib/mapEngine.ts`) —
  requires WebGL, no raster-tile fallback (see that file's own doc
  comment for why); [OpenRouteService](https://openrouteservice.org)
  for geocoding and the road-following route line

## Running locally

```sh
npm install
cp .env.local.example .env.local
```

Fill in `.env.local` (see that file for where each value is used):

- `DATABASE_URL` — a Postgres connection string. A local Postgres works
  fine for dev (e.g. `postgresql://postgres:postgres@localhost:5432/shortstop`);
  a free hosted one works too (Neon, Vercel Postgres, Supabase, ...).
- `ORS_API_KEY` — free at [openrouteservice.org](https://openrouteservice.org/dev/#/signup).

Then:

```sh
npx prisma migrate dev
npx prisma db seed
npm run dev
```

`prisma db seed` loads the sample data under `public/data/` into
Postgres — safe to re-run any time. Open http://localhost:3000, and
toggle **Edit Mode** at the bottom of the route list to reach the admin
screens (there's no login yet — see Roadmap).

## Route data

Routes, schools, stops, and the geocoding cache all live in Postgres —
the running app never reads a CSV directly. `public/data/` holds a set
of sample routes and a school roster, used only to seed a local or
freshly-created database (`npx prisma db seed`).

A route's stops can also be built by pasting or uploading a CSV/TSV
directly into the admin **Add/Edit Route** screen — column headers are
matched loosely (case, spacing, common synonyms), and a header-less
paste is read as a plain ordered list of stops. The recognized columns
are `action`, `location`, `from_location`, `rider_count`, `side`, and
`notes` — only `action` and `location` are ever required; `location`
is this row's own real position (a turn's destination road, or a
stop's own road/intersection/address), and `from_location` is an
optional "coming from" road, inferred from context when left blank
(see the **Details** link next to Upload File in that screen, or
`src/lib/parseRouteImport.ts` for the exact rules).

Once a route has stops, the **Fetch Coordinates** button resolves them
to real coordinates (addresses via OpenRouteService, intersections via
the Overpass API), caching every result so the same location is never
looked up twice.

## Deploying

The project is pushed to GitHub, then deoloyed through Vercel.

Set `DATABASE_URL` and `ORS_API_KEY` in Vercel (Project Settings →
Environment Variables, Production and Preview both). `next build` runs `prisma migrate deploy` first, so
schema changes apply automatically on every deploy once `DATABASE_URL`
is set — but a brand-new database still needs seeding once, via the
**Postgres migrate + seed** GitHub Actions workflow (manually
triggered; needs a `DATABASE_URL` repository secret matching the
Vercel value).

## Roadmap

- Real authentication for Edit Mode — it's a client-side toggle today,
  with no login and nothing preventing a driver from reaching it.
- A custom "Add to Home Screen" install prompt (`beforeinstallprompt`)
  for a dashboard tablet - `public/manifest.json` now has real icons
  (generated from `src/app/favicon.ico`'s own mark - see
  `public/icons/`) and an `apple-touch-icon` for iOS, so installing
  already works via the browser's own menu; this would just make that
  discoverable without a driver needing to know it's there.
- Rider check-in state resets on page reload (it's in-memory only, not
  persisted).
- GPS-based auto-advance as stops are reached, rather than only manual
  button/remote advance.
- `driverName`, `distance`, and `durationMinutes` are still placeholder
  values on every route (`src/lib/placeholderMeta.ts`) until real
  driver/routing data exists.
- Printable, per-route sheets for handing to a substitute driver — the
  admin "Download stops" link is a flat CSV export today.
- Draggable map/content split on the turn-by-turn navigation screen
  (`StepScreen.tsx`) — currently a fixed 30vh/70vh (portrait) or
  42%/58% (landscape) split, with the content pane's own text/icon/
  button sizing tuned to that split via `clamp()` (vh-based). Making
  the divider draggable needs the content pane to handle being
  squeezed past its current tuning - likely a minimum content height
  with `overflow-y-auto` once dragged past where the current sizing
  was designed for, not just naive shrinking - plus a stored split
  ratio and double-tap-to-reset back to the default.
- Full-screen map toggle — done for StepScreen's own nav map and
  StartScreen's overview map (`ExpandableMap.tsx`, a small expand icon
  in the map's own top-right corner that opens a second, full-screen
  instance of the same map with an X to close it). Still needs the same
  treatment on PlaceCoordinatesModal's map and the All Stops modal's.
- Autoroute — the compass icon between two stops (mirroring the
  scissors/split icon on the same dashed line) now works for that one
  specific gap: it calls /api/route-geometry for just those two stops
  with ORS's own `steps` (turn-by-turn maneuvers, not just the line
  geometry RouteMap.tsx's map draws from), drops ORS's own boundary
  Depart/Arrive steps, and splices the real turns in between into
  `rows` as their own new rows - each one's coordinate written directly
  into the waypoint cache from ORS's own answer (no separate geocode
  round-trip), editable afterward like any hand-typed waypoint, and
  only actually saved as real route steps (RouteStep rows) once the
  admin hits this screen's own Save, same as everything else here.
  Still needed: a whole-route version that runs across every gap that
  doesn't have driving instructions yet in one pass, rather than one
  compass tap per gap.
- Desktop admin: live-edit-while-previewing navigation — a view where
  an admin can be in edit mode for a route's turn-by-turn instructions
  while simultaneously seeing them rendered the way a driver would see
  them on StepScreen, both from the same screen, so a change's effect
  is visible immediately rather than needing a separate preview step.
- Bus-specific auto-instructions — automatically inserts instructions
  a generic map app has no reason to know about (stopping before a
  railroad crossing is the concrete example), the kind of thing a new
  driver forgets and an experienced one does by habit. Likely needs
  its own geodata source (e.g. an Overpass query for
  `railway=level_crossing` along the route's own line, the same kind
  of lookup `overpassGeocode.ts` already does for intersections) to
  find where these apply, then auto-inserts a real "Stop" step at that
  point the same way any other route step works.
- Live, position-based helper info between waypoints — "Next stop in
  300ft," "Next turn in 2 blocks," "Railroad crossing ahead in 500ft" -
  computed on the fly from the bus's actual live GPS position against
  the route's own road geometry, not authored into the waypoints
  themselves the way the bus-specific auto-instructions item above is
  (those become real, permanent route steps; this would be a runtime-
  only overlay on StepScreen that says nothing at all until a driver's
  live position puts it within range). Distinct enough from every other
  roadmap item here - a genuinely different mechanism (continuous GPS
  tracking against the road-geometry line RouteMap.tsx already fetches,
  proximity thresholds, its own announcement/display timing so it
  doesn't collide with a stop's own check-in announcement) - that it
  needs its own planning pass before starting, not just picking it up
  alongside everything else above.
- Bulk waypoint upload/update for existing routes — extend the CSV
  upload mechanism the initial route import already uses (see Route
  data above) so it also works against a route that already has
  waypoints, rather than only for creating a brand-new one: bulk-add
  new steps to an existing route via the same upload, and bulk-update
  an existing route's waypoints via the same mechanism. The download
  side of this would need an id column added to the exported waypoint
  CSV (`Download Waypoints` today has no id column) so an admin can
  edit that file and re-upload it; on upload, rows whose id matches an
  existing waypoint would update that waypoint's data, and rows with
  new (or blank) ids would be inserted as new waypoints. Open design
  question from this idea, not yet answered: "Should blank cells be
  cleared, or left alone?"
