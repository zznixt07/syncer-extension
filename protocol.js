const PLAYBACK_STATES = new Set(['play', 'pause', 'buffer', 'ended'])
const PLATFORMS = new Set(['desktop', 'android', 'ios'])
const ADAPTERS = new Set(['html', 'media-session', 'youtube', 'spotify'])
const CAPABILITIES = ['canPlay', 'canPause', 'canSeek', 'canSetRate', 'canLoadMedia']

export const isPlaybackEnvelopeV2 = (data) => Boolean(
	data && data.version === 2 && Number.isFinite(data.capturedAtMs) &&
	data.source && PLATFORMS.has(data.source.platform) && ADAPTERS.has(data.source.adapter) &&
	data.media && typeof data.media.isLive === 'boolean' &&
	data.playback && PLAYBACK_STATES.has(data.playback.state) &&
	Number.isFinite(data.playback.positionMs) && Number.isFinite(data.playback.rate) &&
	data.capabilities && CAPABILITIES.every((key) => typeof data.capabilities[key] === 'boolean')
)

// Incoming room events are v2-only. Returning null lets content scripts ignore
// malformed events without allowing them to disturb the active player.
export const normalizePlaybackPayload = (data) => isPlaybackEnvelopeV2(data) ? data : null

export class PlaybackSequenceGate {
	#lastSequence = 0

	get lastSequence() {
		return this.#lastSequence
	}

	accept(data = {}) {
		if (!Number.isFinite(data.sequence) || data.sequence <= this.#lastSequence) return false
		this.#lastSequence = data.sequence
		return true
	}

	reset() {
		this.#lastSequence = 0
	}
}
