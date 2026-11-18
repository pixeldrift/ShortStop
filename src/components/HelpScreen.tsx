"use client";

import type { ReactNode } from "react";
import { BackArrowIcon } from "./icons";
import { useSwipeBack } from "@/lib/useSwipeBack";

/**
 * In-app user guide, reached from the account menu's "Help & user guide"
 * row. Driver material comes first (what nearly everyone does every
 * day); route building and the tricky situations that go with it follow
 * under "Administrators", since editing is an advanced, admin-only task
 * once the routes are in. Screenshots come from
 * scripts/help-screenshots (regenerate with the steps in shots.mjs) and
 * carry numbered red callouts - each Figure's legend explains them.
 *
 * Owns its own scroll container: the app shell is a fixed-height,
 * non-scrolling column (see layout.tsx), so a long page has to scroll
 * inside itself.
 */

const SECTIONS: { id: string; label: string }[] = [
  { id: "drivers", label: "Driving a route" },
  { id: "riders", label: "Rider check-in" },
  { id: "account", label: "Your account menu" },
  { id: "admin", label: "Administrators: editing routes" },
  { id: "waypoints", label: "Building the waypoint list" },
  { id: "tricky", label: "Tricky situations" },
  { id: "checklist", label: "New route checklist" },
];

export default function HelpScreen({ onBack }: { onBack: () => void }) {
  const swipeRef = useSwipeBack<HTMLDivElement>(onBack);

  function jumpTo(id: string) {
    document
      .getElementById(`help-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div ref={swipeRef} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
        >
          <BackArrowIcon className="h-5 w-5" />
        </button>
        <h1 className="font-heading text-xl font-black tracking-tight">
          Help &amp; user guide
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-12">
        <article className="mx-auto flex w-full max-w-xl flex-col gap-4 text-[15px] leading-relaxed text-zinc-800">
          <p>
            ShortStop gives bus drivers hands-free, spoken turn-by-turn
            directions along your district&apos;s own routes. Red numbers on
            the pictures match the numbered lists beneath them.
          </p>

          <nav aria-label="Contents" className="rounded-xl bg-zinc-100 p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Jump to
            </p>
            <ul className="flex flex-col">
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(s.id)}
                    className="w-full py-1.5 text-left font-medium text-blue-600 active:text-blue-800"
                  >
                    {i === 3 && (
                      <span className="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                        For administrators
                      </span>
                    )}
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* ---------------------------- DRIVERS ---------------------------- */}
          <H2 id="drivers">Driving a route</H2>

          <H3>1. Pick your route</H3>
          <Figure
            src="route-list"
            alt="The route list with the search box, filters and a route highlighted"
            legend={[
              "Search by route number, school or time.",
              "Filter by trip type (AM / PM), school level or favorites, and switch between flat and grouped lists.",
              "Tap your route. The heart marks a favorite.",
            ]}
          />
          <Figure
            src="start-screen"
            alt="The route information page with the Start Route button highlighted"
            legend={[
              "Check the school, time, stops, riders and map, then tap Start Route. View Stops lists every stop first.",
            ]}
          />

          <H3>2. At the depot</H3>
          <Figure
            src="depot"
            alt="The depot screen before departure"
            legend={[
              "Shows “Ready to Depart” within five minutes of the scheduled start, otherwise “Depart at …”.",
              "Start announces the departure aloud, including whether you are on time, ahead or behind.",
              "Routes returns to the list.",
            ]}
          />

          <H3>3. While driving</H3>
          <Figure
            src="driving-turn"
            alt="The driving screen showing a left turn with the header, progress strip and footer buttons highlighted"
            legend={[
              "Route, bus, stop count and riders on/off.",
              "Progress strip: turns and stops ahead, with the bus on its way. Tap or drag it to jump.",
              "The current instruction, spoken aloud when it appears.",
              "Next moves to the following step.",
              "Back returns to the previous step. The pause button between them pauses navigation.",
            ]}
          />
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Early warnings.</b> You hear “In 500 feet, turn right onto Main
              Street,” then a short cue just before (“Turn right.” / “Stop
              ahead.”). Stops get a longer lead because a bus needs more room.
            </li>
            <li>
              <b>Automatic advance.</b> A turn clears when you pass it. A stop
              clears once you have actually stopped, held a few seconds, and
              pulled away. Next and Back, the progress strip and a Bluetooth
              media remote are manual fallbacks.
            </li>
            <li>
              <b>Skipped stop.</b> Drive through without stopping and you hear
              “You skipped the stop at …” before the trip moves on.
            </li>
            <li>
              <b>Off route.</b> After about eight seconds away, navigation
              pauses (“You are no longer on the route”) and resumes by itself
              when you are back.
            </li>
          </ul>

          <H3>4. Stops</H3>
          <Figure
            src="driving-stop"
            alt="A stop screen with the stop number, rider count and rider button highlighted"
            legend={[
              "The stop pin shows its number and how many riders to expect. You hear “Stop here at … Pick up 5 students on the right,” (PM routes say “Drop off”) followed by any driver notes.",
              "The blue person button on the map opens the rider check-in.",
            ]}
          />

          <H3>5. The map</H3>
          <Figure
            src="map-expanded"
            alt="The map expanded to full screen"
            numbered={false}
            legend={[
              "Use the expand button to view the map full screen. The compass re-centers on the bus.",
            ]}
          />

          <H2 id="riders">Rider check-in</H2>
          <Figure
            src="rider-box"
            alt="The rider check-in box over the map"
            legend={[
              "Tap each rider as they board or leave.",
              "Add Rider records someone who was not expected.",
              "Ok closes the box. It also closes itself when the bus pulls away, and stays hidden while moving.",
            ]}
          />
          <p>
            The arrows in the box header step to other stops, so you can fix a
            count you missed.
          </p>

          <H2 id="account">Your account menu</H2>
          <Figure
            src="account-menu"
            alt="The account menu with Log riders and Can edit highlighted"
            legend={[
              "Log riders: untick it to turn the check-in pop-up off for you. The spoken “Pick up N students” is unchanged.",
              "Can edit: unlocks the administrator tools below. Drivers can leave it off.",
            ]}
          />
          <p>
            Tap the person icon at the top right of any screen to open it. The
            speech-balloon icon opens Speech Lab to preview the voices on your
            device.
          </p>

          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <b>Voices:</b> abbreviations are spoken in full (“Dr” becomes
            “Drive”, “N” becomes “North”). If a place name is mispronounced, ask
            a developer to add it to <code>PHONETIC_OVERRIDES</code> in{" "}
            <code>src/lib/speech.ts</code>; it only changes how the name is
            spoken, never how it is displayed.
          </p>

          {/* --------------------------- ADMINISTRATORS --------------------------- */}
          <H2 id="admin">Administrators: editing routes</H2>
          <p>
            Turn on <b>Can edit</b> in the account menu, then tap{" "}
            <b>Edit Routes</b> under the route list. There is no sign-in yet, so
            this setting applies to the current browser only. Nothing you change
            is stored until you press the screen&apos;s own{" "}
            <b>Save</b>, and drivers only ever see <b>published</b> routes, so
            edit as a Draft.
          </p>

          <Figure
            src="edit-mode"
            alt="The route list in edit mode with publish, New Route and Download highlighted"
            legend={[
              "Show only published or only hidden routes.",
              "The eye is each route's state: open = published, struck through = draft. Tap a draft to Publish (or Delete); tap a published route to Unpublish. On a route-number or trip-type heading it applies to the whole group at once.",
              "New Route.",
              "Download the list as routes.csv.",
            ]}
          />
          <p>
            Publishing happens only from the list, never inside the editor. You
            may publish a route with unverified locations; the app warns you but
            does not stop you.
          </p>

          <H3>Route details</H3>
          <Figure
            src="edit-hub"
            alt="The route editor with fields, Reverse, Duplicate, Edit Waypoints and Save highlighted"
            legend={[
              "Route number, trip type (AM, PM, Special, Other), start time, school (required for AM/PM), bus and what happens when the route ends. The valid/unresolved tally sits below.",
              "Reverse Route builds the return trip as a new Draft (“Reverse-…”): order reversed, left/right and Depart/Arrive swapped, AM↔PM. Always review the result; it cannot know about one-way streets or turn restrictions.",
              "Duplicate Route saves a Draft copy (“Copy-…”).",
              "Edit Waypoints opens the stops and turns.",
              "Save is enabled once you change something.",
            ]}
          />
          <p>
            <b>New Route</b> asks for the same details plus an optional uploaded
            or pasted file of waypoints (route number, trip and school are
            filled in from the file name and its Depart/Arrive rows, but never
            over what you typed). The route is created as a Draft.
          </p>

          <H2 id="waypoints">Building the waypoint list</H2>
          <Figure
            src="waypoints"
            alt="The waypoint list with Fetch Coordinates, edit, reorder, add, split and autoroute controls highlighted"
            legend={[
              "Fetch Coordinates looks up map positions: Fetch Missing or Re-fetch All. Rows you placed by hand are skipped.",
              "Pencil: edit that row.",
              "Drag handle: press, hold and drop where it should go.",
              "Blue +: add a waypoint here.",
              "Scissors: split the route here into a new route.",
              "Compass: autoroute fills in real turn-by-turn directions between the stops on either side (both need coordinates).",
            ]}
          />
          <p>
            Along the bottom: <b>Print</b> (a driver sheet), <b>Download</b> and{" "}
            <b>Upload</b> (edit the route as a spreadsheet). The toolbar above
            the list has stops-only / stops-and-directions, show-errors-only and
            a Next button that jumps to the next unresolved row.
          </p>

          <Figure
            src="edit-waypoint"
            alt="The Edit Waypoint popup with fields highlighted"
            legend={[
              "Type: Depart, Stop, Stop Sign, Railroad Crossing, Turn Left/Right, Continue, U-Turn, Turn Around, Proceed, Pull Over, Return, Arrive. Stops also have Side and Riders (1–10).",
              "Location: a street address (starts with a house number), or two roads as an intersection (“Elm St & Oak Ave”). Suggestions come from roads the app has seen. “From” is usually blank; it is inferred from the previous waypoints.",
              "Fetch coordinates for this row.",
              "Place the pin by hand on a map.",
              "Driver Notes are spoken after the instruction and shown on screen.",
              "Save commits to the list on screen; the screen's own Save stores it.",
            ]}
          />
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Instructions only</b> (tick the box) speaks a waypoint without
              placing it on the map. GPS cannot detect it, so the driver may
              need to tap Next.
            </li>
            <li>
              Names with <i>ramp</i> or <i>roundabout</i> are never looked up.
              <i> Driveway</i> and <i>parking lot</i> resolve to the school.
            </li>
            <li>
              A waypoint is <b>verified</b> once it has coordinates. When a
              single-row fetch is unsure it opens <b>Confirm Match</b>: nothing
              is saved until you choose Accept.
            </li>
            <li>
              Fetching needs the route&apos;s School to be a real school or an
              address-book place with coordinates, and every waypoint a type and
              location.
            </li>
            <li>
              If you see “rate limit reached”, wait a minute and try again.
            </li>
          </ul>

          <H3>Editing as a spreadsheet</H3>
          <p>
            <b>Download</b> gives <code>&lt;route&gt;-stops.csv</code>. Edit it,
            then <b>Upload</b> and Apply:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>A row with a <code>row_number</code> updates that waypoint.</li>
            <li>A blank cell keeps the value; the word <code>null</code> clears it.</li>
            <li>A row with no <code>row_number</code> is added.</li>
            <li>An existing waypoint missing from the file is deleted.</li>
          </ul>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <b>Commas in notes:</b> the importer does not understand quotes. If a
            note contains a comma, save the file tab-separated (TSV) instead.
          </p>

          {/* ------------------------------ TRICKY ------------------------------ */}
          <H2 id="tricky">Tricky situations</H2>

          <H3>A road pair that shows up twice</H3>
          <p>
            The bus meets the same two roads at two places: a loop or circle with
            both ends on one road, a double-ended street that enters and leaves a
            neighborhood from the same cross street, or a route that turns around
            and comes back past the same intersection. Both waypoints read the
            same (“Cedar Park Cir &amp; Holland Ridge Dr”), but a lookup knows
            only the road names, so both can land on one spot and the driver is
            told to stop in the wrong place.
          </p>
          <p>
            <b>What the app does:</b> it keeps both points and labels them North
            / South or East / West. If the edit popup is open it appends a label
            such as “(North)” to Driver Notes (never replacing yours), so the
            driver hears it. When driving it picks the point closest to the
            previous stop, which usually puts the second crossing in the right
            place.
          </p>
          <p>
            <b>What you do:</b> never assume the second crossing landed
            correctly. Fetch, then open the <b>second</b> waypoint of the pair
            and check the small map. If it is wrong:
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Optionally add a direction such as “(South)” to Driver Notes.</li>
            <li>Tap the map-pin button to place the pin by hand.</li>
            <li>Drag the map so the fixed pin sits on the intersection you mean.</li>
            <li>Choose <b>Override Once</b>, then Save the popup and the screen.</li>
          </ol>
          <p className="text-sm text-zinc-600">
            A single-row fetch will not move the second crossing for you: it
            returns the known point nearest the school, the first crossing.
          </p>

          <Figure
            src="place-pin"
            alt="The Place Coordinates window with Override Once and Update Every Instance highlighted"
            legend={[
              "The pin is fixed in the middle; drag the map under it. The blue line is the route.",
              "Override Once changes only this waypoint on this route, taking effect when you save the route. Shows as “Overridden - Location manually placed” with a Clear link.",
              "Update Every Instance changes the shared location for that road pair on every route, immediately, even if you never save the route.",
            ]}
          />
          <p>
            <b>Rule of thumb:</b> use <b>Override Once</b> for a second
            crossing. Use <b>Update Every Instance</b> only when the lookup got
            the intersection wrong for every route through it and you are sure
            moving it everywhere is right. Typing latitude/longitude behaves like
            Update Every Instance. Fetching an overridden row asks{" "}
            <b>Replace Override?</b>; batch fetches skip it.
          </p>

          <H3>Loops, circles and cul-de-sacs</H3>
          <p>
            Roads that do not meet at a plain intersection cannot be found as a
            crossing. Confirm Match may offer the closest point on one road: an
            approximation, not a real crossing. Accept if close enough, or
            reject and place the pin by hand.
          </p>

          <H3>Mid-block stops</H3>
          <p>
            With no intersection to recognize, the spoken instruction and the pin
            are everything. Enter an <b>address</b> (starting with the house
            number), set <b>Side</b> and <b>Riders</b>, fetch, and check the pin
            is on the right side and block. Add details to Driver Notes (“gray
            house, mailbox on the left”). The accuracy of the pin sets how well
            the “In 700 feet…” warnings are timed.
          </p>

          <H3>A stop and a turn at the same corner</H3>
          <p>
            If a stop is within about 65 feet of the next waypoint, the app skips
            the distance countdown, says “After that, you will be turning left
            onto …” right after the stop, and moves straight to the turn when
            the rider box closes.
          </p>

          <H3>Publishing with unverified locations</H3>
          <p>
            Allowed, but the map and GPS auto-advance may behave poorly near
            those points. Use <b>Next</b> on the waypoint screen to jump through
            the unresolved ones first.
          </p>

          <H2 id="checklist">New route checklist</H2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Create the route as a Draft with the right trip and school.</li>
            <li>Add every waypoint, with Side and Riders on stops.</li>
            <li>Fetch Coordinates, then fix every red or unresolved row.</li>
            <li>For any road pair used twice, check the second crossing and place it by hand if needed.</li>
            <li>Turn off “stops only” and look over the whole line on the map.</li>
            <li>Drive it while still a Draft. The Edit and + buttons on the driving screen fix a waypoint on the spot.</li>
            <li>Publish from the route list.</li>
          </ol>
        </article>
      </div>
    </div>
  );
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={`help-${id}`}
      className="mt-6 scroll-mt-2 border-t border-zinc-200 pt-5 font-heading text-2xl font-black tracking-tight text-zinc-900"
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-2 font-heading text-lg font-extrabold text-zinc-900">
      {children}
    </h3>
  );
}

/** A screenshot with its numbered legend. Images are 2x captures of a
 * 390px-wide viewport, shown at their container width. */
function Figure({
  src,
  alt,
  legend,
  numbered = true,
}: {
  src: string;
  alt: string;
  legend: string[];
  /** False for a capture with no callouts drawn on it. */
  numbered?: boolean;
}) {
  return (
    <figure className="flex flex-col gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed
          static captures; no resizing pipeline needed */}
      <img
        src={`/help/${src}.png`}
        alt={alt}
        loading="lazy"
        className="mx-auto max-h-[70vh] w-auto max-w-full rounded-2xl border border-zinc-200 shadow-sm"
      />
      <figcaption>
        <ol className="flex flex-col gap-1.5">
          {legend.map((text, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {numbered && (
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
              )}
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
