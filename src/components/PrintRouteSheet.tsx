import { tripTypeFullLabel } from "@/lib/tripType";
import type { Route } from "@/lib/types";

/**
 * A plain, black-on-white paper backup of this route's own turn-by-
 * turn steps, for handing to a substitute driver who can't use this
 * app - the exact kind of paper sheet this app otherwise exists to
 * make unnecessary (see EditRouteScreen's own Print button, right
 * next to Download Waypoints). Always mounted whenever a route is open
 * for editing, invisible during normal use (`hidden print:block`
 * below) and shown only inside the browser's own print preview/output
 * - see globals.css's own `.print-sheet` rule for how the rest of the
 * app's UI gets hidden alongside it without every other component
 * needing to know printing exists.
 *
 * Deliberately reuses each step's own already-computed heading/
 * subheading/distance fields (NavigationStep, types.ts) rather than
 * re-deriving anything from the raw route data - those are already
 * exactly the driver-facing wording StepScreen speaks/displays live,
 * so a substitute reads the same instructions a normal run would give
 * out loud, just on paper instead.
 */
export function PrintRouteSheet({ route }: { route: Route }) {
  return (
    <div className="print-sheet hidden bg-white p-8 text-black print:block">
      <h1 className="text-2xl font-bold">
        Route {route.routeNumber}
        {route.busNumber && ` — Bus ${route.busNumber}`}
      </h1>
      <p className="mt-1 text-base">
        {route.schoolName} · {tripTypeFullLabel(route.tripType)}
        {route.departureTime && ` · ${route.departureTime}`}
      </p>
      {/* Blank lines an admin fills in by hand - this sheet is printed
          once per route, not once per trip, so the actual driver/date
          for any given run isn't known ahead of time. */}
      <p className="mt-4 text-sm">
        Driver: _______________________________ Date: _______________
      </p>

      <ol className="mt-6 flex flex-col gap-3">
        {route.steps.map((step, index) => (
          <li key={step.id} className="border-b border-black/30 pb-2 break-inside-avoid">
            <div className="flex items-baseline gap-2">
              <span className="font-bold">{index + 1}.</span>
              <span className="font-semibold">{step.heading}</span>
              {step.distance && <span className="text-sm">({step.distance})</span>}
            </div>
            {step.subheading && <p className="ml-5 text-sm">{step.subheading}</p>}
            <p className="ml-5 text-sm">
              {[
                step.pickupOrDropoff,
                step.sideOfRoad && `${step.sideOfRoad} side`,
                step.studentCount != null && `${step.studentCount} rider${step.studentCount === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {step.specialInstruction && (
              <p className="ml-5 text-sm italic">{step.specialInstruction}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
