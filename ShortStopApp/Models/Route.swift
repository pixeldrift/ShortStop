import Foundation

struct Route: Codable {
    let name: String
    let steps: [NavigationStep]

    /// Loads the bundled sample route. Swap this for a route fetched from
    /// the routing backend once one exists.
    static func loadSample() -> Route {
        guard
            let url = Bundle.main.url(forResource: "SampleRoute", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let route = try? JSONDecoder().decode(Route.self, from: data)
        else {
            return Route(
                name: "No Route Loaded",
                steps: [NavigationStep(id: 0, instruction: "SampleRoute.json is missing or invalid", detail: nil)]
            )
        }
        return route
    }
}
