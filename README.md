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

Routes, schools, stops, and the geocoding cache all live in Postgres.
There is a collection of sample route and school details in `public/data/`
used only to seed a local or freshly-created database (`npx prisma db seed`).

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

An existing route's stops can be bulk-edited the same way: the
**Upload / Update** button next to Download Waypoints on the Edit
Waypoints screen re-imports a file built from that same download (it
adds a `row_number` column) and merges it into the route in memory —
a blank cell keeps that field's current value, the word `null` clears
it, a row with no (or unmatched) `row_number` is added as new, and a
row missing from the file is dropped. Nothing is saved to Postgres
until the screen's own Save..

Once a route has stops, the **Fetch Coordinates** button resolves them
to real coordinates (addresses via OpenRouteService, intersections via
the Overpass API), caching every result so the same location is never
looked up twice.

## Deploying

The project is pushed to GitHub, then deployed through Vercel.

Set `DATABASE_URL` and `ORS_API_KEY` in Vercel (Project Settings →
Environment Variables, Production and Preview both). `next build` runs `prisma migrate deploy` first, so
schema changes apply automatically on every deploy once `DATABASE_URL`
is set — but a brand-new database still needs seeding once, via the
**Postgres migrate + seed** GitHub Actions workflow (manually
triggered; needs a `DATABASE_URL` repository secret matching the
Vercel value).

## Roadmap

- Real user authentication for Edit Mode. Currently this is only a
  client-side toggle with no login. Anyone can edit.
- A custom "Add to Home Screen" install prompt (`beforeinstallprompt`)
  for a dashboard tablet - `public/manifest.json` has icons. See
  `public/icons/`) and an `apple-touch-icon` for iOS, so installing
  already works via the browser's own menu. This makes it discoverable
  without a user needing to know it's there.
- True ridership logging. The rider check-in is currently UI demo only.
  The data is only in local memory and does not save to the database.
- `driverName`, `distance`, and `durationMinutes` are still placeholder
  values on every route (`src/lib/placeholderMeta.ts`) until real
  driver/routing data exists.
- Improved printable, per-route sheets design with user options.
- Better responsive layout. Currently layout is refined for phones,
  but should also be optimized for tablets. 
- User options for data download, checkboxes for desired fields.
- Draggable divider between map view and directions on the turn-by-turn
  navigation screen. (`StepScreen.tsx`) is currently a fixed 30vh/70vh
  (portrait) or 42%/58% (landscape) split, with the content pane's own
  text/icon/button sizing tuned to that split via `clamp()` (vh-based).
  Making the divider draggable needs the content pane to handle being
  squeezed past its current tuning. This is likely a minimum content height
  with `overflow-y-auto` once dragged past where the current sizing
  was designed for, not just naive shrinking. Also requires a stored split
  ratio and a double tap on the divider to reset back to the default.
- Admin mode optimized for desktop for easier route and stop editing.
- Auto-detected railroad crossings. An admin can now mark one by hand
  (the "Railroad Crossing" waypoint type - StepRowEditor's own Type
  select) - it geocodes like any other waypoint, and turns into the
  real "Stop before railroad crossing" / "Continue through railroad
  crossing" pair of steps automatically (`buildRailroadCrossingSteps`,
  `parseRouteCsv.ts`). What's still missing is finding these
  automatically rather than an admin having to notice one on the
  route sheet: an Overpass query for `railway=level_crossing` along
  the route's own line (the same kind of lookup `overpassGeocode.ts`
  already does for intersections), crawled retroactively across every
  route to insert this waypoint type wherever a crossing turns up
  along an existing leg with no dedicated row of its own yet.
- Offline turn-by-turn fallback for a lost-signal driver, read-only (no
  editing offline). Not cookies - a service worker (this is already a
  PWA, `public/manifest.json`) caching the app shell, plus IndexedDB
  caching a route's own resolved data (its road geometry from
  `/api/route-geometry`, its waypoint cache entries) the moment a
  driver opens it, so `StepScreen` can fall back to that cached copy
  when a fresh fetch fails instead of just erroring. The self-hosted
  PMTiles basemap (`public/maps/middle-tennessee.pmtiles`,
  `mapEngine.ts`) and live GPS position (`navigator.geolocation`,
  already used as-is) need no extra work either way - both already
  work with no network once the tile file's been loaded once, the
  browser's own HTTP cache holds onto it.
- Retroactively crawl every existing route's own waypoint cache
  (`waypointCache.ts`) for double road crossings that predate the
  cardinal-disambiguation feature (`resolveStepCoordinate`,
  `cardinalLabel.ts`) and were instead hand-fixed with a manual
  coordinate override at the time (`overrideLat`/`overrideLon`,
  `RawRouteRow`) - Chyntara, Lou Gehrig, Cedar Park Circle, and the
  Holland Ridge Dr/Holland Road corner are the known examples. A script
  (in the shape of `scripts/geocodeSchools.ts` or similar) that finds
  every cache entry with more than one real candidate at the same
  waypoint key, cross-references it against routes that instead carry
  an override for that same step, and retrofits the newer keyed-variant
  scheme (`waypointCacheKey`) onto it - turning a one-off manual pin
  placement into the same self-documenting disambiguation every newly
  geocoded intersection already gets.
- A map control (a button opening a dropdown of layer toggles: schools,
  stops, start/end, directions) for hiding/showing each of `RouteMap`'s
  own pin categories independently, rather than the current all-or-
  nothing overview/driving mode split.
- Driver-focused fleet tooling beyond routing - mileage tracking,
  vehicle status logging, fuel expense logging. Needs real input from
  how drivers currently track this before designing anything (a
  QuickBooks integration or a plain export into whatever their
  accounting software already reads might matter more than the UI
  itself) - not scoped yet, and deliberately not vehicle maintenance
  records, which is a much bigger, more safety-critical surface than
  this app is ready for.
- A separate "record a route while driving" tool - a big map that
  follows GPS as you drive, with a button to drop a stop at your
  current position (resolved to the nearest intersection/address, then
  draggable to correct), optional turn instructions/notes. Most of this
  app's real routes are long-established and rarely change, so this is
  more a value-add for the rare new-route case (and a good demo) than
  something any client has actually asked for - low priority relative
  to work with a clearer real payoff.
