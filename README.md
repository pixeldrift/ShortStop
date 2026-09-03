# ShortStop
A Schoolbus Routing Solution

## First prototype

A minimal iPad/iPhone app that steps a driver through a route's
navigation instructions one at a time — matching the "first working
demonstration" described in the project doc: a fictional Route 104,
press Start, turn-by-turn with audio, stop announcements with student
counts and special instructions, advanced via a Bluetooth media switch.

No maps, GPS-triggered advancing, or backend yet — the route is a
hardcoded sample (`ShortStopApp/Resources/SampleRoute.json`) using the
doc's own Route 104 example, so the step-through UX, the audio
announcements, and the Bluetooth-remote input path can be validated
first.

### Project layout

```
ShortStopApp/
  ShortStopApp.swift          App entry point
  Info.plist                  Declares background audio mode (needed for
                               remote-control routing, see below)
  Models/
    NavigationStep.swift      One instruction (turn/stop/depart/arrive)
    Route.swift                A named list of steps, loads the sample JSON
  ViewModels/
    RouteViewModel.swift      Current step index, advance()/goBack(),
                               wires up remote control + speech
  Views/
    ContentView.swift         The step-through screen + input handling
  Services/
    RemoteControlManager.swift  Bluetooth media-remote button handling
    Announcer.swift              Text-to-speech for turn-by-turn/stop audio
  Resources/
    SampleRoute.json          Route 104 sample data
project.yml                   XcodeGen manifest (generates the .xcodeproj)
```

### Opening the project

This was built without Xcode available (developed in a Linux session), so
the `.xcodeproj` is generated rather than checked in, via
[XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
brew install xcodegen   # once
cd ShortStop
xcodegen generate
open ShortStop.xcodeproj
```

Run on an iPad or iPhone (Simulator or device), iOS 17+.

### Bluetooth hardware input

The Bluetooth clickers linked in the project doc (bike/handlebar-mount
remotes with rewind / play-pause / fast-forward buttons) are AVRCP media
remotes — the same mechanism used to skip a podcast from a pair of
earbuds — **not** Bluetooth keyboards. iOS routes their button presses to
whichever app is the current "Now Playing" app via
`MPRemoteCommandCenter`, not as key events.

`Services/RemoteControlManager.swift` handles this: it activates a
`.playback` audio session, publishes minimal Now Playing info so this app
becomes the target for remote-control events, and maps:

- **Next / fast-forward / play-pause** → advance to next step
- **Previous / rewind** → back to previous step

As a fallback (in case a specific device turns out to pair as a keyboard
instead), `ContentView.swift` also listens for arrow/space/enter key
presses via `onKeyPress`.

**Untested assumption to verify on hardware:** remote-command routing is
generally reliable while the app holds an active playback session, but
some devices/iOS versions are pickier about routing to an app that isn't
continuously producing audio. The spoken announcements (`Announcer.swift`)
keep the session active most of the time; if testing shows button presses
get dropped during silence between announcements, the fix is a low-volume
looping silent audio track via `AVAudioPlayer` to keep the session
continuously "playing" — not added yet since it adds complexity that may
not be needed.

### Audio

Turn and stop announcements are spoken aloud via `AVSpeechSynthesizer`
(`Services/Announcer.swift`), matching the doc's audio-first UX — the
driver isn't expected to read the screen while moving. Text is currently
hand-authored per sample step; a real route would need this generated
from structured stop/turn data.

### Next steps

- Replace `SampleRoute.json` with real routing/stop data pulled from the
  data model in the project doc (District/School/Route/RouteStop/etc.)
- Map view (the doc's MVP calls for displaying the route on a map, not
  just text instructions)
- GPS-based auto-advance as students are picked up / stops are passed —
  the doc treats manual button-advance as the first-prototype mechanism
  and GPS auto-advance as a later step
- Persist route progress / handle app backgrounding mid-route
- Real routing data source instead of a bundled sample file
