import test from 'node:test'
import assert from 'node:assert/strict'

import {
	DRIFT_HARD_SEEK_S,
	DRIFT_IGNORE_S,
	MAX_NUDGE_ATTEMPTS,
	NUDGE_FACTOR,
	decideCorrection,
	targetTimeFor,
} from 'syncer-extension-core'

// Defaults for the fields a given test doesn't care about.
const decide = (over) =>
	decideCorrection({
		currentTime: 100,
		targetTime: 100,
		roomRate: 1,
		isLive: false,
		isPaused: false,
		nudgeAttempts: 0,
		...over,
	})

test('targetTimeFor advances a playing sender by the transit time', () => {
	const data = { capturedAtMs: 1_000_000, playback: { positionMs: 50_000, state: 'play' } }
	// 400ms in flight
	assert.equal(targetTimeFor(data, 1_000_400), 50.4)
})

test('targetTimeFor does not advance a paused sender', () => {
	// A paused sender's clock isn't moving; adding latency would push us ahead.
	const data = { capturedAtMs: 1_000_000, playback: { positionMs: 50_000, state: 'pause' } }
	assert.equal(targetTimeFor(data, 1_005_000), 50)
})

test('targetTimeFor does not advance a buffering sender', () => {
	const data = { capturedAtMs: 1_000_000, playback: { positionMs: 50_000, state: 'buffer' } }
	assert.equal(targetTimeFor(data, 1_005_000), 50)
})

/*
The thresholds are compared with floats, so drift landing exactly on one is
decided by rounding (100 + 0.35 is 100.34999999999999). Which side it falls on
doesn't matter in practice, so these assert just inside and just outside
instead of on the boundary itself.
*/
const JUST_INSIDE = 0.005

test('drift below the ignore threshold is left alone', () => {
	assert.equal(decide({ currentTime: 100.02 }).action, 'ignore')
	assert.equal(decide({ currentTime: 99.97 }).action, 'ignore')
	assert.equal(decide({ currentTime: 100 + DRIFT_IGNORE_S - JUST_INSIDE }).action, 'ignore')
})

test('drift just past the ignore threshold is corrected', () => {
	assert.notEqual(decide({ currentTime: 100 + DRIFT_IGNORE_S + JUST_INSIDE }).action, 'ignore')
})

test('drift beyond the hard threshold seeks', () => {
	const past = decide({ currentTime: 100 + DRIFT_HARD_SEEK_S + JUST_INSIDE })
	assert.equal(past.action, 'seek')
	assert.equal(past.reason, 'drift')

	assert.equal(decide({ currentTime: 105 }).action, 'seek')
	assert.equal(decide({ currentTime: 95 }).action, 'seek')
})

test('drift just under the hard threshold nudges instead', () => {
	assert.equal(decide({ currentTime: 100 + DRIFT_HARD_SEEK_S - JUST_INSIDE }).action, 'nudge')
})

test('middling drift nudges instead of seeking', () => {
	const d = decide({ currentTime: 100.2 })
	assert.equal(d.action, 'nudge')
})

test('running ahead slows down, running behind speeds up', () => {
	// ahead of the host
	assert.equal(decide({ currentTime: 100.2 }).rate, 1 - NUDGE_FACTOR)
	// behind the host
	assert.equal(decide({ currentTime: 99.8 }).rate, 1 + NUDGE_FACTOR)
})

test('nudge is relative to the room rate, not to 1.0', () => {
	// host watching at 2x
	const ahead = decide({ currentTime: 100.2, roomRate: 2 })
	assert.equal(ahead.base, 2)
	assert.equal(ahead.rate, 2 * (1 - NUDGE_FACTOR))

	const behind = decide({ currentTime: 99.8, roomRate: 2 })
	assert.equal(behind.rate, 2 * (1 + NUDGE_FACTOR))
})

test('a missing or nonsense room rate falls back to 1x', () => {
	for (const roomRate of [undefined, null, 0, NaN, -1, 'x']) {
		assert.equal(decide({ currentTime: 100.2, roomRate }).base, 1, `roomRate=${roomRate}`)
	}
})

test('live streams seek rather than fight the player for the rate', () => {
	const d = decide({ currentTime: 100.2, isLive: true })
	assert.equal(d.action, 'seek')
	assert.equal(d.reason, 'no-nudge')
})

test('a paused video seeks rather than nudges', () => {
	const d = decide({ currentTime: 100.2, isPaused: true })
	assert.equal(d.action, 'seek')
	assert.equal(d.reason, 'no-nudge')
})

test('gives up nudging after the attempt limit', () => {
	assert.equal(decide({ currentTime: 100.2, nudgeAttempts: MAX_NUDGE_ATTEMPTS - 1 }).action, 'nudge')

	const d = decide({ currentTime: 100.2, nudgeAttempts: MAX_NUDGE_ATTEMPTS })
	assert.equal(d.action, 'seek')
	// not 'drift' — the caller must not reset the counter here, or a player
	// that refuses rate changes gets retried forever
	assert.equal(d.reason, 'no-nudge')
})

test('a big drift still seeks even when nudging is exhausted', () => {
	const d = decide({ currentTime: 105, nudgeAttempts: MAX_NUDGE_ATTEMPTS, isLive: true })
	assert.equal(d.action, 'seek')
	// 'drift' so the caller resets the counter and later small drifts can nudge again
	assert.equal(d.reason, 'drift')
})

test('drift is reported signed, positive when ahead of the host', () => {
	assert.ok(decide({ currentTime: 100.2 }).drift > 0)
	assert.ok(decide({ currentTime: 99.8 }).drift < 0)
})

test('end to end: a guest 200ms behind a playing host gets a speed-up', () => {
	const now = 1_000_500
	const fromHost = { capturedAtMs: 1_000_000, playback: { positionMs: 30_000, state: 'play', rate: 1 } }
	const targetTime = targetTimeFor(fromHost, now) // 30.5

	const d = decideCorrection({
		currentTime: 30.3,
		targetTime,
		roomRate: fromHost.playback.rate,
		isLive: false,
		isPaused: false,
		nudgeAttempts: 0,
	})

	assert.equal(d.action, 'nudge')
	assert.equal(d.rate, 1 + NUDGE_FACTOR)
})
