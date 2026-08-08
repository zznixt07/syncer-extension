import {
	MAX_NUDGE_ATTEMPTS,
	NUDGE_DURATION_MS,
	decideCorrection,
	targetTimeFor,
	// relative so it resolves both from the extension origin and from Node
} from './sync-math.js'

/*
Applies remote media state to a video element, and owns the nudge lifecycle
that sync-math.js only decides about.

Everything environmental is injected — the clock, the timers, the "we need a
user gesture" plumbing and the reporting — so this can be driven against a fake
video in Node. It touches nothing but the video object it is given.
*/
export class MediaController {
	constructor({
		now = () => Date.now(),
		setTimer = setTimeout,
		clearTimer = clearTimeout,
		// called with true when playback is blocked, false once it recovers
		onPlaybackBlocked = () => {},
		// hand us a way to retry after the next user gesture; return a cleanup fn
		onGestureNeeded = null,
		log = () => {},
	} = {}) {
		this.video = null
		this.now = now
		this.setTimer = setTimer
		this.clearTimer = clearTimer
		this.onPlaybackBlocked = onPlaybackBlocked
		this.onGestureNeeded = onGestureNeeded
		this.log = log

		this._nudgeTimer = null
		this._nudgeAttempts = 0
		this._nudgeBaseRate = 1
		this._pendingGestureRetry = false
	}

	// Swapping elements (SPA navigation) abandons any correction in flight.
	setVideo(video) {
		if (this.video === video) return
		this.cancelNudge()
		this.video = video
		this._nudgeAttempts = 0
	}

	get isNudging() {
		return this._nudgeTimer !== null
	}

	get nudgeAttempts() {
		return this._nudgeAttempts
	}

	isLive() {
		const duration = this.video?.duration
		return !isFinite(duration) || duration === 0
	}

	cancelNudge() {
		if (!this._nudgeTimer) return
		this.clearTimer(this._nudgeTimer)
		this._nudgeTimer = null
		if (this.video) this.video.playbackRate = this._nudgeBaseRate
	}

	// Returns true if it took responsibility for the drift, false to fall back
	// to a seek.
	applyNudge(decision) {
		const video = this.video
		// Drop any running timer without restoring the rate — we're about to
		// set a new one.
		if (this._nudgeTimer) {
			this.clearTimer(this._nudgeTimer)
			this._nudgeTimer = null
		}
		this._nudgeBaseRate = decision.base
		video.preservesPitch = true
		video.playbackRate = decision.rate

		// Some players refuse or immediately revert the change. Read it back
		// rather than assuming it stuck.
		if (Math.abs(video.playbackRate - decision.rate) > 0.001) {
			video.playbackRate = decision.base
			// Don't keep fighting this player.
			this._nudgeAttempts = MAX_NUDGE_ATTEMPTS
			return false
		}

		this._nudgeAttempts++
		this._nudgeTimer = this.setTimer(() => {
			this._nudgeTimer = null
			video.playbackRate = this._nudgeBaseRate
		}, NUDGE_DURATION_MS)
		return true
	}

	/*
	Programmatic play() is rejected when the page has had no user gesture yet.
	Report it, and retry on the next interaction — that is exactly the gesture
	the autoplay policy was waiting for.
	*/
	async play() {
		const video = this.video
		if (!video) return false
		try {
			await video.play()
			this._pendingGestureRetry = false
			this.onPlaybackBlocked(false)
			return true
		} catch (e) {
			this.log('play() was blocked', e)
			this.onPlaybackBlocked(true)
			if (!this._pendingGestureRetry && this.onGestureNeeded) {
				this._pendingGestureRetry = true
				this.onGestureNeeded(() => {
					this._pendingGestureRetry = false
					if (this.video && this.video.paused) this.play()
				})
			}
			return false
		}
	}

	correctPosition(data) {
		const video = this.video
		const targetTime = targetTimeFor(data, this.now())
		const decision = decideCorrection({
			currentTime: video.currentTime,
			targetTime,
			roomRate: data.playback.rate,
			isLive: this.isLive(),
			isPaused: video.paused,
			nudgeAttempts: this._nudgeAttempts,
		})

		if (decision.action === 'nudge') {
			// Too small to be worth a stutter — close it by running slightly
			// off-speed, and only seek if the player won't cooperate.
			if (!this.applyNudge(decision)) video.currentTime = targetTime
		} else if (decision.action === 'seek') {
			this.cancelNudge()
			// A real seek starts fresh; a fallback seek must not, or a player
			// that refuses rate changes gets retried forever.
			if (decision.reason === 'drift') this._nudgeAttempts = 0
			video.currentTime = targetTime
		} else {
			// In sync. Reset so a later drift gets a fresh set of attempts.
			this.cancelNudge()
			this._nudgeAttempts = 0
		}
		return decision
	}

	async applyRemoteState(data) {
		const video = this.video
		if (!video) return false

		if (Number.isFinite(data.playback.positionMs)) this.correctPosition(data)

		if (data.playback.state === 'buffer' && !video.paused) {
			this.cancelNudge()
			video.pause()
		} else if (data.playback.state === 'play' && video.paused) {
			await this.play()
		} else if (data.playback.state === 'pause' && !video.paused) {
			this.cancelNudge()
			video.pause()
		}

		if (Number.isFinite(data.playback.rate)) {
			if (this._nudgeTimer) {
				// Applying it now would wipe the correction on the very next
				// event and it would never converge. Just keep the restore
				// target current in case the host changes speed mid-nudge.
				this._nudgeBaseRate = data.playback.rate
			} else {
				video.playbackRate = data.playback.rate
			}
		}
		if (data.playback.muted !== undefined) video.muted = data.playback.muted
		return true
	}
}
