import { IconTooltip } from "./IconTooltip";
import { Logo } from "./Logo";
import { SchoolLevelIcon } from "./SchoolLevelIcon";
import { TripTypeIcon } from "./TripTypeIcon";
import { BackArrowIcon, PersonSolidIcon, WarningIcon } from "./icons";
import { schoolLevelLabel } from "@/lib/schoolLevel";
import { tripTypeFullLabel } from "@/lib/tripType";
import type { SchoolLevel, TripType } from "@/lib/types";

export function TopBar({
  routeNumber,
  busNumber,
  tripType,
  schoolLevel,
  onLogoClick,
  stopProgressNumber,
  totalStops,
  totalOnboard,
}: {
  routeNumber: string;
  busNumber: string;
  tripType: TripType;
  schoolLevel: SchoolLevel | null;
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
          {/* mt-0.5 (not the -mt-1 this used to be) - leading-[0.7083]
              trims the number's own line box down to its ink height,
              and pulling it up further on top of that was crowding it
              right up against "ROUTE" above; a small positive gap
              instead of a negative one keeps them legibly apart.
              A flex row, not the old relative/absolute overlay - that
              floated the AM/PM icon off the number's own left edge
              (right-full) so it'd never shift the number off-center
              from "ROUTE" above, but on this bar's own narrow columns
              (unlike StartScreen/RouteListScreen's full-width title,
              which use this same icon-number-icon flex row) that
              overflow bled the icon into column 1, on top of the logo.
              An inline row instead reserves real layout space for both
              icons, so neither can overlap a neighboring column - and
              with a school-level icon now added on the other side too
              (matching every other screen that shows both, see
              StartScreen.tsx), the two roughly-equal-width icons keep
              the number visually close to centered under "ROUTE"
              regardless. Pickup/dropoff is the icon alone, no separate
              "AM"/"PM" text beside it (TripTypeIcon.tsx's own doc says
              why). Every other TripType (fieldtrip/other) skips the
              AM/PM badge entirely - those routes may not even have a
              morning/afternoon distinction to badge, and there's no
              real example of one yet to design that case against. */}
          <p className="font-heading mt-0.5 flex items-center justify-center gap-1 text-3xl leading-[0.7083] font-black tracking-tight">
            {(tripType === "pickup" || tripType === "dropoff") && (
              <IconTooltip
                label={tripTypeFullLabel(tripType)}
                className="h-[21px] w-[21px] shrink-0 text-blue-600"
              >
                <TripTypeIcon tripType={tripType} className="h-full w-full" />
              </IconTooltip>
            )}
            {routeNumber}
            {schoolLevel ? (
              <IconTooltip
                label={schoolLevelLabel(schoolLevel)}
                className="h-[21px] w-[21px] shrink-0 text-blue-600"
              >
                <SchoolLevelIcon level={schoolLevel} className="h-full w-full" />
              </IconTooltip>
            ) : (
              <SchoolLevelIcon
                level={schoolLevel}
                className="h-[21px] w-[21px] shrink-0 text-blue-600"
              />
            )}
          </p>
        </div>

        <div className="col-start-3 justify-self-end text-right">
          <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
            Bus
          </p>
          {/* A warning triangle ahead of the number, not a red box
              around it - a box reads as "this value is wrong/invalid,"
              but an alternate bus is a legitimate, expected state (see
              isAlternateBus's own doc comment), just one worth flagging
              so a driver doesn't miss it. */}
          <p className="font-heading -mt-1 flex items-center justify-end gap-1 text-xl leading-none font-bold tracking-tight">
            {isAlternateBus && (
              <WarningIcon className="h-4 w-4 shrink-0 text-amber-600" />
            )}
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
