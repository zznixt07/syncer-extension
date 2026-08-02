const sendMessageToBG = async (message) => {
    return new Promise((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = (event) => {
            channel.port1.close()
            resolve(event.data)
        }
        window.postMessage(
            { type: 'syncer-extension-mcs-to-bg', data: message },
            '*',
            [channel.port2]
        )
    })
}

const sendLogToBG = async (message) => {
	// return await sendMessageToBG({ type: 'log', data: message })
}

let VID_ELEM = null
// Only the owner broadcasts media events; guests apply them. Tracked here so
// the video rescan knows whether re-attaching listeners is correct.
let IS_OWNER = false
let _scanObserver = null
let _scanTimer = null

// The top-frame URL — needed because this script may run inside an iframe
// where window.location.href is about:blank or the iframe's own URL.
let TOP_FRAME_URL = null
try {
	TOP_FRAME_URL = window.top.location.href
} catch (_) {
	// cross-origin iframe — will be fetched from background
}
if (!TOP_FRAME_URL || TOP_FRAME_URL === 'about:blank') {
	const resp = await sendMessageToBG({ type: 'get_top_frame_url' })
	if (resp) TOP_FRAME_URL = resp
}

// Returns the current top-frame URL. For same-origin iframes or top frame,
// reads window.top.location.href directly (catches SPA navigations).
// For cross-origin iframes, falls back to asking the background.
const getTopURL = async () => {
	try {
		return window.top.location.href
	} catch (_) {
		const resp = await sendMessageToBG({ type: 'get_top_frame_url' })
		if (resp) TOP_FRAME_URL = resp
		return TOP_FRAME_URL || window.location.href
	}
}

// Synchronous version — uses cached TOP_FRAME_URL (good enough for event handlers)
const getTopURLSync = () => {
	try {
		return window.top.location.href
	} catch (_) {
		return TOP_FRAME_URL || window.location.href
	}
}

// Navigate the top-level tab (not just the iframe) to a new URL
const navigateTab = async (url) => {
	await sendMessageToBG({ type: 'navigate_tab', data: { url } })
}

const findBestVideoElement = () => {
    let el = document.querySelector('video[src], video > source[src], video')
    if (el && el.tagName === 'SOURCE') el = el.parentElement
	// sendMessageToBG({ type: 'log', data: `found video element: ${!!el}, src: ${el?.currentSrc || el?.src || 'no src'}, url: ${window.location.href}` })
    return el || null
}

const recheckVideoElement = () => {
    const next = findBestVideoElement()
    if (!next) return { found: false }

    // avoid duplicate listeners if same node
    if (VID_ELEM !== next) {
        if (VID_ELEM) removeVideoEvents()
        VID_ELEM = next
		// console.log('video element updated:', VID_ELEM)
        // Only the owner broadcasts. Re-attaching for a guest would turn it
        // into a second source of truth and echo every applied event back.
        if (IS_OWNER) listenToMediaEvents()
    }
    return { found: true }
}

// The observer fires constantly on heavy players, and re-querying the DOM on
// every mutation is wasteful — coalesce into one check per interval.
let _scanDebounceTimer = null
const debouncedRecheck = () => {
    if (_scanDebounceTimer) return
    _scanDebounceTimer = setTimeout(() => {
        _scanDebounceTimer = null
        recheckVideoElement()
    }, 400)
}

// SPAs (YouTube playlists, next episode) replace the <video> node outright.
// Without this the listeners stay bound to a detached element and sync dies
// silently until the room is rejoined.
const startAutoVideoScan = () => {
    recheckVideoElement()

    if (!_scanObserver) {
        _scanObserver = new MutationObserver(debouncedRecheck)
        _scanObserver.observe(document.documentElement || document, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src'],
        })
    }

    // fallback polling for JS-heavy players that swap sources without
    // mutating anything we observe
    let tries = 0
    if (_scanTimer) clearInterval(_scanTimer)
    _scanTimer = setInterval(() => {
        const res = recheckVideoElement()
        tries++
        if (res.found || tries > 90) {
            clearInterval(_scanTimer)
            _scanTimer = null
        }
    }, 1000)
}

