import AVFoundation
import MediaPlayer

/// Activates a playback audio session and listens for Bluetooth
/// media-remote button presses (previous / play-pause / next).
///
/// The clickers this app targets are cheap bike/handlebar Bluetooth
/// remotes using the standard AVRCP media-control profile — the same
/// mechanism that skips a podcast from a pair of earbuds. iOS routes
/// those button presses to whichever app is the current "Now Playing"
/// app, via MPRemoteCommandCenter — they do not arrive as keyboard
/// events, so a hardware-keyboard listener alone will not see them.
final class RemoteControlManager {
    var onAdvance: (() -> Void)?
    var onBack: (() -> Void)?

    private let commandCenter = MPRemoteCommandCenter.shared()

    func start() {
        configureAudioSession()
        registerCommands()
        publishNowPlayingInfo()
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers])
        try? session.setActive(true)
    }

    private func registerCommands() {
        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.onAdvance?()
            return .success
        }

        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.onBack?()
            return .success
        }

        // Some single/two-button remotes only expose play-pause; treat
        // it as advance so those still work as a "next step" clicker.
        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.onAdvance?()
            return .success
        }
        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.onAdvance?()
            return .success
        }
    }

    /// Publishing Now Playing info is what makes iOS treat this app as
    /// the active media app, so remote-control button presses route here
    /// instead of to Music/Podcasts/whatever else is registered.
    private func publishNowPlayingInfo() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: "ShortStop Route",
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
        ]
    }
}
