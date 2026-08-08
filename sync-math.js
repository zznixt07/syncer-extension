/*
Pure sync arithmetic — no DOM, no extension APIs, so it can be unit tested.
The caller owns every side effect: seeking, setting playbackRate, timers.
*/

// Beyond this, a seek is worth its cost.
export const DRIFT_HARD_SEEK_S = 0.35
// Already close enough; leave it alone.
export const DRIFT_IGNORE_S = 0.05
// ±2%: inaudible, and preservesPitch keeps it clean.
export const NUDGE_FACTOR = 0.02
export const NUDGE_DURATION_MS = 3000
// Attempts before giving up on a player that won't hold a rate change.
export const MAX_NUDGE_ATTEMPTS = 2

/*
Where the sender should be by now. Only advance a playing sender by the
transit time — a paused sender's clock isn't moving, so adding latency to it
would push us ahead of them.
*/
export const targetTimeFor = (data, nowMs) => {
	const inFlightS = data.playback.state === 'play' ? (nowMs - data.capturedAtMs) / 1000 : 0
	return data.playback.positionMs / 1000 + inFlightS
}

/*
Decide how to close the gap. Returns one of:
  { action: 'ignore' }                       already in sync
  { action: 'seek', reason: 'drift' }        far enough that a seek is warranted
  { action: 'seek', reason: 'no-nudge' }     can't nudge here; seek is the fallback
  { action: 'nudge', rate }                  run slightly off-speed instead

'reason' matters: after a drift seek the attempt counter should reset, but
after a no-nudge fallback it must not, or a player that refuses rate changes
gets retried forever.
*/
export const decideCorrection = ({
	currentTime,
	targetTime,
	roomRate,
	isLive,
	isPaused,
	nudgeAttempts = 0,
}) => {
	const drift = currentTime - targetTime
	const magnitude = Math.abs(drift)

	if (magnitude >= DRIFT_HARD_SEEK_S) {
		return { action: 'seek', reason: 'drift', drift }
	}
	if (magnitude <= DRIFT_IGNORE_S) {
		return { action: 'ignore', drift }
	}
	// Live players (hls.js, low-latency streams) drive playbackRate themselves
	// to manage the live edge; fighting them oscillates.
	if (isLive || isPaused || nudgeAttempts >= MAX_NUDGE_ATTEMPTS) {
		return { action: 'seek', reason: 'no-nudge', drift }
	}

	// Nudge relative to the room's rate — the host may be watching at 2x.
	const base = Number(roomRate) > 0 ? Number(roomRate) : 1
	// drift > 0 means we are ahead of the host, so slow down.
	const rate = base * (drift > 0 ? 1 - NUDGE_FACTOR : 1 + NUDGE_FACTOR)
	return { action: 'nudge', rate, base, drift }
}
