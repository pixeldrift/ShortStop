import SwiftUI

/// Steps a driver through a route's navigation instructions one at a time.
/// Advances on: a tap anywhere on screen, the on-screen Next/Back buttons,
/// or a paired Bluetooth media remote (prev/play-pause/next), which is the
/// primary input this app targets — see RemoteControlManager. A hardware
/// keyboard's arrow keys also work, as a fallback for devices that turn out
/// to pair as a keyboard instead of a media remote.
struct ContentView: View {
    @State private var viewModel = RouteViewModel(route: .loadSample())
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 16) {
            Text("\(viewModel.stepNumber) of \(viewModel.totalSteps)")
                .font(.headline)
                .foregroundStyle(.secondary)

            Spacer()

            VStack(spacing: 12) {
                Text(headingText)
                    .font(.system(size: 40, weight: .heavy))
                    .multilineTextAlignment(.center)

                if let subheading = viewModel.currentStep.subheading {
                    Text(subheading)
                        .font(.title2)
                        .multilineTextAlignment(.center)
                }

                if let distance = viewModel.currentStep.distance {
                    Text(distance)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                if let count = viewModel.currentStep.studentCount {
                    HStack(spacing: 6) {
                        Image(systemName: "person.2.fill")
                        Text("\(count) Student\(count == 1 ? "" : "s")")
                        if let pickupOrDropoff = viewModel.currentStep.pickupOrDropoff {
                            Text("· \(pickupOrDropoff)")
                        }
                    }
                    .font(.title3)
                }

                if let side = viewModel.currentStep.sideOfRoad {
                    Text("Stop on \(side) side")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if let special = viewModel.currentStep.specialInstruction {
                    Text(special)
                        .font(.subheadline)
                        .padding(10)
                        .background(.yellow.opacity(0.2))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.horizontal)

            Spacer()

            HStack(spacing: 20) {
                Button(action: viewModel.goBack) {
                    Label("Back", systemImage: "chevron.left")
                        .font(.title2)
                        .frame(maxWidth: .infinity)
                        .padding()
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.isFirstStep)

                Button(action: viewModel.advance) {
                    Label("Next", systemImage: "chevron.right")
                        .font(.title2)
                        .frame(maxWidth: .infinity)
                        .padding()
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isLastStep)
            }
            .padding(.horizontal)
            .padding(.bottom)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { viewModel.advance() }
        .focusable()
        .focused($isFocused)
        .onAppear { isFocused = true }
        .onKeyPress(keys: [.space, .rightArrow, .downArrow, .return]) { _ in
            viewModel.advance()
            return .handled
        }
        .onKeyPress(keys: [.leftArrow, .upArrow, .delete]) { _ in
            viewModel.goBack()
            return .handled
        }
    }

    private var headingText: String {
        if viewModel.currentStep.kind == .stop, let stopNumber = viewModel.currentStopNumber {
            return "STOP \(stopNumber) OF \(viewModel.totalStops)"
        }
        return viewModel.currentStep.heading ?? ""
    }
}

#Preview {
    ContentView()
}
