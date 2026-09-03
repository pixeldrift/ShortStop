# ShortStop
A Schoolbus Routing Solution

## First prototype

A minimal iPad/iPhone app that steps through a route's navigation
instructions one at a time. Advance with a tap anywhere on screen, the
on-screen Next/Back buttons, or a paired Bluetooth clicker/remote.

No routing logic, maps, or backend yet — the route is a hardcoded sample
(`ShortStopApp/Resources/SampleRoute.json`) so the step-through UX and the
Bluetooth-hardware input path can be validated first.

### Project layout

```
ShortStopApp/
  ShortStopApp.swift        App entry point
  Models/
    NavigationStep.swift     One instruction (text + optional detail)
    Route.swift               A named list of steps, loads the sample JSON
  ViewModels/
    RouteViewModel.swift     Current step index, advance()/goBack()
  Views/
    ContentView.swift        The step-through screen + input handling
  Resources/
    SampleRoute.json          Placeholder route data
project.yml                  XcodeGen manifest (generates the .xcodeproj)
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

Most Bluetooth "clicker" remotes (presentation remotes, camera shutter
remotes, accessibility switches) pair as an external Bluetooth keyboard
rather than exposing custom Bluetooth Low Energy characteristics. Pair the
device in iOS Settings > Bluetooth like a keyboard, then the app's
`onKeyPress` handlers in `ContentView.swift` pick up its keypresses:

- **Next**: space, enter/return, right arrow, or down arrow
- **Back**: left arrow, up arrow, or delete/backspace

If your specific hardware sends different key codes (or uses a camera
shutter / volume-button style event instead of a keyboard event), test it
first — e.g. type into Notes with the device paired to see what character
or key it produces — then adjust the key sets in `ContentView.swift`
accordingly.

### Next steps

- Replace `SampleRoute.json` with real routing/stop data (format TBD —
  pending details from the project planning doc)
- Persist route progress / handle app backgrounding mid-route
- Real routing data source instead of a bundled sample file
