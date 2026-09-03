import SwiftUI

/// Steps through a route's navigation instructions one at a time.
/// Advances on: a tap anywhere on screen, the on-screen Next/Back buttons,
/// or a keypress from a paired Bluetooth clicker/remote (most such remotes
/// pair as an external keyboard and send space/enter/arrow keys — remap
/// the key sets below if your specific hardware sends something else).
struct ContentView: View {
    @State private var viewModel = RouteViewModel(route: .loadSample())
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 24) {
            Text("\(viewModel.stepNumber) of \(viewModel.totalSteps)")
                .font(.headline)
                .foregroundStyle(.secondary)

            Spacer()

            Text(viewModel.currentStep.instruction)
                .font(.system(size: 48, weight: .bold))
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if let detail = viewModel.currentStep.detail {
                Text(detail)
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

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
}

#Preview {
    ContentView()
}
