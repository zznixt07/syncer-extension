import test from 'node:test'
import assert from 'node:assert/strict'
import { isPlaybackEnvelopeV2, normalizePlaybackPayload, PlaybackSequenceGate } from '../protocol.js'

const envelope = (overrides = {}) => ({
	version: 2,
	sequence: 7,
	capturedAtMs: 5000,
	source: { platform: 'android', adapter: 'html', service: 'web' },
	media: { canonicalId: 'fixture:one', url: 'https://fixture.test/one', durationMs: 60_000, isLive: false },
	playback: { state: 'play', positionMs: 12_500, rate: 1.25, muted: true },
	capabilities: { canPlay: true, canPause: true, canSeek: true, canSetRate: true, canLoadMedia: true },
	...overrides,
})

test('accepts a complete protocol-v2 envelope without flattening it', () => {
	const payload = envelope()
	assert.equal(isPlaybackEnvelopeV2(payload), true)
	assert.equal(normalizePlaybackPayload(payload), payload)
	assert.equal(payload.playback.positionMs, 12_500)
})

test('rejects legacy flat payloads', () => {
	assert.equal(normalizePlaybackPayload({ timestamp: 9.5, tms: 1000, mediaState: 'pause' }), null)
})

test('rejects incomplete and invalid v2 envelopes', () => {
	assert.equal(isPlaybackEnvelopeV2(envelope({ playback: { state: 'play', rate: 1 } })), false)
	assert.equal(isPlaybackEnvelopeV2(envelope({ source: { platform: 'watch', adapter: 'html' } })), false)
	assert.equal(isPlaybackEnvelopeV2(envelope({ capabilities: { canPlay: true } })), false)
})

test('sequence gate rejects missing, duplicate, and stale sequences', () => {
	const gate = new PlaybackSequenceGate()
	assert.equal(gate.accept({}), false)
	assert.equal(gate.accept({ sequence: 4 }), true)
	assert.equal(gate.accept({ sequence: 4 }), false)
	assert.equal(gate.accept({ sequence: 3 }), false)
	assert.equal(gate.accept({ sequence: 5 }), true)
	assert.equal(gate.lastSequence, 5)
})

test('room changes reset sequence ordering', () => {
	const gate = new PlaybackSequenceGate()
	assert.equal(gate.accept({ sequence: 10 }), true)
	gate.reset()
	assert.equal(gate.lastSequence, 0)
	assert.equal(gate.accept({ sequence: 1 }), true)
})
