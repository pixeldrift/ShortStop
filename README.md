# ShortStop

ShortStop is a Progressive Web App for school bus routing. Drivers get
spoken, turn-by-turn navigation through a route's stops and turns,
hands-free; district admins manage routes, stops, and schools from the
same app.

## What it does

**For drivers:** pick a route from the list and tap Start. Each step
speaks its own instruction aloud (turn direction and street names, or a
stop's cross streets and expected rider count), with a live map showing
the bus's position and the road-following route ahead. Advance with an
on-screen button, a tap, or a Bluetooth media remote. At a stop with
expected riders, a check-in roster overlays the map so the driver can
mark who's boarded without losing their place.

**For admins:** toggle **Edit Mode** on the route list to add or edit
routes, reorder and edit individual stops/turns, resolve stop locations
to real coordinates, and publish, unpublish, or delete routes. A route
can only be published once every stop has resolved.

## Stack

- [Next.js](https://nextjs.org) 16 (App Router), React 19, TypeScript
- Tailwind CSS 4
- Prisma 7 + Postgres — routes, schools, stops, and the geocoding cache
  all live here
- [MapLibre GL JS](https://maplibre.org) rendering a self-hosted
  [PMTiles](https://protomaps.com) vector basemap when one's deployed
  (`src/lib/mapEngine.ts`), falling back automatically to Leaflet +
  CARTO raster tiles otherwise; [OpenRouteService](https://openrouteservice.org)
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
- `NEXT_PUBLIC_CARTO_API_KEY` — free at [carto.com](https://carto.com/).

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

Push to GitHub, then in Vercel: **Add New Project** → import this repo.
No build settings to change — Vercel auto-detects Next.js.

Set `DATABASE_URL`, `ORS_API_KEY`, and `NEXT_PUBLIC_CARTO_API_KEY` in
Vercel (Project Settings → Environment Variables, Production and
Preview both). `next build` runs `prisma migrate deploy` first, so
schema changes apply automatically on every deploy once `DATABASE_URL`
is set — but a brand-new database still needs seeding once, via the
**Postgres migrate + seed** GitHub Actions workflow (manually
triggered; needs a `DATABASE_URL` repository secret matching the
Vercel value).

## Roadmap

- Real authentication for Edit Mode — it's a client-side toggle today,
  with no login and nothing preventing a driver from reaching it.
- Real PWA icons (`public/manifest.json` currently has none) and an
  install prompt, so the app can live on a dashboard tablet's home
  screen.
- Rider check-in state resets on page reload (it's in-memory only, not
  persisted).
- GPS-based auto-advance as stops are reached, rather than only manual
  button/remote advance.
- `driverName`, `distance`, and `durationMinutes` are still placeholder
  values on every route (`src/lib/placeholderMeta.ts`) until real
  driver/routing data exists.
- Printable, per-route sheets for handing to a substitute driver — the
  admin "Download stops" link is a flat CSV export today.
- No `public/maps/middle-tennessee.pmtiles` file is committed yet, so
  every map still renders on the Leaflet fallback in production. See
  `src/lib/mapEngine.ts`'s doc comment for the exact steps to generate
  and place one (a Protomaps extract for the service area) and switch
  both maps over to MapLibre automatically.
- Draggable map/content split on the turn-by-turn navigation screen
  (`StepScreen.tsx`) — currently a fixed 30vh/70vh (portrait) or
  42%/58% (landscape) split, with the content pane's own text/icon/
  button sizing tuned to that split via `clamp()` (vh-based). Making
  the divider draggable needs the content pane to handle being
  squeezed past its current tuning - likely a minimum content height
  with `overflow-y-auto` once dragged past where the current sizing
  was designed for, not just naive shrinking - plus a stored split
  ratio and double-tap-to-reset back to the default.
- Full-screen map toggle — every map box (RouteMap.tsx, wherever it's
  embedded: StepScreen's own nav map, PlaceCoordinatesModal, the All
  Stops modal, StartScreen's overview) gets a small expand icon in its
  own top-right corner; tapping it grows that one map to fill the
  screen, and the icon becomes an X to shrink it back.
- Autoroute — auto-generates turn-by-turn directions (a real ORS
  routing call, not just geocoding) between any two stops, either
  inserted between one specific pair or run across a whole route to
  fill in every gap that doesn't have driving instructions yet. The
  result is editable afterward like any other waypoint, and saved as
  real route steps (RouteStep rows), not just an on-the-fly overlay -
  so it's still there offline, same as hand-typed directions. A
  compass icon sits between stops the same way the scissors icon
  (split) already does, mirrored to the left instead of the right.
  Both the scissors and the compass become plain blue links at that
  point, not the button-styled controls they are today.
- Bus-specific auto-instructions — automatically inserts instructions
  a generic map app has no reason to know about (stopping before a
  railroad crossing is the concrete example), the kind of thing a new
  driver forgets and an experienced one does by habit. Likely needs
  its own geodata source (e.g. an Overpass query for
  `railway=level_crossing` along the route's own line, the same kind
  of lookup `overpassGeocode.ts` already does for intersections) to
  find where these apply, then auto-inserts a real "Stop" step at that
  point the same way any other route step works.