const stopAutoVideoScan = () => {
    if (_scanObserver) {
        _scanObserver.disconnect()
        _scanObserver = null
    }
    if (_scanTimer) {
        clearInterval(_scanTimer)
        _scanTimer = null
    }
    if (_scanDebounceTimer) {
        clearTimeout(_scanDebounceTimer)
        _scanDebounceTimer = null
    }
}

const connectToWebSocket = async () => {
	return await sendMessageToBG({
		type: 'websocket_connect',
	})
}

const isYoutubeClient = () =>
	window.location.host.startsWith('www.youtube.com')
const isYoutubeService = (data) => data.service === 'youtube'
const isSpotifyClient = () => window.location.host.startsWith('open.spotify')
const isSpotifyService = (data) => data.service === 'spotify'

// console.log(await sendMessageToBG({ type: 'log', data: Array.from(document.querySelectorAll('video')).map(e => e.innerHTML) }))


const log = (...msg) => {
	// console.log('CS:', ...msg)
}

const correctedNow = () => {
	return Date.now() + OFFSET_TIME_MS
}

const remoteTimeExchangeViaBG = async () => {
	const resp = await sendMessageToBG({ type: 'request_remote_time' })
	return resp?.serverTime || Date.now()
}

// asks the remote/server/owner for its current epoch ms time and returns it.
const estimateClockOffset = async () => {
	const t0 = Date.now()
	const remoteTime = await remoteTimeExchangeViaBG()
	const t1 = Date.now()
	const rtt = t1 - t0
	const offset = remoteTime - (t0 + rtt / 2)
	return { offset, rtt }
}

const getURLRedirectInfo = async (url) => {
	const resp = await sendMessageToBG({
		type: 'get_url_redirect_info',
		data: { url: url },
	})
	return resp
}

const setPrevRoomInLS = async (roomName) => {
	// localStorage.setItem(STORAGE_KEY, roomName)
	await sendMessageToBG({ type: 'set_prev_room', data: roomName })
}

const getPrevRoomFromLS = async () => {
	// return localStorage.getItem(STORAGE_KEY)
	return await sendMessageToBG({ type: 'get_prev_room' })
}

const removePrevRoomFromLS = async () => {
	// localStorage.removeItem(STORAGE_KEY)
	await sendMessageToBG({ type: 'remove_prev_room' })
}

let OFFSET_TIME_MS = 0
let _initialized = false

const initializeFrame = async () => {
	if (_initialized) return
	_initialized = true

	const clockOffset = await estimateClockOffset()
	OFFSET_TIME_MS = clockOffset.offset

	currRoom = await sendMessageToBG({
		type: 'get_storage',
		data: { key: CURR_ROOM_ID },
	})
	currUrl = getTopURLSync()
	const prevRoomName = await getPrevRoomFromLS()

	if (prevRoomName) {
		await removePrevRoomFromLS()
		const result = await connectToWebSocket()
		if (result.success) {
			await joinRoom(prevRoomName)
			const timeoutMs = 1000
			setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 2.2)
			setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 5.1)
			setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 7.9)
		}
	}
}

const spotifyRootElemSelector = '[data-testid="root"]'
let CURR_SONG_URI = ''
let CURR_SONG_URI_OWNERPOV = ''
let PLAYER_API_STORE


const CURR_ROOM_ID = 'currRoom'
let currRoom = null
let currUrl = getTopURLSync()

const getPropertyBeginningWith = (propPrefix, elem) => {
	const reactProps = Object.getOwnPropertyNames(elem)
	// log(reactProps)
	let requiredProp = null
	for (const prop of reactProps) {
		if (prop.startsWith(propPrefix)) {
			requiredProp = prop
			break
		}
	}
	return requiredProp
}

const getPlayerAPIFn = () => {
	if (PLAYER_API_STORE) return PLAYER_API_STORE
	const rootElem = document.querySelector(spotifyRootElemSelector)
	const requiredProp = getPropertyBeginningWith('__reactFiber$', rootElem)
	if (!requiredProp) {
		log('reactFiber prop name not found')
		return
	}

	let topMostComponent = rootElem[requiredProp]
	if (!topMostComponent) {
		log('reactFiber prop on root elem not found')
		return
	}
	while (true) {
		if (!topMostComponent.return) break
		topMostComponent = topMostComponent.return
	}
	PLAYER_API_STORE =
		topMostComponent.child.memoizedProps.platform.getPlayerAPI()
	return PLAYER_API_STORE
}

