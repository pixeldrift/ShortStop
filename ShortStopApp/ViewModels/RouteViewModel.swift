import Foundation
import Observation

@Observable
final class RouteViewModel {
    let route: Route
    private(set) var currentIndex = 0

    private let remoteControl = RemoteControlManager()
    private let announcer = Announcer()

    init(route: Route) {
        self.route = route
        remoteControl.onAdvance = { [weak self] in self?.advance() }
        remoteControl.onBack = { [weak self] in self?.goBack() }
        remoteControl.start()
        announceCurrentStep()
    }

    var currentStep: NavigationStep { route.steps[currentIndex] }
    var stepNumber: Int { currentIndex + 1 }
    var totalSteps: Int { route.steps.count }
    var isFirstStep: Bool { currentIndex == 0 }
    var isLastStep: Bool { currentIndex == route.steps.count - 1 }

    private var stopSteps: [NavigationStep] { route.steps.filter { $0.kind == .stop } }
    var totalStops: Int { stopSteps.count }

    /// 1-based position of the current step among stop-kind steps, or nil
    /// when the current step isn't a stop.
    var currentStopNumber: Int? {
        guard currentStep.kind == .stop else { return nil }
        return stopSteps.firstIndex(of: currentStep).map { $0 + 1 }
    }

    func advance() {
        guard !isLastStep else { return }
        currentIndex += 1
        announceCurrentStep()
    }

    func goBack() {
        guard !isFirstStep else { return }
        currentIndex -= 1
        announceCurrentStep()
    }

    private func announceCurrentStep() {
        announcer.speak(currentStep.announcement)
    }
}
