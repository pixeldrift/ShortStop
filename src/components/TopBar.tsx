import { Logo } from "./Logo";

export function TopBar({
  routeNumber,
  busNumber,
  onLogoClick,
}: {
  routeNumber: string;
  busNumber: string;
  onLogoClick: () => void;
}) {
  return (
    <div className="grid w-full grid-cols-3 items-center">
      <div className="justify-self-start">
        <button type="button" onClick={onLogoClick} aria-label="Back to routes">
          <Logo size="small" />
        </button>
      </div>

      <div className="col-start-2 justify-self-center text-center">
        <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Route
        </p>
        <p className="font-heading -mt-1 text-3xl font-black tracking-tight">#{routeNumber}</p>
      </div>

      <div className="col-start-3 justify-self-end text-right">
        <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">Bus</p>
        <p className="font-heading -mt-1 text-xl font-bold tracking-tight">#{busNumber}</p>
      </div>
    </div>
  );
}
