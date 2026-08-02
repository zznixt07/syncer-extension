import {
	createRoom,
	expect,
	hostPause,
	hostPlay,
	joinRoom,
	test,
	videoState,
} from './harness.js'

let roomCounter = 0
const uniqueRoom = () => `e2e-room-${process.pid}-${roomCounter++}`

test('a guest follows the host pausing and playing', async ({ newClient }) => {
	const room = uniqueRoom()

	const host = await newClient('host')
	await createRoom(host, room)

	const guest = await newClient('guest')
	await joinRoom(guest, room)

	// Both are watching before anything is asked of them.
	await host.page.evaluate(() => document.querySelector('video').play())
	await expect.poll(async () => (await videoState(guest.page)).paused).toBe(false)

	await hostPause(host)
	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'guest should pause when the host does',
		})
		.toBe(true)

	await hostPlay(host)
	await expect
		.poll(async () => (await videoState(guest.page)).paused, {
			message: 'guest should resume when the host does',
		})
		.toBe(false)
})

test('the popup reports how many other people are in the room', async ({ newClient }) => {
	const room = uniqueRoom()

	const host = await newClient('host')
	await createRoom(host, room)
	await expect(host.popup.locator('#room-user-count')).toHaveText(
		"No one else here yet · you're the host"
	)

	const guest = await newClient('guest')
	await joinRoom(guest, room)

	// The guest sees the host...
	await expect(guest.popup.locator('#room-user-count')).toHaveText(
		"1 other present · you're a guest"
	)
	// ...and the host's already-open popup updates without being touched. This
	// is the whole point of the live push.
	await expect(host.popup.locator('#room-user-count')).toHaveText(
		"1 other present · you're the host"
	)
})
