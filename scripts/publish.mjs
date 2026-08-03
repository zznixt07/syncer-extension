/*
Uploads dist/syncer-<version>.zip to the Chrome Web Store.

  node scripts/publish.mjs            upload only — the draft sits in the
                                      dashboard until you publish it yourself
  node scripts/publish.mjs --publish  upload, then submit for review

Uploading is reversible; submitting for review is not, so it is opt-in rather
than the default. See scripts/README.md for how to get the four credentials.
*/
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SUBMIT = process.argv.includes('--publish')

const env = (name) => {
	const value = process.env[name]
	if (!value) {
		console.error(
			`${name} is not set. All four of CWS_CLIENT_ID, CWS_CLIENT_SECRET,\n` +
				`CWS_REFRESH_TOKEN and CWS_EXTENSION_ID are needed — see scripts/README.md.`
		)
		process.exit(1)
	}
	return value
}

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
const zipPath = path.join(ROOT, 'dist', `syncer-${version}.zip`)
if (!fs.existsSync(zipPath)) {
	console.error(`${path.relative(ROOT, zipPath)} does not exist — run: npm run package`)
	process.exit(1)
}

const clientId = env('CWS_CLIENT_ID')
const clientSecret = env('CWS_CLIENT_SECRET')
const refreshToken = env('CWS_REFRESH_TOKEN')
const extensionId = env('CWS_EXTENSION_ID')

// The refresh token is long-lived; access tokens last an hour, so one is minted
// per run rather than stored anywhere.
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
	method: 'POST',
	headers: { 'content-type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		refresh_token: refreshToken,
		grant_type: 'refresh_token',
	}),
})
const token = await tokenRes.json()
if (!tokenRes.ok || !token.access_token) {
	console.error('Could not exchange the refresh token:', JSON.stringify(token, null, 2))
	process.exit(1)
}

const auth = {
	authorization: `Bearer ${token.access_token}`,
	'x-goog-api-version': '2',
}

console.log(`Uploading ${path.relative(ROOT, zipPath)} to ${extensionId} ...`)
const uploadRes = await fetch(
	`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`,
	{ method: 'PUT', headers: auth, body: fs.readFileSync(zipPath) }
)
const upload = await uploadRes.json()
// A failed upload can still come back 200 with the detail in the body, so the
// state is what matters, not the status code.
if (!uploadRes.ok || upload.uploadState === 'FAILURE') {
	console.error('Upload failed:', JSON.stringify(upload, null, 2))
	process.exit(1)
}
console.log(`Upload ${upload.uploadState}. Version ${version} is now a draft.`)

if (!SUBMIT) {
	console.log(
		'Not submitted for review. Publish from the dashboard, or re-run with --publish.'
	)
	process.exit(0)
}

const publishRes = await fetch(
	`https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish`,
	{ method: 'POST', headers: { ...auth, 'content-length': '0' } }
)
const published = await publishRes.json()
if (!publishRes.ok) {
	console.error('Publish failed:', JSON.stringify(published, null, 2))
	process.exit(1)
}
console.log('Submitted for review:', JSON.stringify(published.status ?? published, null, 2))
