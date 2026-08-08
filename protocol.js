// Protocol-v2 compatibility lives here so both nested envelopes and legacy
// flat payloads can be verified without loading a browser content script.
export const normalizePlaybackPayload = (data = {}) => {
	if (data.version !== 2 || !data.playback) return data
	return {
		...data,
		timestamp: data.timestamp ?? data.playback.positionMs / 1000,
		timestampMs: data.timestampMs ?? data.playback.positionMs,
		tms: data.tms ?? data.capturedAtMs,
		mediaState: data.mediaState ?? data.playback.state,
		playbackRate: data.playbackRate ?? data.playback.rate,
		isMuted: data.isMuted ?? data.playback.muted,
		url: data.url ?? data.media?.url,
		durationMs: data.durationMs ?? data.media?.durationMs,
		service: data.service ?? data.source?.service ?? data.source?.adapter,
	}
}

export const withLegacyPlaybackFields = (envelope, legacy = {}) => ({
	...legacy,
	...envelope,
	timestamp: legacy.timestamp ?? envelope.playback.positionMs / 1000,
	timestampMs: legacy.timestampMs ?? envelope.playback.positionMs,
	tms: legacy.tms ?? envelope.capturedAtMs,
	mediaState: legacy.mediaState ?? envelope.playback.state,
	playbackRate: legacy.playbackRate ?? envelope.playback.rate,
	isMuted: legacy.isMuted ?? envelope.playback.muted,
	url: legacy.url ?? envelope.media?.url,
	durationMs: legacy.durationMs ?? envelope.media?.durationMs,
	service: legacy.service ?? envelope.source?.service ?? envelope.source?.adapter,
})

export class PlaybackSequenceGate {
	#lastSequence = 0

	get lastSequence() {
		return this.#lastSequence
	}

	accept(data = {}) {
		if (!Number.isFinite(data.sequence)) return true
		if (data.sequence <= this.#lastSequence) return false
		this.#lastSequence = data.sequence
		return true
	}

	reset() {
		this.#lastSequence = 0
	}
}
