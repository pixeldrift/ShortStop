import { Logo } from "./Logo";
import { BackArrowIcon, PersonSolidIcon } from "./icons";

export function TopBar({
  routeNumber,
  busNumber,
  onLogoClick,
  stopProgressNumber,
  totalStops,
  totalOnboard,
}: {
  routeNumber: string;
  busNumber: string;
  onLogoClick: () => void;
  stopProgressNumber: number;
  totalStops: number;
  totalOnboard: number;
}) {
  return (
    // items-start (not items-center) so every column lines up flush
    // against the row's own top - the middle column is the tallest
    // (Route/#/Back to Routes is three lines stacked, versus two in
    // the outer columns), and centering against that extra height was
    // what pushed the logo and Bus figure down out of line with it.
    <div className="grid w-full grid-cols-3 items-start">
      <div className="justify-self-start">
        <button type="button" onClick={onLogoClick} aria-label="Back to routes">
          <Logo size="small" />
        </button>
        {/* Directly under the logo, in the same column, rather than a
            separate full-width row below the whole bar - so it sits
            snug under the logo regardless of the middle column's own
            height. */}
        <p className="mt-0.5 font-heading text-sm font-black tracking-wide text-zinc-600">
          Stop {stopProgressNumber} of {totalStops}
        </p>
      </div>

      <div className="col-start-2 justify-self-center text-center">
        <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Route
        </p>
        <p className="font-heading -mt-1 text-3xl font-black tracking-tight">#{routeNumber}</p>
        {/* Same destination/confirmation as the logo (onLogoClick) - a
            second, labeled way to reach it for anyone who wouldn't
            think to tap the logo itself. */}
        <button
          type="button"
          onClick={onLogoClick}
          className="mt-0.5 flex w-full items-center justify-center gap-1 text-[10px] font-semibold text-zinc-500"
        >
          <BackArrowIcon className="h-2.5 w-2.5" />
          Back to Routes
        </button>
      </div>

      <div className="col-start-3 justify-self-end text-right">
        <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">Bus</p>
        <p className="font-heading -mt-1 text-xl font-bold tracking-tight">#{busNumber}</p>
        {/* Directly under the Bus figure, same column - see the Stop
            line's own note above. */}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-sm font-bold text-zinc-700">
          <PersonSolidIcon className="h-4 w-4" />
          {totalOnboard} onboard
        </div>
      </div>
    </div>
  );
}