const handleSpotifyStreamEvent = (recv, streamChanged) => {
	const playerAPI = getPlayerAPIFn()

	if (streamChanged) {
		const playerState = playerAPI.getState()
		const isRecvSongAlreadyPlaying =
			playerState.context.uri === recv.playlistID &&
			playerState.item.uri === recv.songURI
		if (!isRecvSongAlreadyPlaying) {
			log('playing new song', recv.songURI, recv.playlistID)
			// calling this method automatically seeks the song to 00:00
			// and the play() method is handled async-ishly while the seekTo() is handled sync-ishly
			// this causes the invokation of seekTo() method, even after play(), to be useless.

			playerAPI.play(
				{ uri: recv.playlistID },
				{},
				{ skipTo: { uri: recv.songURI } }
			)
			// return and dont seek.
			return
		}
		log('song already playing')
	}
	if (recv.mediaState === 'play') {
		log('resuming song')
		playerAPI.resume()
	} else if (recv.mediaState === 'pause') {
		log('puaseing song')
		playerAPI.pause()
	}

	// 80ms for compensating for JS function execution time
	const latency = correctedNow() - recv.tms + 80
	playerAPI.seekTo(recv.timestampMs + latency)
}

const getAudioStateSpotify = async () => {
	const playerHarmonyState = await getPlayerAPIFn()._harmony.getCurrentState()
	const timestampMs = playerHarmonyState.position
	const durationMs = playerHarmonyState.duration
	const playState = playerHarmonyState.paused ? 'pause' : 'play'
	const playlistID = playerHarmonyState.context?.uri || ''
	const songURI = playerHarmonyState.track_window?.current_track?.uri || ''

	return {
		nodeId: 43,
		timestampMs: timestampMs,
		mediaState: playState,
		service: 'spotify',
		tms: correctedNow(),
		volume: 100,
		isMuted: false,
		playbackRate: 1,
		playlistID: playlistID,
		songURI: songURI,
		durationMs: durationMs,
	}
}

const getVideoCurrentState = (data) => {
	return {
		nodeId: 42,
		timestamp: VID_ELEM?.currentTime || 0,
		mediaState: data?.isBuffering
			? 'buffer'
			: VID_ELEM?.paused
			? 'pause'
			: 'play',
		tms: correctedNow(),
		volume: VID_ELEM?.volume || 0,
		isMuted: VID_ELEM?.muted || false,
		resolution: '720p',
		isCCOn: true,
		playbackRate: VID_ELEM?.playbackRate || 1,
		url: getTopURLSync(),
	}
}

const getMediaCurrentState = async (data) => {
	if (isSpotifyClient()) {
		return await getAudioStateSpotify(data)
	}
	return getVideoCurrentState(data)
}

const requestEventFromOwner = (roomName) => {
	sendMessageToBG({
		type: 'sync_room_data',
		data: { roomName: roomName },
	})
}

// Programmatic play() is rejected when the page has had no user gesture yet.
// The rejection used to go unhandled, leaving the guest silently paused.
let _pendingGestureRetry = false
const playSafely = async (video) => {
	try {
		await video.play()
		_pendingGestureRetry = false
		await sendMessageToBG({ type: 'playback_blocked', data: { blocked: false } })
	} catch (e) {
		log('play() was blocked', e)
		await sendLogToBG(`play() blocked: ${e?.message}`)
		await sendMessageToBG({ type: 'playback_blocked', data: { blocked: true } })
		if (_pendingGestureRetry) return
		_pendingGestureRetry = true
		// Retry on the next real interaction anywhere on the page, which is
		// exactly the gesture the autoplay policy was waiting for.
		const retry = () => {
			document.removeEventListener('pointerdown', retry, true)
			document.removeEventListener('keydown', retry, true)
			_pendingGestureRetry = false
			if (VID_ELEM && VID_ELEM.paused) playSafely(VID_ELEM)
		}
		document.addEventListener('pointerdown', retry, true)
		document.addEventListener('keydown', retry, true)
	}
}

