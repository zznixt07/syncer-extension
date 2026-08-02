/* Stand-ins for the browser pieces MediaController touches. */

export class FakeVideo {
	constructor({ currentTime = 0, duration = 600, paused = false, playbackRate = 1 } = {}) {
		this.currentTime = currentTime
		this.duration = duration
		this.paused = paused
		this.muted = false
		this.preservesPitch = false
		this._playbackRate = playbackRate

		// Set to mimic a player that manages playbackRate itself (hls.js,
		// low-latency live) and reverts anything we set.
		this.revertsRateChanges = false
		// Set to make play() reject, like the autoplay policy does.
		this.blockPlay = false
		this.playCalls = 0
		this.pauseCalls = 0
	}

	get playbackRate() {
		return this._playbackRate
	}

	set playbackRate(value) {
		this._playbackRate = this.revertsRateChanges ? 1 : value
	}

	async play() {
		this.playCalls++
		if (this.blockPlay) throw new Error('play() failed because the user did not interact')
		this.paused = false
	}

	pause() {
		this.pauseCalls++
		this.paused = true
	}
}

/* A manual clock, so nudge timers resolve when the test says so. */
export class FakeTimers {
	constructor() {
		this.time = 0
		this._next = 1
		this._scheduled = new Map()
	}

	setTimer = (fn, delay) => {
		const id = this._next++
		this._scheduled.set(id, { fn, at: this.time + delay })
		return id
	}

	clearTimer = (id) => {
		this._scheduled.delete(id)
	}

	advance(ms) {
		this.time += ms
		for (const [id, task] of [...this._scheduled]) {
			if (task.at <= this.time) {
				this._scheduled.delete(id)
				task.fn()
			}
		}
	}

	get pending() {
		return this._scheduled.size
	}
}

/* Captures the gesture callback so a test can fire it on demand. */
export const gestureCapture = () => {
	const state = { retry: null, calls: 0 }
	return {
		state,
		onGestureNeeded: (retry) => {
			state.calls++
			state.retry = retry
		},
	}
}
