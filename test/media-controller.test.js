import test from 'node:test'
import assert from 'node:assert/strict'

import { MediaController } from '../media-controller.js'
import { MAX_NUDGE_ATTEMPTS, NUDGE_DURATION_MS, NUDGE_FACTOR } from '../sync-math.js'
import { FakeTimers, FakeVideo, gestureCapture } from './helpers/fakes.js'

const NOW = 1_000_000

// A controller wired to fakes, with the clock frozen so 'tms' arithmetic is exact.
const build = ({ video = new FakeVideo(), blockedCalls = [] } = {}) => {
	const timers = new FakeTimers()
	const gesture = gestureCapture()
	const media = new MediaController({
		now: () => NOW,
		setTimer: timers.setTimer,
		clearTimer: timers.clearTimer,
		onPlaybackBlocked: (blocked) => blockedCalls.push(blocked),
		onGestureNeeded: gesture.onGestureNeeded,
	})
	media.setVideo(video)
	return { media, video, timers, gesture, blockedCalls }
}

// A host event that says "I am at `at` seconds, playing, right now".
const hostAt = (at, over = {}) => ({
	timestamp: at,
	tms: NOW,
	mediaState: 'play',
	playbackRate: 1,
	isMuted: false,
	...over,
})

test('small drift nudges the rate and leaves the position alone', async () => {
	const { media, video } = build({ video: new FakeVideo({ currentTime: 30.2 }) })

	await media.applyRemoteState(hostAt(30))

	assert.equal(video.currentTime, 30.2, 'must not seek')
	assert.equal(video.playbackRate, 1 - NUDGE_FACTOR, 'ahead of host, so slow down')
	assert.equal(video.preservesPitch, true, 'or the audio would change pitch')
	assert.ok(media.isNudging)
})

test('large drift seeks and does not touch the rate', async () => {
	const { media, video } = build({ video: new FakeVideo({ currentTime: 45 }) })

	await media.applyRemoteState(hostAt(30))

	assert.equal(video.currentTime, 30)
	assert.equal(video.playbackRate, 1)
	assert.equal(media.isNudging, false)
})

test('the nudge is reverted once its window elapses', async () => {
	const { media, video, timers } = build({ video: new FakeVideo({ currentTime: 30.2 }) })

	await media.applyRemoteState(hostAt(30))
	assert.equal(video.playbackRate, 1 - NUDGE_FACTOR)

	timers.advance(NUDGE_DURATION_MS)

	assert.equal(video.playbackRate, 1, 'back to the room rate')
	assert.equal(media.isNudging, false)
	assert.equal(timers.pending, 0, 'no timer left behind')
})

test('a player that reverts rate changes falls back to seeking', async () => {
	const video = new FakeVideo({ currentTime: 30.2 })
	video.revertsRateChanges = true // like hls.js managing the live edge
	const { media } = build({ video })

	await media.applyRemoteState(hostAt(30))

	assert.equal(video.currentTime, 30, 'seek, because the nudge did not take')
	assert.equal(media.isNudging, false)
	assert.equal(timersNotNeeded(media), true)
})

// The give-up counter is the guard against fighting such a player forever.
const timersNotNeeded = (media) => media.nudgeAttempts === MAX_NUDGE_ATTEMPTS

test('it stops trying to nudge a player that keeps refusing', async () => {
	const video = new FakeVideo({ currentTime: 30.2 })
	video.revertsRateChanges = true
	const { media } = build({ video })

	await media.applyRemoteState(hostAt(30))
	assert.equal(media.nudgeAttempts, MAX_NUDGE_ATTEMPTS)

	// A later small drift must go straight to a seek, without another attempt.
	video.currentTime = 30.2
	await media.applyRemoteState(hostAt(30))

	assert.equal(video.currentTime, 30)
	assert.equal(media.isNudging, false)
})

test('a real seek clears the give-up counter so nudging can resume', async () => {
	const video = new FakeVideo({ currentTime: 30.2 })
	video.revertsRateChanges = true
	const { media } = build({ video })

	await media.applyRemoteState(hostAt(30))
	assert.equal(media.nudgeAttempts, MAX_NUDGE_ATTEMPTS)

	// A big jump — the host skipped ahead.
	video.revertsRateChanges = false
	video.currentTime = 90
	await media.applyRemoteState(hostAt(30))
	assert.equal(media.nudgeAttempts, 0, 'fresh start after a genuine seek')

	video.currentTime = 30.2
	await media.applyRemoteState(hostAt(30))
	assert.ok(media.isNudging, 'nudging is available again')
})

test('the room rate does not overwrite the nudge that was just applied', async () => {
	// Both happen in one call: correctPosition sets 0.98, then the tail would
	// set playbackRate back to the room's 1 and the drift would never close.
	const { media, video } = build({ video: new FakeVideo({ currentTime: 30.2 }) })

	await media.applyRemoteState(hostAt(30, { playbackRate: 1 }))

	assert.equal(video.playbackRate, 1 - NUDGE_FACTOR, 'nudge survives the same event')
})

