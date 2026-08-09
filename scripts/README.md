# Releasing

Runtime resources are generated from the root entry-point sources with `npm run build`. The build bundles Socket.IO and the exact Git-pinned `syncer-extension-core` commit into `generated/`; the Chrome package never resolves npm packages at runtime. When updating the core pin, run `npm install`, `npm test`, `npm run package`, and the Playwright suite with `SYNCER_SERVER_DIR` set, then commit the lockfile and generated resources together.

```sh
bump-my-version bump minor   # or patch — commits and tags
npm run package              # -> dist/syncer-<version>.zip
npm run release              # upload as a draft
npm run release -- --publish # upload and submit for review
```

The store rejects a version number it has already seen, so the bump comes first.

## Checking the package before it goes out

The e2e suite can run against the zip's contents rather than the repo, which is
the only way to catch a file `scripts/package.mjs` forgot to list:

```sh
unzip -d /tmp/pkg dist/syncer-<version>.zip
SYNCER_EXT_DIR=/tmp/pkg SYNCER_SERVER_DIR=/path/to/syncer-server npm run test:e2e
```

`package.mjs` ships an explicit file list, not a glob, and fails if `manifest.json`
references anything the list omits. It writes the archive itself instead of
shelling out: Windows PowerShell's `Compress-Archive` stores nested entries as
`lib\socket.io.min.js`, using a separator the ZIP spec forbids, and Chrome then
cannot find `lib/socket.io.min.js` — a package that looks correct until it is
loaded.

## Credentials

`publish.mjs` needs four values in the environment. Getting them is a one-time
setup and every step has to be done by you — they are tied to your Google
account.

1. **`CWS_EXTENSION_ID`** — from the item's URL in the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole), the
   32-character string.

2. In [Google Cloud Console](https://console.cloud.google.com/), create (or pick)
   a project and enable the **Chrome Web Store API**.

3. Configure the OAuth consent screen: **External**, and add your own Google
   account under **Test users**. Publishing the consent screen is not necessary.

4. Create an **OAuth client ID** of type **Desktop app**. That gives you
   **`CWS_CLIENT_ID`** and **`CWS_CLIENT_SECRET`**.

5. **`CWS_REFRESH_TOKEN`** — visit the URL below in a browser signed in as the
   developer account, approve, and copy the `code` parameter off the redirect:

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&scope=https://www.googleapis.com/auth/chromewebstore&redirect_uri=http://localhost&client_id=YOUR_CLIENT_ID
   ```

   Then exchange it — the code is single-use and expires in minutes:

   ```sh
   curl -s -d "client_id=YOUR_CLIENT_ID" \
        -d "client_secret=YOUR_CLIENT_SECRET" \
        -d "code=THE_CODE" \
        -d "grant_type=authorization_code" \
        -d "redirect_uri=http://localhost" \
        https://oauth2.googleapis.com/token
   ```

   `refresh_token` in the response is the value you keep. If the response has no
   `refresh_token`, revoke the app at
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
   and redo this step — Google only issues one on first approval.

Keep these out of the repo. Set them in your shell profile, or put them in a
`.env` that stays untracked — the refresh token grants upload rights to your
store listing until you revoke it.
