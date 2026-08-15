import { createRoom, expect, hostPause, hostPlay, joinRoom, test, videoState } from './harness.js'

let roomCounter = 0
const uniqueRoom = () => `e2e-nav-${process.pid}-${roomCounter++}`

const twoInARoom = async (newClient, room) => {
	const host = await newClient('host')
	await createRoom(host, room)
	const guest = await newClient('guest')
	await joinRoom(guest, room)
	return { host, guest }
}

test('a guest navigates to the host when joining an existing room', async ({ newClient, fixtureServer }) => {
	const room = uniqueRoom()
	const host = await newClient('host')
	await host.page.goto(`${fixtureServer.origin}/player2.html`)
	await host.page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
	await createRoom(host, room)

	const guest = await newClient('guest')
	await joinRoom(guest, room)

	await expect
		.poll(async () => guest.page.url(), {
			message: 'guest should navigate to the host page immediately after joining',
			timeout: 30_000,
		})
		.toContain('player2.html')
})

/*
The host moving to the next episode. Detection lives in background.js because a
full page load leaves the content script with no memory of the URL it replaced —
these tests are the reason that indirection exists, so they are worth keeping
honest: stub emitStreamChangeForTab to a no-op and both must fail.
*/

test('a guest follows the host through a full page load', async ({ newClient, fixtureServer }) => {
	const { host, guest } = await twoInARoom(newClient, uniqueRoom())

	await hostPlay(host)
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	await host.page.goto(`${fixtureServer.origin}/player2.html`)
	await host.page.waitForFunction(() => document.querySelector('video').readyState >= 2)

	// Settle debounce, then the probe loop waits a beat for the new page's frame
	// to announce itself — several seconds all told.
	await expect
		.poll(async () => guest.page.url(), {
			message: 'guest should be pulled to the episode the host navigated to',
			timeout: 30_000,
		})
		.toContain('player2.html')

	// Landing there is only half of it: the host has to have rebound to the new
	// page's video, or the room is on the right page and dead.
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(true)
	await hostPlay(host)
	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'sync should still work after the move',
			timeout: 30_000,
		})
		.toBe(false)
})

test('a guest follows an SPA navigation without waiting for play', async ({
	newClient,
	fixtureServer,
}) => {
	const { host, guest } = await twoInARoom(newClient, uniqueRoom())

	await hostPlay(host)
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	// What a single-page player does on "next episode": push a new URL and
	// swap the element. Deliberately no play() on the host afterwards — the old
	// implementation only broadcast from a play listener, so it needed one.
	await host.page.evaluate(() => {
		history.pushState({}, '', '/player2.html')
		const old = document.querySelector('video')
		const fresh = document.createElement('video')
		fresh.src = old.src
		fresh.controls = true
		old.replaceWith(fresh)
	})

	await expect
		.poll(async () => guest.page.url(), {
			message: 'guest should follow a pushState move with no play event',
			timeout: 30_000,
		})
		.toContain('player2.html')
})

/*
The socket lives in the background worker, so a guest reloading its own page
never leaves the room — the server still counts it in. What the reload does
destroy is the page's playback state, and nothing on the server side knows to
resend it. Without an explicit snapshot request the guest sits paused at zero
until the host happens to touch the video, or until the host's 60s corrective
snapshot. That is the wait this test refuses to accept.
*/
test('a guest that reloads its own page comes back in sync', async ({ newClient }) => {
	const { host, guest } = await twoInARoom(newClient, uniqueRoom())

	await hostPlay(host)
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	await guest.page.reload()
	await guest.page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)

	// No host action in between: the guest has to ask for the state itself.
	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'a reloaded guest should resume without the host touching anything',
			timeout: 30_000,
		})
		.toBe(false)

	// Resuming at zero would be "playing" but not "in sync".
	await expect
		.poll(async () => {
			const [h, g] = [await videoState(host.page), await videoState(guest.page)]
			return Math.abs(h.currentTime - g.currentTime)
		}, {
			message: 'the reloaded guest should land near the host position',
			timeout: 30_000,
		})
		.toBeLessThan(2)

	// And the tab has to be a live member again, not just correct once.
	await hostPause(host)
	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'sync should still work after the reload',
			timeout: 30_000,
		})
		.toBe(true)
})

test('the room is not dragged onto a page with no video', async ({ newClient, fixtureServer }) => {
	const { host, guest } = await twoInARoom(newClient, uniqueRoom())

	await hostPlay(host)
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	const before = guest.page.url()
	// 404s from the fixture server, so the page has no <video> at all.
	await host.page.goto(`${fixtureServer.origin}/nothing-here.html`).catch(() => {})

	// Long enough to outlast the settle debounce and several probe attempts.
	await guest.page.waitForTimeout(8000)
	expect(guest.page.url(), 'guest should not have moved').toBe(before)
})