const onMediaEvent = async (result) => {
	log('called onMediaEvent', result)
	const { roomName, data } = result
	await sendLogToBG(`called onMediaEvent' ${result}`)
	// if (!WAS_REDIRECTED) {
	// if this did not came from a redirection, only then think about redirection.
	// 	if (window.location.href !== data.url) {
	// 		log('setting prev room in LS and redirecting')
	// 		await setPrevRoomInLS(roomName)
	// 		window.location.href = data.url
	// 	}
	// }
	if (VID_ELEM) {
		log('VID ELEM settig state')
		if (!isNaN(parseFloat(data.timestamp))) {
			// code to take latency into account.
			VID_ELEM.currentTime =
				data.timestamp + (correctedNow() - data.tms) / 1000
		}
		if (data.mediaState === 'buffer' && !VID_ELEM.paused) {
			VID_ELEM.pause()
		} else if (data.mediaState === 'play' && VID_ELEM.paused) {
			await playSafely(VID_ELEM)
		} else if (data.mediaState === 'pause' && !VID_ELEM.paused) {
			VID_ELEM.pause()
		}
		// if (parseFloat(data.volume) !== NaN) {
		// 	VID_ELEM.volume = data.volume
		// }
		if (!isNaN(parseFloat(data.playbackRate))) {
			VID_ELEM.playbackRate = data.playbackRate
		}
		VID_ELEM.muted = data.isMuted
	} else {
		log('no video element found to act on media event')
		await sendLogToBG('no video element found to act on media event')
	}
}

const sendMediaEventAfterDelay = (delayMs) => {
	setTimeout(() => {
		log('delay complete .sending now')
		sendMediaEvent()
	}, delayMs)
}

const onSyncRoomEvent = () => {
	/* only for owner of the room */

	sendStreamChangeEvent()
	// sendMediaEvent()

	/* send multiple media events to increase relability */
	sendMediaEventAfterDelay(4200)
	sendMediaEventAfterDelay(7300)
}

const onStreamChangeEvent = async (resp) => {
	// in SPA like youtube playlists, for a same video in the playlist
	// the url could be slightly different.
	// so, stream_change should have a dedicated event.
	const recvdURL = resp.data.url
	const currURL = getTopURLSync()
	if (recvdURL !== currURL) {
		// special case for youtube playlist
		if (recvdURL.includes('list=')) {
			const recvdURLParams = new URLSearchParams(recvdURL.split('?')[1])
			const currURLParams = new URLSearchParams(currURL.split('?')[1])
			if (recvdURLParams.get('v') === currURLParams.get('v')) {
				// playing same video in playlist. ignore.
				return
			}
		}
		const redInfo = await getURLRedirectInfo(recvdURL)
		if (
			redInfo.count > 3 &&
			new Date().getTime() - redInfo.lastUpdated < 18_000
		) {
			// too much - too frequent redirections. STOP.
			log('too much - too frequent redirections. STOP.')
			return
		}
		await sendMessageToBG({
			type: 'increment_redirect_count',
			data: {
				url: recvdURL,
			},
		})
		await setPrevRoomInLS(resp.roomName)
		await navigateTab(recvdURL)
		return
	}
}

// SOCKET.on('stream_location', (ack) => {
// 	ack({success: true, data: {url: window.location.href}})
// })

const sendStreamChangeEvent = async (...args) => {
	sendMessageToBG({
		type: 'stream_change',
		data: {
			roomName: currRoom,
			meta: await getMediaCurrentState(...args),
		},
	})
}

const sendMediaEvent = async (...args) => {
	await sendMessageToBG({
		type: 'media_event',
		data: {
			roomName: currRoom,
			meta: await getMediaCurrentState(...args),
		},
	})
}

const sendStallEvent = () => {
	sendMediaEvent({ isBuffering: true })
}

const sendPlayEvent = async () => {
	// in case of SPA, when the stream changes the new video generates a play event.
	// we can use that to detect the stream change.
	const topUrl = getTopURLSync()
	if (currUrl !== topUrl) {
		// stream changed
		await sendStreamChangeEvent()
		currUrl = topUrl
		return
	}
	sendMediaEvent()
}

const sendPauseEvent = () => {
	sendMediaEvent()
}

const sendSeekEvent = () => {
	sendMediaEvent()
}

