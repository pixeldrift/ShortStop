import Foundation

enum StepKind: String, Codable, Equatable {
    case depart
    case turn
    case stop
    case arrive
}

struct NavigationStep: Identifiable, Codable, Equatable {
    let id: Int
    let kind: StepKind

    /// Big on-screen line for depart/turn/arrive steps, e.g. "TURN RIGHT".
    /// Ignored for .stop steps, whose heading ("STOP 7 OF 23") is computed
    /// from the route so it stays correct if steps are added or removed.
    let heading: String?

    /// Street name (turn steps) or stop address (stop steps).
    let subheading: String?

    /// Distance/timing line, e.g. "500 ft ahead" or "0.4 mi".
    let distance: String?

    let studentCount: Int?
    let pickupOrDropoff: String?
    let sideOfRoad: String?
    let specialInstruction: String?

    /// What the app speaks aloud when this step becomes current.
    let announcement: String
}
