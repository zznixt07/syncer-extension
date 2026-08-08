# Changelog

Notable changes to Syncer. Versions before 1.2.0 predate this file; see the git
history for those.

## 1.2.1 — 2026-08-08

### Added

- **Syncer protocol v2 interoperability** for ordered playback events, stored
  room snapshots, media identity, source details, and playback capabilities.
  Playback events are now v2-only; flat legacy payloads are ignored.
- **Android native-host guidance.** When a native MediaSession cannot provide
  a navigable URL, guests can see the host's service, title, artist/channel,
  and duration in the popup and copy the title for manual navigation.

### Fixed

- Stream-change events without a URL no longer attempt an invalid navigation.
- A newly created room now publishes its current stream and playback state
  immediately, allowing the first guest to navigate without waiting for a
  later player callback.

## 1.2.0 — 2026-08-03

The first release since 1.1.0, which shipped no functional changes of its own —
everything below has accumulated since 1.0.8.

### Added

- **The room follows the host to the next episode.** When the host navigates —
  a full page load or an in-page (SPA) navigation — everyone else is taken to
  the same page. The move happens once the host's URL settles and a video has
  actually appeared, so the room is not dragged onto a menu or search page, and
  it no longer waits for the host to press play.
- **A live count of who else is in the room**, in the popup and on the toolbar
  badge. It updates as people join and leave rather than only when you open the
  popup, and the popup now reopens showing the room you are actually in.

### Changed

- **Small drifts are corrected by nudging the playback rate** instead of
  seeking. A seek costs a re-buffer and a visible stutter; below roughly half a
  second it is cheaper to run slightly fast or slow and let the gap close on its
  own. Larger gaps still seek.
- **Buffering now ends as loudly as it starts.** The room was told when a
  viewer began buffering but not when they recovered, so playback could stay
  held longer than necessary.

### Fixed

- **Sync no longer dies silently when a page replaces its video element**, as
  players do between episodes. The extension rebinds to the replacement instead
  of holding a reference to a detached node.
- **A guest whose playback is blocked by the browser's autoplay policy now
  recovers** on their next click or keypress, rather than sitting paused while
  the rest of the room plays on.
- **A dropped connection reconnects and rejoins** the room instead of leaving
  you in a room that no longer receives anything.
- **The room survives Chrome shutting down the extension's background worker.**
  Chrome terminates idle MV3 service workers, which previously took the session
  with it. Sessions are now restored on wake.

### Permissions

- Adds `alarms`, used to re-establish the room connection after Chrome
  terminates the background service worker. It carries no user-facing
  permission prompt.
- No change to host access. `<all_urls>` was already required and still is.

### Internal

- Sync arithmetic and media side effects extracted behind testable seams, with
  38 unit tests.
- An end-to-end suite that drives two real Chrome profiles, two sockets and a
  real `<video>` against a real server (10 tests).
- Releases are now built by `scripts/package.mjs` from an explicit file list
  rather than by hand. Four files that nothing loads (`index.html`,
  `spotify.js`, `icon128.png`, `main-content-script.d.ts`) are no longer
  shipped.