const listenToMediaEvents = () => {
	if (isSpotifyClient()) {
		return listenToSpotifyAudioEvents()
	}
	if (!VID_ELEM) return
	VID_ELEM.addEventListener('play', sendPlayEvent)
	VID_ELEM.addEventListener('pause', sendPauseEvent)
	VID_ELEM.addEventListener('seeked', sendSeekEvent)
	// VID_ELEM.addEventListener('volumechange', sendMediaEvent)
	VID_ELEM.addEventListener('ratechange', sendMediaEvent)
	VID_ELEM.addEventListener('waiting', sendStallEvent)
	// 'waiting' pauses everyone else. Recovery from buffering fires 'playing',
	// not 'play', so without this nobody is ever told to resume.
	VID_ELEM.addEventListener('playing', sendPlayEvent)
}

const listenToSpotifyAudioEvents = () => {
	const spotifyPlayer = getPlayerAPIFn()
	spotifyPlayer._events._emitter.addListener('update', async (e) => {
		const data = e.data
		if (!data) return
		sendMediaEvent(data)
		if (data.item.uri !== CURR_SONG_URI_OWNERPOV) {
			CURR_SONG_URI_OWNERPOV = data.item.uri
			await sendStreamChangeEvent()
			sendMediaEventAfterDelay(3100)
			sendMediaEventAfterDelay(4500)
			sendMediaEventAfterDelay(5200)
			sendMediaEventAfterDelay(5990)
		}
	})
}

const removeVideoEvents = () => {
	if (!VID_ELEM) return
	VID_ELEM.removeEventListener('play', sendPlayEvent)
	VID_ELEM.removeEventListener('pause', sendPauseEvent)
	VID_ELEM.removeEventListener('seeked', sendSeekEvent)
	// VID_ELEM.removeEventListener('volumechange', sendMediaEvent)
	VID_ELEM.removeEventListener('ratechange', sendMediaEvent)
	VID_ELEM.removeEventListener('waiting', sendStallEvent)
	VID_ELEM.removeEventListener('playing', sendPlayEvent)
}

const requestDataForCurrentRoom = () => {
	requestEventFromOwner(currRoom)
}

// const joineeVideoListenEvents = () => {
// 	if (!VID_ELEM) return
// 	VID_ELEM.addEventListener('play', requestDataForCurrentRoom)
// }

// const joineeVideoUnListenEvents = () => {
// 	if (!VID_ELEM) return
// 	VID_ELEM.removeEventListener('play', requestDataForCurrentRoom)
// }

/* const listenToUrlChange = () => {
	// in SPA like youtube playlists, for a same video in the playlist
	// the url could be slightly different.
	// so, stream_change should have a dedicated event.
	let prevUrl = window.location.href
	const observer = new MutationObserver((mutations) => {
		if (window.location.href !== prevUrl) {
			sendStreamChangeEvent()
		}
	})
	const config = {subtree: true, childList: true};
	observer.observe(document, config);
	return observer
} */

const createRoom = async (roomName) => {
	/* send create room event to server and the media information with it.
	the media information is needed in case if any previous joinee are still in the room that was left by the owner.
	this means taking the hard path for getting media information especially for spotify which does not use HTMLMediaElement. */
	const result = await sendMessageToBG({
		type: 'create_room',
		data: { roomName: roomName, meta: await getMediaCurrentState() },
	})
	if (result.success) {
		// if room was created, we are the owner now and we should install listeners for media events to forward to room members.
		currUrl = getTopURLSync()
		currRoom = await sendMessageToBG({
			type: 'set_storage',
			data: { key: CURR_ROOM_ID, value: roomName },
		})
		IS_OWNER = true
		listenToMediaEvents()
		startAutoVideoScan()
	}
	return result
}

const joinRoom = async (roomName) => {
	const result = await sendMessageToBG({
		type: 'join_room',
		data: { roomName: roomName },
	})
	if (result.success) {
		currRoom = await sendMessageToBG({
			type: 'set_storage',
			data: { key: CURR_ROOM_ID, value: roomName },
		})
		IS_OWNER = !!result.data.isOwner
		if (IS_OWNER) {
			listenToMediaEvents()
		} else {
			// just listen to video buffering events and ask for fresh
			// data after buffer
			// joineeVideoListenEvents()
		}
		// Guests need the rescan too — their video node gets replaced just the
		// same, and a stale one means incoming events act on nothing.
		startAutoVideoScan()
	}
	return result
}