test('a host speed change mid-correction re-bases the nudge', async () => {
	const { media, video, timers } = build({ video: new FakeVideo({ currentTime: 30.2 }) })

	await media.applyRemoteState(hostAt(30))
	assert.equal(video.playbackRate, 1 - NUDGE_FACTOR)

	// Host switches to 2x while we are still correcting. Still behind, so we
	// keep correcting — but around 2x now, not around 1x.
	video.currentTime = 30.2
	await media.applyRemoteState(hostAt(30, { playbackRate: 2 }))
	assert.equal(video.playbackRate, 2 * (1 - NUDGE_FACTOR))

	timers.advance(NUDGE_DURATION_MS)
	assert.equal(video.playbackRate, 2, 'restores to the new room rate, not the old one')
})

test('the room rate is applied normally when not nudging', async () => {
	const { media, video } = build({ video: new FakeVideo({ currentTime: 30 }) })

	await media.applyRemoteState(hostAt(30, { playbackRate: 1.5 }))

	assert.equal(video.playbackRate, 1.5)
})

test('a buffering host pauses us and abandons any nudge', async () => {
	const { media, video, timers } = build({ video: new FakeVideo({ currentTime: 30.2 }) })

	await media.applyRemoteState(hostAt(30))
	assert.ok(media.isNudging)

	await media.applyRemoteState(hostAt(30.2, { mediaState: 'buffer' }))

	assert.equal(video.paused, true)
	assert.equal(media.isNudging, false)
	assert.equal(video.playbackRate, 1, 'rate restored, not left off-speed')
	assert.equal(timers.pending, 0)
})

test('a paused host pauses us and abandons any nudge', async () => {
	const { media, video } = build({ video: new FakeVideo({ currentTime: 30.2 }) })

	await media.applyRemoteState(hostAt(30))
	await media.applyRemoteState(hostAt(30.2, { mediaState: 'pause' }))

	assert.equal(video.paused, true)
	assert.equal(media.isNudging, false)
	assert.equal(video.playbackRate, 1)
})

test('a paused host does not have transit time added to its position', async () => {
	// 5s of latency, but the host is paused, so its clock is not moving.
	const { media, video } = build({ video: new FakeVideo({ currentTime: 100, paused: true }) })

	await media.applyRemoteState({
		timestamp: 30,
		tms: NOW - 5000,
		mediaState: 'pause',
		playbackRate: 1,
	})

	assert.equal(video.currentTime, 30, 'exactly where the host is, not 35')
})

test('blocked playback is reported and retried on the next gesture', async () => {
	const video = new FakeVideo({ currentTime: 30, paused: true })
	video.blockPlay = true
	const { media, gesture, blockedCalls } = build({ video })

	await media.applyRemoteState(hostAt(30))

	assert.equal(video.paused, true, 'still stuck')
	assert.deepEqual(blockedCalls, [true], 'the popup/tooltip is told')
	assert.equal(gesture.state.calls, 1, 'waiting for an interaction')

	// The user clicks somewhere; by then the policy lets us play.
	video.blockPlay = false
	await gesture.state.retry()

	assert.equal(video.paused, false)
	assert.deepEqual(blockedCalls, [true, false], 'and told again when it recovers')
})

test('only one gesture listener is registered while a retry is pending', async () => {
	const video = new FakeVideo({ currentTime: 30, paused: true })
	video.blockPlay = true
	const { media, gesture } = build({ video })

	await media.applyRemoteState(hostAt(30))
	await media.applyRemoteState(hostAt(30))
	await media.applyRemoteState(hostAt(30))

	assert.equal(gesture.state.calls, 1)
})

test('successful playback reports unblocked', async () => {
	const video = new FakeVideo({ currentTime: 30, paused: true })
	const { media, blockedCalls } = build({ video })

	await media.applyRemoteState(hostAt(30))

	assert.equal(video.paused, false)
	assert.deepEqual(blockedCalls, [false])
})

test('swapping the video element abandons the correction on the old one', async () => {
	const first = new FakeVideo({ currentTime: 30.2 })
	const { media, timers } = build({ video: first })

	await media.applyRemoteState(hostAt(30))
	assert.ok(media.isNudging)

	const second = new FakeVideo({ currentTime: 30 })
	media.setVideo(second)

	assert.equal(first.playbackRate, 1, 'old element left at the room rate')
	assert.equal(media.isNudging, false)
	assert.equal(media.nudgeAttempts, 0)
	assert.equal(timers.pending, 0, 'no timer still pointing at the old element')
})

test('a live stream seeks rather than fighting the player for the rate', async () => {
	// Infinite duration is how a live stream presents itself.
	const video = new FakeVideo({ currentTime: 30.2, duration: Infinity })
	const { media } = build({ video })

	await media.applyRemoteState(hostAt(30))

	assert.equal(video.currentTime, 30)
	assert.equal(media.isNudging, false)
})

test('being in sync touches nothing', async () => {
	const { media, video } = build({ video: new FakeVideo({ currentTime: 30.01 }) })

	await media.applyRemoteState(hostAt(30))

	assert.equal(video.currentTime, 30.01, 'no seek')
	assert.equal(video.playbackRate, 1, 'no nudge')
	assert.equal(media.isNudging, false)
})

test('mute state follows the room', async () => {
	const { media, video } = build({ video: new FakeVideo({ currentTime: 30 }) })

	await media.applyRemoteState(hostAt(30, { isMuted: true }))

	assert.equal(video.muted, true)
})

test('with no video element it reports that it did nothing', async () => {
	const { media } = build()
	media.setVideo(null)

	assert.equal(await media.applyRemoteState(hostAt(30)), false)
})
