import Foundation
import Observation

@Observable
final class RouteViewModel {
    let route: Route
    private(set) var currentIndex = 0

    init(route: Route) {
        self.route = route
    }

    var currentStep: NavigationStep { route.steps[currentIndex] }
    var stepNumber: Int { currentIndex + 1 }
    var totalSteps: Int { route.steps.count }
    var isFirstStep: Bool { currentIndex == 0 }
    var isLastStep: Bool { currentIndex == route.steps.count - 1 }

    func advance() {
        guard !isLastStep else { return }
        currentIndex += 1
    }

    func goBack() {
        guard !isFirstStep else { return }
        currentIndex -= 1
    }
}
