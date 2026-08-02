import {
	createRoom,
	expect,
	hostPause,
	hostPlay,
	hostSeek,
	joinRoom,
	test,
	videoState,
} from './harness.js'

let roomCounter = 0
const uniqueRoom = () => `e2e-scn-${process.pid}-${roomCounter++}`

/* A room with a host and a guest, both playing. */
const twoInARoom = async (newClient, room) => {
	const host = await newClient('host')
	await createRoom(host, room)
	const guest = await newClient('guest')
	await joinRoom(guest, room)
	return { host, guest }
}

const guestTime = async (guest) => (await videoState(guest.page)).currentTime

test('a guest converges on the position the host seeks to', async ({ newClient }) => {
	const { host, guest } = await twoInARoom(newClient, uniqueRoom())

	await hostPlay(host)
	await hostSeek(host, 60)

	// Not an exact match — the guest lands where the host will be by the time
	// the event arrives, and both keep playing while we look.
	await expect
		.poll(async () => await guestTime(guest), {
			message: 'guest should jump to roughly where the host seeked',
		})
		.toBeGreaterThan(55)
	expect(await guestTime(guest)).toBeLessThan(70)
})

test('a small drift is corrected by the playback rate', async ({ newClient }) => {
	const { host, guest } = await twoInARoom(newClient, uniqueRoom())

	await hostPlay(host)
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	// Record from inside the page. The nudge window can be cut short by the
	// next event, and polling over CDP is far too coarse to catch it.
	await guest.page.evaluate(() => {
		window.__rates = []
		const v = document.querySelector('video')
		v.addEventListener('ratechange', () => window.__rates.push(v.playbackRate))
	})

	// Shove the guest 0.2s ahead: past the ignore threshold, well under the
	// hard-seek one, so the correction should come from the rate.
	await guest.page.evaluate(() => {
		document.querySelector('video').currentTime += 0.2
	})
	// The guest only corrects when an event arrives, and there is no periodic
	// resync — so make the host emit one without really moving.
	await host.page.evaluate(() => {
		const v = document.querySelector('video')
		v.currentTime = v.currentTime + 0.001
	})

	await expect
		.poll(async () => await guest.page.evaluate(() => window.__rates), { timeout: 8000 })
		.toContainEqual(expect.any(Number))

	const rates = await guest.page.evaluate(() => window.__rates)
	expect(rates.some((r) => r < 1), `saw rates ${JSON.stringify(rates)}`).toBe(true)
	expect(rates.at(-1), 'the rate must be handed back, not left off-speed').toBe(1)

	// And it should end up sitting on the host.
	const drift = Math.abs(
		(await videoState(guest.page)).currentTime - (await videoState(host.page)).currentTime
	)
	expect(drift).toBeLessThan(0.5)
})

test('sync survives the host page swapping its video element', async ({ newClient }) => {
	const room = uniqueRoom()
	const { host, guest } = await twoInARoom(newClient, room)

	await hostPlay(host)
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	// What a single-page app does on "next episode": replace the node outright.
	// The host's listeners were bound to the old one.
	await host.page.evaluate(() => {
		const old = document.querySelector('video')
		const fresh = document.createElement('video')
		fresh.src = old.src
		fresh.controls = true
		old.replaceWith(fresh)
	})
	await host.page.waitForFunction(() => document.querySelector('video').readyState >= 2)

	// Detaching the old element pauses it, and that pause is broadcast from the
	// listeners still bound to it — so the guest stops here either way. Which
	// is why the assertion below is that it *starts again*: that can only
	// happen if the host rebound to the replacement.
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(true)

	// The auto-scan has a 400ms debounce plus a 1s poll before it rebinds.
	await host.page.waitForTimeout(2000)
	await hostPlay(host)

	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'host should be broadcasting from the replacement element',
		})
		.toBe(false)

	await hostPause(host)
	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'and still be broadcasting after that',
		})
		.toBe(true)
})

test('a guest whose play() is refused recovers on the next click', async ({ newClient }) => {
	const room = uniqueRoom()
	const { host, guest } = await twoInARoom(newClient, room)

	/*
	Chrome will not actually apply its autoplay policy here — not headless, not
	headed, not with --autoplay-policy set; a localhost fixture is exempt. So
	the rejection is faked at the DOM level. What is still real, and is the
	point of the test, is the wiring: the extension has to notice the rejection
	and hang a listener that retries on the next genuine user gesture.
	*/
	await guest.page.evaluate(() => {
		const realPlay = HTMLMediaElement.prototype.play
		window.__allowPlay = false
		HTMLMediaElement.prototype.play = function () {
			if (window.__allowPlay) return realPlay.call(this)
			return Promise.reject(
				new DOMException('play() failed because the user did not interact', 'NotAllowedError')
			)
		}
		// Registered before the extension's own gesture listener, so by the time
		// its retry runs the "policy" has let go — exactly the real sequence.
		document.addEventListener('pointerdown', () => {
			window.__allowPlay = true
		}, true)
	})

	await hostPlay(host)

	// It cannot start on its own...
	await guest.page.waitForTimeout(2500)
	expect(await guest.page.evaluate(() => document.querySelector('video').paused)).toBe(true)

	// ...but the click it was waiting for is also the retry trigger.
	await guest.page.mouse.click(5, 5)

	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'a gesture should let the retried play() through',
		})
		.toBe(false)
})

test('leaving stops the guest from following', async ({ newClient }) => {
	const room = uniqueRoom()
	const { host, guest } = await twoInARoom(newClient, room)

	await hostPlay(host)
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	await guest.popup.fill('#new-room-name', room)
	await guest.popup.click('#leave-room')
	await expect(guest.popup.locator('#room-user-count')).toBeEmpty()

	await hostPause(host)
	await guest.page.waitForTimeout(2000)
	expect(await guest.page.evaluate(() => document.querySelector('video').paused)).toBe(false)
})
