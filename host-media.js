export const hostMediaFallbackFromEvent = (event = {}) => {
	const data = event.data || event
	const media = data.media || {}
	const source = data.source || {}
	if (media.url || data.url) return null

	const title = media.title || data.title
	const artist = media.artist || data.artist
	if (!title && !artist) return null

	return {
		service: source.service || data.service || 'media',
		applicationId: source.applicationId,
		title,
		artist,
		durationMs: media.durationMs ?? data.durationMs,
	}
}
