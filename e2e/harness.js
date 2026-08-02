import { test as base, chromium, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

// evaluated inside the browser, not here
/* global chrome */

export { expect }

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url))
const EXT_DIR = path.dirname(E2E_DIR)
const FIXTURE_DIR = path.join(E2E_DIR, 'fixture')

/*
The socket server lives in its own repo. Point at it with SYNCER_SERVER_DIR,
or drop it next to this one as ../syncer-server.
*/
const resolveServerDir = () => {
	const candidates = [
		process.env.SYNCER_SERVER_DIR,
		path.join(EXT_DIR, '..', 'syncer-server'),
	].filter(Boolean)
	for (const dir of candidates) {
		if (fs.existsSync(path.join(dir, 'index.ts'))) return dir
	}
	throw new Error(
		'Cannot find the syncer socket server. Set SYNCER_SERVER_DIR to its checkout.'
	)
}

/* Serves e2e/fixture/ — a page with a real <video> the extension can drive. */
const startFixtureServer = async () => {
	const types = { '.html': 'text/html', '.mp4': 'video/mp4', '.js': 'text/javascript' }
	const server = http.createServer((req, res) => {
		const rel = decodeURIComponent(req.url.split('?')[0])
		const file = path.join(FIXTURE_DIR, rel)
		if (!file.startsWith(FIXTURE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404).end()
			return
		}
		res.writeHead(200, {
			'content-type': types[path.extname(file)] ?? 'application/octet-stream',
			'accept-ranges': 'none',
		})
		fs.createReadStream(file).pipe(res)
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()
	return { origin: `http://127.0.0.1:${port}`, close: () => server.close() }
}

const startSyncServer = async () => {
	const dir = resolveServerDir()
	// dist/ is checked in but can lag index.ts; rebuild so tests run the source.
	execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'pipe', shell: true })

	const port = 3100 + Math.floor(Math.random() * 400)
	const proc = spawn(process.execPath, [path.join(dir, 'dist/index.js')], {
		cwd: dir,
		env: { ...process.env, PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	const output = []
	proc.stdout.on('data', (d) => output.push(String(d)))
	proc.stderr.on('data', (d) => output.push(String(d)))

	// Wait for it to actually accept connections rather than guessing at a delay.
	const deadline = Date.now() + 20_000
	for (;;) {
		if (proc.exitCode !== null) {
			throw new Error(`sync server exited early:\n${output.join('')}`)
		}
		try {
			await new Promise((resolve, reject) => {
				const req = http.get(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, (res) => {
					res.resume()
					resolve()
				})
				req.on('error', reject)
			})
			break
		} catch {
			if (Date.now() > deadline) {
				throw new Error(`sync server never came up:\n${output.join('')}`)
			}
			await new Promise((r) => setTimeout(r, 200))
		}
	}
	return { origin: `http://127.0.0.1:${port}`, output, close: () => proc.kill() }
}

/*
A whole browser profile with the extension installed — one per participant,
because two tabs in one profile share a single socket and would not exercise
anything.

Chrome 137+ ignores --load-extension, so the extension goes in over CDP.
Playwright also passes --disable-extensions by default, which silently
disables it again; hence ignoreDefaultArgs.
*/
const launchClient = async ({ headless, autoplay = true }) => {
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-e2e-'))
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chrome',
		headless,
		ignoreDefaultArgs: ['--disable-extensions'],
		args: [
			// Headless Chrome has no audio device; without this, play() on a
			// video with an audio track can reject for reasons unrelated to
			// the autoplay policy we actually want to test.
			'--mute-audio',
			...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []),
		],
	})
	const cdp = await context.browser().newBrowserCDPSession()
	const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR })

	const close = async () => {
		await context.close()
		fs.rmSync(profile, { recursive: true, force: true })
	}
	return { context, extensionId, cdp, close }
}

/* The background service worker is lazy; it wakes on the first extension event. */
const serviceWorkerOf = async (context) => {
	const [existing] = context.serviceWorkers()
	if (existing) return existing
	return await context.waitForEvent('serviceworker', { timeout: 15_000 })
}

