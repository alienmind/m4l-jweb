This document records the architectural details, implementation attempts, and trial-and-error logs for several attempted features, currently parked, for future reference.

# Floating Windows Architecture

## Goal
To allow the React UI to declare secondary floating windows (e.g., `testWindow: window({ ... })`), which compile into hidden Max subpatchers containing their own `[jweb]` instance. The main UI should be able to trigger these windows to open and close via `drumWindow.open()`.

## Architecture Intent
1. **React Side**: `useWindow` hook provides an `open` and `close` function. These send Max messages via the bridge: `window.max.outlet("window_<id>_open", 1)`.
2. **Bridge/Wrapper Side**: The wrapper extracts the secondary `.html` payload to disk and sends its `file:///...` URL to a `[receive window-read-<id>]` object in Max.
3. **Max Patcher Side**: 
   - A subpatcher `[p <Title>]` is created with `openinpresentation: 1` so it opens as a floating window.
   - It contains a `[jweb]` object that receives the URL from the `[receive]`.
   - The main patch contains a `[route window_<id>_open window_<id>_close]` object connected to the main `[jweb]` dumpout.
   - Matching the `open` route triggers a Max mechanism (either `[pcontrol]` or `[thispatcher]`) to pop the subpatcher open.

## Implementation Attempts & Trial and Error

### Attempt 1: Initial Implementation
- **Approach**: Used `[pcontrol]` connected to the subpatcher. `[route]` output triggered a `[message open]` box, which fed into `[pcontrol]`.
- **Result**: Max threw no errors, but the window didn't open.
- **Flaw**: The subpatcher `[p]` was generated *without any inlets*. Max silently refuses to connect a patchcord to a subpatcher with no inlets, so `[pcontrol]` was left completely disconnected in the final `.amxd`.

### Attempt 2: `[thispatcher]` with `front`
- **Approach**: Added an `[inlet]` to the subpatcher. Inside the subpatcher, connected the inlet to a `[thispatcher]` object. Outside the subpatcher, replaced `[pcontrol]` by sending the `[message front]` directly into the subpatcher's inlet.
- **Result**: Failed.
- **Trial & Error**: We encountered a Javascript scoping issue (`Cannot access 'subpatcherId' before initialization`) during the build script execution, which we fixed. Even after successfully compiling the Max patch, clicking the button in the UI did not open the window.

### Attempt 3: Back to `[pcontrol]` + Debug Prints
- **Approach**: Reverted the subpatcher to use `[pcontrol]` (the "official" way to open subpatchers from the outside in Max), keeping the `[inlet]` so the connection was valid. 
- **Refinement**: Added a `[t b]` (trigger bang) between the `[route]` and the `[message open]` to guarantee that whatever data `jweb` outputted (integers, lists) would cleanly trigger the message box without Max trying to evaluate variables.
- **Debugging**: Injected `[print JWEB_WINDOWS]` and `[print ROUTE_MATCH]` directly into the Max patch to trace the message lifecycle.
- **Result**: Failed.
- **Trial & Error**: The Live console log revealed:
  ```
  JWEB_WINDOWS: window_testWindow_open 1
  ```
  This confirmed that the Chromium `jweb` instance *was* successfully outputting the message from `window.max.outlet`. However, the `ROUTE_MATCH` print never fired. This implied that Max's `[route]` object was fundamentally refusing to match the `window_testWindow_open` message coming out of `jweb`, possibly because the message was being outputted as a literal string with spaces, or an implicit list where `route`'s type-matching behaves unexpectedly.

## Parking Notes
- The URL extraction and loading mechanism *works*. The log `extracted ... bytes to .../hello-midi_testWindow.html` proves the file is ready.
- The `window.max.outlet` bridge *works*. The log `JWEB_WINDOWS: window_testWindow_open 1` proves the signal successfully crosses from React into Max.
- The failure lies strictly in the Max patching domain: specifically, bridging the gap between what `[jweb]` outputs natively and what `[route]` accepts to trigger the subpatcher opening logic.
- **Future Investigation**: Inspect the exact type of the message coming out of `jweb` dumpout in Max 8 (e.g., using `[type]` or passing it through `[fromsymbol]` / `[tosymbol]`) to figure out why `[route]` ignores it.

---

# Fetch-to-disk (File Download)

## Goal
To allow the React UI to download a file from a URL directly to the user's local disk (e.g., the Desktop) without requiring standard browser dialogs (which CEF/jweb does not support). The feature should be portable across Mac and Windows.

## Architecture Intent
1. **React Side**: fetchToFile(url, destPath) exposed via the bridge API.
2. **Bridge/Wrapper Side**: processNextFetch() constructs a request dictionary for Max's [maxurl] object, setting the downloadfilename key.
3. **Max Patcher Side**: A [maxurl] object receives the dictionary and initiates a GET request, saving the output directly to the specified file path.

## Implementation Attempts & Trial and Error

### Attempt 1: Raw Messages
- **Approach**: Sent raw http_method get, downloadfilename <path>, and url <url> messages to [maxurl].
- **Result**: Max 8's [maxurl] threw doesn't understand errors for these messages.

### Attempt 2: Dictionary Configuration
- **Approach**: Discovered [maxurl] in Max 8 requires passing a Dict object to configure downloads. Created a Dict in core.ts with downloadfilename.
- **Result**: [maxurl] correctly understood the request (HTTP 200 Success), but no bytes were written to the file on disk.

### Attempt 3: Portable Paths
- **Approach**: Attempted to resolve paths portably using ~/ and Desktop:/ (which Max's File object understands natively).
- **Result**: [maxurl] relies directly on libcurl under the hood. Libcurl does not understand Max-specific path prefixes (~/, Desktop:/), and requires an absolute OS path.

### Attempt 4: Relative to Device Path
- **Approach**: Stripped relative prefixes and prepended 	his.patcher.filepath in Max JS to create an absolute OS path pointing to the device's installation directory in the Ableton User Library.
- **Result**: Due to Ableton Live's behavior, instances of .amxd devices already loaded on tracks cache their state. Without deleting and re-dragging the device manually after every rebuild, the old relative path ~/test_download.json continued to execute, producing invalid libcurl paths and failing to write to disk.

The feature is parked pending a more robust cross-platform path-resolution strategy and a smoother device reloading workflow.