const leaveRoom = async (roomName) => {
	const result = await sendMessageToBG({
		type: 'leave_room',
		data: { roomName: roomName },
	})
	if (result.success) {
		currRoom = await sendMessageToBG({
			type: 'set_storage',
			data: { key: CURR_ROOM_ID, value: null },
		})
		await sendMessageToBG({ type: 'remove_all_listeners' })
		if (result.data.isOwner) {
			removeVideoEvents()
		} else {
			// joineeVideoUnListenEvents()
		}
		IS_OWNER = false
		stopAutoVideoScan()
	}
	return result
}

const listRooms = async () => {
	log('current room', currRoom)
	// return await new Promise((resolve) => {
	// 	SOCKET.emit('list_rooms', (result) => {
	// 		resolve(result)
	// 	})
	// })
	return await sendMessageToBG({ type: 'list_rooms' })
}


window.addEventListener('message', async (event) => {
    // log('message', event)
    if (
        event.source !== window ||
        event.data.type !== 'syncer-extension-bg-to-mcs'
    ) {
        // log('exiting')
        return
    }
    const port = event.ports[0]
    const message = event.data.data

    if (message.type === 'recheck_video_scan') {
        const result = findBestVideoElement()
        return port.postMessage({
            success: true,
            data: { found: !!result, message: result ? 'video found' : 'no video found yet' },
        })
    }

    if (message.type === 'cleanup_after_leave') {
        currRoom = null
        if (message.isOwner) {
            removeVideoEvents()
        }
        IS_OWNER = false
        stopAutoVideoScan()
        return port.postMessage({ success: true })
    }

    if (message.type === 'setup_after_join') {
        await initializeFrame()
        currRoom = message.roomName
        await sendMessageToBG({
            type: 'set_storage',
            data: { key: CURR_ROOM_ID, value: message.roomName },
        })
		VID_ELEM = findBestVideoElement()
		await sendLogToBG('setupafterjoin, video element: ' + !!VID_ELEM)
        IS_OWNER = !!message.isOwner
        if (IS_OWNER) {
            listenToMediaEvents()
        }
        // Keeps VID_ELEM current across SPA navigations for owner and guest.
        startAutoVideoScan()
        return port.postMessage({ success: true })
    }

    if (message.type === 'media_event') {
        if (isSpotifyService(message.data.data)) {
            log('spotify media event')
            handleSpotifyStreamEvent(message.data.data)
        } else {
            onMediaEvent(message.data)
        }
        return port.postMessage({})
    } else if (message.type === 'sync_room_data') {
        onSyncRoomEvent()
        return port.postMessage({})
    } else if (message.type === 'stream_change') {
        // peek into the data to figure out the service type
        // and then navigate to it.
        if (isSpotifyService(message.data.data)) {
            const resp = message.data.data
            if (!isSpotifyClient()) {
                await setPrevRoomInLS(message.data.roomName)
                const playlistComps = resp.playlistID.split(':')
                let rootPath = ''
                if (playlistComps[1] === 'playlist') {
                    rootPath = '/playlist'
                } else if (playlistComps[1] === 'album') {
                    rootPath = '/album'
                }
                if (rootPath) {
                    await navigateTab(`https://open.spotify.com${rootPath}/${playlistComps[2]}`)
                } else {
                    await navigateTab('https://open.spotify.com')
                }
                return
            }
            handleSpotifyStreamEvent(resp, true)
        } else {
            onStreamChangeEvent(message.data)
        }
        return port.postMessage({})
    }

    VID_ELEM = findBestVideoElement()

    await initializeFrame()

    let result = await connectToWebSocket()
    if (!result.success) {
        port.postMessage(result)
        return
    }
    if (message.type === 'create_room') {
        if (!VID_ELEM && !isSpotifyClient()) {
            result = {
                success: false,
                data: {
                    message: 'No video in current page. Go to a webpage with video.',
                },
            }
        } else {
            result = await createRoom(message.roomName)
        }
    } else if (message.type === 'join_room') {
        result = await joinRoom(message.roomName)
    } else if (message.type === 'leave_room') {
        result = await leaveRoom(message.roomName || currRoom)
    } else if (message.type === 'list_rooms') {
        result = await listRooms()
    }
    port.postMessage(result)
})

// Only auto-initialize in the top frame (for redirect/rejoin flow).
// Subframes stay dormant until explicitly activated via a command.
if (window.top === window.self) {
	await initializeFrame()
}