export const test = base.extend({
	// Both servers are per-worker: starting them costs seconds and rooms are
	// cleaned up by leaving, not by restarting.
	syncServer: [
		// eslint-disable-next-line no-empty-pattern -- Playwright reads deps from this pattern
		async ({}, use) => {
			const server = await startSyncServer()
			await use(server)
			server.close()
		},
		{ scope: 'worker' },
	],
	fixtureServer: [
		// eslint-disable-next-line no-empty-pattern -- Playwright reads deps from this pattern
		async ({}, use) => {
			const server = await startFixtureServer()
			await use(server)
			server.close()
		},
		{ scope: 'worker' },
	],

	/*
	newClient() -> a participant: its own browser profile, a tab on the fixture
	player, and a popup wired to that tab.
	*/
	newClient: async ({ syncServer, fixtureServer }, use, testInfo) => {
		const opened = []
		const headless = !process.env.SYNCER_E2E_HEADED

		const newClient = async (label, { autoplay = true } = {}) => {
			const client = await launchClient({ headless, autoplay })
			opened.push(client)
			const { context, extensionId } = client

			const page = await context.newPage()
			const logs = []
			page.on('console', (m) => logs.push(`[${label}] ${m.type()}: ${m.text()}`))
			page.on('pageerror', (e) => logs.push(`[${label}] pageerror: ${e.message}`))
			await page.goto(`${fixtureServer.origin}/player.html`)
			await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)

			const worker = await serviceWorkerOf(context)
			const tabId = await worker.evaluate(
				async (url) => (await chrome.tabs.query({ url }))[0]?.id,
				`${fixtureServer.origin}/*`
			)
			if (tabId == null) throw new Error(`${label}: could not find the player tab`)

			const popup = await openPopup(context, extensionId, tabId, syncServer.origin)
			popup.on('console', (m) => logs.push(`[${label} popup] ${m.type()}: ${m.text()}`))
			popup.on('pageerror', (e) => logs.push(`[${label} popup] pageerror: ${e.message}`))

			return { label, context, extensionId, worker, page, popup, tabId, logs, cdp: client.cdp }
		}

		await use(newClient)

		// Attach whatever the pages said, so a failure is diagnosable.
		for (const client of opened) await client.close().catch(() => {})
		if (testInfo.status !== testInfo.expectedStatus) {
			testInfo.attach('sync-server output', {
				body: syncServer.output.join(''),
				contentType: 'text/plain',
			})
		}
	},
})

/*
The popup normally runs in the toolbar panel, where
chrome.tabs.query({currentWindow: true, active: true}) resolves to the page the
user is looking at. Opened as an ordinary tab it would resolve to itself — an
extension page, which the popup rightly refuses to touch. So we pin it to the
player tab. This is the one place the harness substitutes for the browser.
*/
const openPopup = async (context, extensionId, tabId, serverOrigin) => {
	const popup = await context.newPage()
	await popup.addInitScript((pinnedTabId) => {
		const realQuery = chrome.tabs.query.bind(chrome.tabs)
		chrome.tabs.query = (info, cb) => {
			if (!(info?.active && info?.currentWindow)) return realQuery(info, cb)
			const result = chrome.tabs.get(pinnedTabId).then((tab) => [tab])
			if (cb) return void result.then(cb)
			return result
		}
	}, tabId)
	await popup.goto(`chrome-extension://${extensionId}/popup.html`)
	await popup.waitForSelector('#create-room')

	// Point the extension at this run's server before anything connects.
	await popup.fill('#server-address', serverOrigin)
	await expect
		.poll(async () => await popup.evaluate(() => document.getElementById('server-address').value))
		.toBe(serverOrigin)
	return popup
}

/* --- helpers the specs use ------------------------------------------------ */

export const videoState = (page) =>
	page.evaluate(() => {
		const v = document.querySelector('video')
		return {
			paused: v.paused,
			currentTime: v.currentTime,
			playbackRate: v.playbackRate,
			muted: v.muted,
		}
	})

export const createRoom = async (client, roomName) => {
	await client.popup.fill('#new-room-name', roomName)
	await client.popup.click('#create-room')
	await expect(client.popup.locator('#room-user-count')).not.toBeEmpty()
}

export const joinRoom = async (client, roomName) => {
	await client.popup.fill('#new-room-name', roomName)
	await client.popup.click('#join-room')
	await expect(client.popup.locator('#room-user-count')).not.toBeEmpty()
}

export const leaveRoom = async (client, roomName) => {
	await client.popup.fill('#new-room-name', roomName)
	await client.popup.click('#leave-room')
}

/* Acts on the video the way a person would, so the extension sees real events. */
export const hostPause = (client) =>
	client.page.evaluate(() => document.querySelector('video').pause())

export const hostPlay = (client) =>
	client.page.evaluate(() => document.querySelector('video').play())

export const hostSeek = (client, to) =>
	client.page.evaluate((t) => {
		document.querySelector('video').currentTime = t
	}, to)
