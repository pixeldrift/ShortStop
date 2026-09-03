export type StepKind = "depart" | "turn" | "stop" | "arrive";
export type TurnDirection = "left" | "right";

export interface NavigationStep {
  id: number;
  kind: StepKind;
  /** Which way to turn, for "turn" steps - drives the big arrow icon. */
  direction?: TurnDirection;
  /** Big on-screen line for depart/turn/arrive steps, e.g. "TURN RIGHT".
   * Ignored for "stop" steps, whose heading ("STOP 7 OF 23") is computed
   * from the route so it stays correct as steps are added or removed. */
  heading?: string;
  /** Street name (turn steps) or stop address (stop steps). */
  subheading?: string;
  /** Distance/timing line, e.g. "500 ft ahead" or "0.4 mi". */
  distance?: string;
  studentCount?: number;
  pickupOrDropoff?: string;
  sideOfRoad?: string;
  specialInstruction?: string;
  /** What the app speaks aloud when this step becomes current. */
  announcement: string;
}

export interface Route {
  name: string;
  routeNumber: string;
  driverName: string;
  busNumber: string;
  departureTime: string;
  /** Placeholder trip estimates - not derived from real map/routing data
   * yet, since none exists for this route. See RouteMeta in
   * parseRouteCsv.ts. */
  distance: string;
  durationMinutes: number;
  steps: NavigationStep[];
}
