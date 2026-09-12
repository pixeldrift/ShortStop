import { Logo } from "./Logo";
import { TripTypeIcon } from "./TripTypeIcon";
import { BackArrowIcon, PersonSolidIcon } from "./icons";
import type { TripType } from "@/lib/types";

export function TopBar({
  routeNumber,
  busNumber,
  tripType,
  onLogoClick,
  stopProgressNumber,
  totalStops,
  totalOnboard,
}: {
  routeNumber: string;
  busNumber: string;
  tripType: TripType;
  onLogoClick: () => void;
  stopProgressNumber: number;
  totalStops: number;
  totalOnboard: number;
}) {
  // A substitute/alternator bus running this route under its own bus
  // number rather than the route's usual one - worth calling out since
  // a driver expecting to find "their" bus number on the lot would
  // otherwise miss it entirely.
  const isAlternateBus = busNumber !== routeNumber;

  return (
    <div>
      {/* Row 1 - items-start so every column lines up flush against
          its own top, same reasoning as always: the middle column is
          the tallest (Route/#/AM-PM is two stacked lines, versus one
          in the outer columns), and centering against that extra
          height would push the logo/Bus figure down out of line. */}
      <div className="grid w-full grid-cols-3 items-start">
        <div className="justify-self-start">
          <button
            type="button"
            onClick={onLogoClick}
            aria-label="Back to routes"
          >
            <Logo size="small" />
          </button>
        </div>

        <div className="col-start-2 justify-self-center text-center">
          <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
            Route
          </p>
          {/* relative/absolute rather than a flex row - the AM/PM icon
              floats off the route number's own right edge (left-full)
              so it never shifts the number itself off-center from the
              "ROUTE" label above. am.svg/pm.svg carry their own label
              lettering, so pickup/dropoff is the icon alone -
              vertically centered against the number's full height and
              sized to nearly match it. Every other TripType
              (fieldtrip/other) skips the badge entirely - those routes
              may not even have a morning/afternoon distinction to
              badge, and there's no real example of one yet to design
              that case against. */}
          <p className="font-heading relative -mt-1 text-3xl leading-[0.7083] font-black tracking-tight">
            {routeNumber}
            {(tripType === "pickup" || tripType === "dropoff") && (
              <TripTypeIcon
                tripType={tripType}
                className="absolute top-1/2 left-full ml-1.5 h-7 w-7 -translate-y-1/2 text-zinc-400"
              />
            )}
          </p>
        </div>

        <div className="col-start-3 justify-self-end text-right">
          <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
            Bus
          </p>
          <p
            className={`font-heading -mt-1 text-xl leading-none font-bold tracking-tight ${
              isAlternateBus
                ? "rounded-md border border-red-500 px-1 py-0.5"
                : ""
            }`}
          >
            {busNumber}
          </p>
        </div>
      </div>

      {/* Row 2 - its own grid rather than a second stacked line inside
          each column above: items-baseline here shares one real text
          baseline across all three cells (whichever of the three sits
          lowest), which the row-1 divs' own independent stacking can't
          give for free - "Back to Routes" carries an icon the other
          two don't, so only true baseline alignment (not just "same
          top" or "same bottom box edge") keeps its text sitting level
          with them. */}
      <div className="mt-0.5 grid w-full grid-cols-3 items-baseline">
        <p className="justify-self-start font-heading text-sm font-black tracking-wide text-zinc-600">
          Stop {stopProgressNumber} of {totalStops}
        </p>
        <button
          type="button"
          onClick={onLogoClick}
          className="col-start-2 flex items-center justify-self-center gap-1 text-sm font-bold text-blue-600"
        >
          <BackArrowIcon className="h-3 w-3" />
          Back to Routes
        </button>
        <div className="col-start-3 flex items-center justify-self-end gap-1 text-sm font-bold text-zinc-700">
          <PersonSolidIcon className="h-4 w-4" />
          {/* Same running tally either way (useRiderRoster.ts's own
              totalOnboard - a sum of check-ins across every stop so
              far, never decremented) - only the word changes. For a
              dropoff route every rider already boarded back at the
              school, so what's actually being counted stop by stop is
              how many have now gotten *off*, not how many are freshly
              "onboard." */}
          {totalOnboard} {tripType === "dropoff" ? "dropped off" : "onboard"}
        </div>
      </div>
    </div>
  );
}
