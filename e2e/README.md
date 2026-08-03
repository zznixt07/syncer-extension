# End-to-end tests

`npm test` covers the sync logic against fakes (`test/`). These cover the half
that only a real browser can: two profiles, two sockets, a real `<video>`, and
the extension's own service worker, content script and popup.

```sh
SYNCER_SERVER_DIR=/path/to/syncer-server npm run test:e2e
SYNCER_E2E_HEADED=1 npm run test:e2e     # watch it happen
```

The socket server is rebuilt (`npm run build`) and started on a random port for
each worker; the fixture page is served from `e2e/fixture/` on another. Nothing
touches port 3000 or your own Chrome profile.

## How the extension gets loaded

Chrome 137+ ignores `--load-extension`, so the harness installs the unpacked
extension over CDP with `Extensions.loadUnpacked`. Playwright separately passes
`--disable-extensions` by default, which would silently disable it again, so the
harness sets `ignoreDefaultArgs: ['--disable-extensions']`. Both are needed;
neither alone works.

Chrome refuses to load a directory containing a file whose name starts with `_`
— those are reserved. Don't leave scratch files like `_foo.js` in the repo root.

## The one substitution

The popup asks `chrome.tabs.query({currentWindow: true, active: true})` for the
tab it should act on. In the toolbar panel that is the page you are looking at;
opened as an ordinary tab it would be the popup itself — an extension page,
which the popup rightly refuses to touch. So the harness pins that one call to
the player tab (`openPopup` in `harness.js`). Everything else — the buttons, the
messaging, the sockets — is real.

## What these can't reach

- The toolbar badge. `chrome.action` state is not readable from a page; asserting
  on it would need a separate CDP surface that Chrome does not expose.
- Real autoplay blocking. Chrome does not apply its autoplay policy to a
  localhost fixture — not headless, not headed, not with `--autoplay-policy`
  set to anything. The blocked-playback test fakes the rejection by overriding
  `HTMLMediaElement.prototype.play`; the gesture listener and retry it exercises
  are real.
- Byte ranges are served by the fixture server on purpose. Without them Chrome
  reports `seekable.end === 0` and silently refuses every seek, which makes seek
  tests pass by doing nothing.
- Anything about how a specific site's player (YouTube, hls.js) behaves. The
  fixture is a plain `<video>`.
- Episode changes that only swap an `<iframe>`'s `src`, leaving the page URL
  alone. Not a harness limit — the extension does not support it. Only the
  top-frame URL is ever compared, so there is nothing to broadcast. Sites that
  change the page URL on "next episode" (full load or pushState) are covered by
  `navigation.spec.js`.
