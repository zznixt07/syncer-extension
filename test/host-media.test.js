import test from 'node:test'
import assert from 'node:assert/strict'
import { hostMediaFallbackFromEvent } from '../host-media.js'

test('extracts manual-navigation metadata from an Android native session', () => {
	const result = hostMediaFallbackFromEvent({
		data: {
			source: { service: 'youtube', applicationId: 'com.google.android.youtube' },
			media: { title: 'A video', artist: 'A channel', durationMs: 1386000 },
		},
	})
	assert.deepEqual(result, {
		service: 'youtube',
		applicationId: 'com.google.android.youtube',
		title: 'A video',
		artist: 'A channel',
		durationMs: 1386000,
	})
})

test('does not show the fallback when the host supplied a navigable URL', () => {
	assert.equal(hostMediaFallbackFromEvent({
		data: { media: { title: 'A video', url: 'https://www.youtube.com/watch?v=abc' } },
	}), null)
})
