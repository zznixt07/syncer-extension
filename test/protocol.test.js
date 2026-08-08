import test from 'node:test'
import assert from 'node:assert/strict'
import {
	normalizePlaybackPayload,
	PlaybackSequenceGate,
	withLegacyPlaybackFields,
} from '../protocol.js'

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

test('normalizes a nested v2 envelope for the legacy desktop player code', () => {
	const normalized = normalizePlaybackPayload(envelope())
	assert.equal(normalized.version, 2)
	assert.equal(normalized.sequence, 7)
	assert.equal(normalized.timestamp, 12.5)
	assert.equal(normalized.timestampMs, 12_500)
	assert.equal(normalized.tms, 5000)
	assert.equal(normalized.mediaState, 'play')
	assert.equal(normalized.playbackRate, 1.25)
	assert.equal(normalized.isMuted, true)
	assert.equal(normalized.url, 'https://fixture.test/one')
	assert.equal(normalized.durationMs, 60_000)
	assert.equal(normalized.service, 'web')
})

test('v2 normalization preserves explicit legacy values including zero and false', () => {
	const normalized = normalizePlaybackPayload(envelope({
		timestamp: 0,
		timestampMs: 0,
		mediaState: 'pause',
		playbackRate: 0,
		isMuted: false,
		url: '',
		durationMs: 0,
		service: 'legacy-service',
	}))
	assert.deepEqual(
		{
			timestamp: normalized.timestamp,
			timestampMs: normalized.timestampMs,
			mediaState: normalized.mediaState,
			playbackRate: normalized.playbackRate,
			isMuted: normalized.isMuted,
			url: normalized.url,
			durationMs: normalized.durationMs,
			service: normalized.service,
		},
		{ timestamp: 0, timestampMs: 0, mediaState: 'pause', playbackRate: 0, isMuted: false, url: '', durationMs: 0, service: 'legacy-service' },
	)
})

test('legacy flat payloads remain valid fallback input', () => {
	const legacy = { timestamp: 9.5, tms: 1000, mediaState: 'pause', playbackRate: 1, url: 'https://legacy.test' }
	assert.equal(normalizePlaybackPayload(legacy), legacy)
})

test('outgoing v2 snapshots retain generated legacy fields and service-specific metadata', () => {
	const payload = withLegacyPlaybackFields(envelope(), { nodeId: 43, playlistID: 'playlist:one', songURI: 'spotify:track:one' })
	assert.equal(payload.version, 2)
	assert.equal(payload.timestamp, 12.5)
	assert.equal(payload.timestampMs, 12_500)
	assert.equal(payload.tms, 5000)
	assert.equal(payload.mediaState, 'play')
	assert.equal(payload.playbackRate, 1.25)
	assert.equal(payload.isMuted, true)
	assert.equal(payload.nodeId, 43)
	assert.equal(payload.playlistID, 'playlist:one')
	assert.equal(payload.songURI, 'spotify:track:one')
})

test('sequence gate rejects duplicate and stale events across media event types', () => {
	const gate = new PlaybackSequenceGate()
	assert.equal(gate.accept({ sequence: 4 }), true)
	assert.equal(gate.accept({ sequence: 4 }), false)
	assert.equal(gate.accept({ sequence: 3 }), false)
	assert.equal(gate.accept({ sequence: 5 }), true)
	assert.equal(gate.lastSequence, 5)
})

test('legacy unordered events remain accepted and room changes reset ordering', () => {
	const gate = new PlaybackSequenceGate()
	assert.equal(gate.accept({}), true)
	assert.equal(gate.accept({ sequence: Number.NaN }), true)
	assert.equal(gate.accept({ sequence: 10 }), true)
	gate.reset()
	assert.equal(gate.lastSequence, 0)
	assert.equal(gate.accept({ sequence: 1 }), true)
})
