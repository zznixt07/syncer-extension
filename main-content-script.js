
; (async () => {

	const sendMessageToBG = async (message) => {
		return new Promise((resolve) => {
			const channel = new MessageChannel()
			channel.port1.onmessage = (event) => {
				channel.port1.close()
				resolve(event.data)
			}
			window.postMessage({ type: 'syncer-extension-mcs-to-bg', data: message }, '*', [channel.port2])
		})
	}

	const spotifyRootElemSelector = '[data-testid="root"]'
	const spotifyPlayerProgressBarSelector = '[data-testid="playback-progressbar"]'

	const log = (...msg) => {
		console.log('CS:', ...msg)
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


	const isSpotifyService = () => window.location.href.startsWith('https://open.spotify')


	const CURR_ROOM_ID = 'currRoom'
	let currRoom = await sendMessageToBG({ type: 'get_storage', data: { key: CURR_ROOM_ID } })
	let currUrl = window.location.href
	let VID_ELEM = document.querySelector(
		'video[src]:not([rel=""]), video > source[src]:not([rel=""])'
	)
	if (VID_ELEM && VID_ELEM.tagName === 'SOURCE') {
		VID_ELEM = VID_ELEM.parentElement
	}
	const prevRoomName = await getPrevRoomFromLS()
	const WAS_REDIRECTED = !!prevRoomName

	if (prevRoomName) {
		await removePrevRoomFromLS()
		log('previous room found: ', prevRoomName)
		const result = await connectToWebSocket()
		if (result.success) {
			currUrl = window.location.href
			await joinRoom(prevRoomName)
			// sometimes the video is stll streaming after being freshly loaded
			// and the media_event from the owner could arrive while buffering
			// which will put the video out of sync. hence, after sometime,
			// request the owner to send the media_event again.
			const timeoutMs = 2500
			setTimeout(() => {
				requestEventFromOwner(prevRoomName)
			}, timeoutMs * 1)
			setTimeout(() => {
				requestEventFromOwner(prevRoomName)
			}, timeoutMs * 2.5)

		}
	} else {
		// log('prev room not found')
	}

	window.addEventListener('message', async (event) => {
		if (event.source !== window || event.data.type !== 'syncer-extension-bg-to-mcs') {
			// log('exiting')
			return
		}
		const port = event.ports[0]
		const message = event.data.data
		log('message/....', message)
		if (message.type === 'media_event') {
			if (isSpotifyService()) {
				handleSpotifyStreamEvent(message.data.data)
			} else {
				onMediaEvent(message.data)
			}
			port.postMessage({})
		}
		else if (message.type === 'sync_room_data') {
			onSyncRoomEvent(message.data)
			port.postMessage({})
		}
		else if (message.type === 'stream_change') {
			onStreamChangeEvent(message.data)
			port.postMessage({})
		}

		VID_ELEM = document.querySelector(
			'video[src]:not([rel=""]), video > source[src]:not([rel=""])'
		)
		// if the source elem was selected, then the real video elem is the parent elem
		// :has() is upcoming but not supported yet.
		if (VID_ELEM && VID_ELEM.tagName === 'SOURCE') {
			VID_ELEM = VID_ELEM.parentElement
		}

		let result = await connectToWebSocket()
		if (!result.success) {
			port.postMessage(result)
			return
		}
		if (message.type === 'create_room') {
			if (!VID_ELEM && !isSpotifyService()) {
				result = {
					success: false,
					data: { message: 'No video in current page. Go to a webpage with video.' },
				}
			} else {
				result = await createRoom(message.roomName)
			}
		} else if (message.type === 'join_room') {
			result = await joinRoom(message.roomName)
		} else if (message.type === 'leave_room') {
			result = await leaveRoom(currRoom)
		} else if (message.type === 'list_rooms') {
			result = await listRooms()
		}
		port.postMessage(result)
	})

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

	const handleSpotifyStreamEvent = (recv) => {

		const requiredProp = getPropertyBeginningWith('__reactFiber$', document.querySelector(spotifyRootElemSelector))
		if (!requiredProp) {
			log('reactFiber prop name not found')
			return
		}

		// first pause/[play] and the seek
		let topMostComponent = document.querySelector(spotifyRootElemSelector)[requiredProp]
		if (!topMostComponent) {
			log('reactFiber prop on root elem not found')
			return
		}
		while (true) {
			if (!topMostComponent.return) break;
			topMostComponent = topMostComponent.return;
		}
		const playerAPI = topMostComponent.child.memoizedProps.platform.getPlayerAPI()
		const isCurrentlyPlayingSong = (playerAPI.getState().context.uri === recv.playlistID) && (playerAPI.getState().item.uri === recv.songURI)
		if (recv.mediaState === 'play') {
			if (isCurrentlyPlayingSong) {
				playerAPI.resume()
			} else {
				playerAPI.play(
					{ "uri": recv.playlistID },
					{},
					{ "skipTo": { "uri": recv.songURI } }
				)
			}
		}
		else if (recv.mediaState === 'pause') {
			playerAPI.pause()
		}

		// seek to specified timestamp
		const progressBarElem = document.querySelector(spotifyPlayerProgressBarSelector)[requiredProp]
		if (!progressBarElem) {
			log('progress bar elem not found')
			return
		}
		let correspondingProps = progressBarElem.return?.memoizedProps
		let seekFn = correspondingProps?.onDragEnd
		if (!seekFn) {
			let currentComponent = progressBarElem.return
			if (currentComponent) {
				while (true) {
					currentComponent = currentComponent.return;
					correspondingProps = currentComponent?.memoizedProps
					if (correspondingProps?.onDragEnd || !currentComponent) break;
				}
			}
			seekFn = correspondingProps?.onDragEnd
		}

		if (!seekFn) {
			log('seek function not found')
			return
		}
		// const currentSongTotalDurationSecs = correspondingProps?.max
		// between [0 - 1] Example: 0.2 means seek to 20%
		const percentageFracToSeekTo = recv.timestamp / recv.duration
		log('seeking to ', percentageFracToSeekTo, ' of ', recv.duration, ' secs')
		seekFn(percentageFracToSeekTo, {})

	}

	const getAudioStateSpotify = (data) => {
		let timestamp = 0
		let duration = 1
		let playState = 'play'
		let playlistID, songURI

		/* if no data is sent in the arguments then this means no event listener is installed yet for media events.
			Hence, we gotta manually extract the media info from the page. */
		if (!data) {
			const currentSongURL = document.querySelector('.Root__now-playing-bar [data-testid="now-playing-widget"] a[data-testid="context-link"]')
			if (!currentSongURL) {
				return
			}

			// extract current songs URI and the playlist's ID it is in.
			const parsedURL = new URL(currentSongURL)
			const isPrivatePlaylist = /\/user\/.+\/collection\/.+$/.test(parsedURL.pathname)
			if (isPrivatePlaylist) {
				return
			}
			const matches = parsedURL.pathname.match(/\/(.+)\/(.+)$/)
			if (!matches) {
				return
			}
			playlistID = matches[2]
			songURI = parsedURL.searchParams.get('uri')
			if (!songURI) {
				return
			}

			const playbackBarElem = document.querySelector('.playback-bar [type="range"]')
			if (!playbackBarElem) {
				return
			}

			const playerBtn = document.querySelector('[data-testid="control-button-playpause"]')
			playState = 'play'
			if (playerBtn) {
				playState = (playerBtn.ariaLabel === 'Play') ? 'pause' : 'play'
			}
			timestamp = parseInt(playbackBarElem.value, 10)
			duration = parseInt(playbackBarElem.max, 10)
		}
		else {
			log('getting from API not dom')
			timestamp = data.positionAsOfTimestamp / 1000 // TODO: send ms instead of s for more precision
			duration = data.duration / 1000				// TODO: send ms instead of s for more precision
			playState = data.isPaused ? 'pause' : 'play'
			playlistID = data.context.uri
			songURI = data.item.uri
		}

		return {
			nodeId: 43,
			timestamp: timestamp,
			mediaState: playState,
			service: 'spotify',
			tms: new Date().getTime(),
			volume: 100,
			isMuted: false,
			playbackRate: 1,
			playlistID: playlistID,
			songURI: songURI,
			duration: duration,
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
			tms: new Date().getTime(),
			volume: VID_ELEM?.volume || 0,
			isMuted: VID_ELEM?.muted || false,
			resolution: '720p',
			isCCOn: true,
			playbackRate: VID_ELEM?.playbackRate || 1,
			url: window.location.href,
		}
	}

	const getMediaCurrentState = (data) => {
		if (isSpotifyService()) {
			return getAudioStateSpotify(data)
		}
		return getVideoCurrentState(data)
	}

	const requestEventFromOwner = (roomName) => {
		sendMessageToBG({
			type: 'sync_room_data',
			data: { roomName: roomName }
		})
	}


	const onMediaEvent = async (result) => {
		const { roomName, data } = result
		if (!WAS_REDIRECTED) {
			// const currUrl = window.location.href.replace(/index=\d+/, '')
			// const url = data.url.replace(/index=\d+/, '')
			// if (currUrl !== url)
			// if this did not came from a redirection, only then think about redirection.
			if (window.location.href !== data.url) {
				await setPrevRoomInLS(roomName)
				window.location.href = data.url
			}
		}
		if (VID_ELEM) {
			if (parseFloat(data.timestamp) !== NaN) {
				// code to take latency into account.
				VID_ELEM.currentTime =
					data.timestamp + (new Date().getTime() - data.tms) / 1000
			}
			if (data.mediaState === 'buffer' && !VID_ELEM.paused) {
				VID_ELEM.pause()
			}
			else if (data.mediaState === 'play' && VID_ELEM.paused) {
				VID_ELEM.play()
			}
			else if (data.mediaState === 'pause' && !VID_ELEM.paused) {
				VID_ELEM.pause()
			}
			if (parseFloat(data.volume) !== NaN) {
				VID_ELEM.volume = data.volume
			}
			if (parseFloat(data.playbackRate) !== NaN) {
				VID_ELEM.playbackRate = data.playbackRate
			}
			VID_ELEM.muted = data.isMuted
		}
	}

	const onSyncRoomEvent = () => {
		// only for owner of the room
		sendMediaEvent()
	}

	const onStreamChangeEvent = async (resp) => {
		// in SPA like youtube playlists, for a same video in the playlist
		// the url could be slightly different.
		// so, stream_change should have a dedicated event.
		if (resp.url !== window.location.href) {
			await setPrevRoomInLS(resp.roomName)
			// console.log('stream change', resp)
			window.location.href = resp.data.url
			return
		}

	}

	// SOCKET.on('stream_location', (ack) => {
	// 	ack({success: true, data: {url: window.location.href}})
	// })
	const sendStreamChangeEvent = () => {
		sendMessageToBG({
			type: 'stream_change',
			data: {
				roomName: currRoom,
				meta: getMediaCurrentState(),
			}
		})
	}

	const sendMediaEvent = (...args) => {
		sendMessageToBG({
			type: 'media_event',
			data: {
				roomName: currRoom,
				meta: getMediaCurrentState(...args),
			}
		})
	}

	const sendStallEvent = () => {
		sendMediaEvent({ isBuffering: true })
	}

	const sendPlayEvent = () => {
		// in case of SPA, when the stream changes the new video generates a play event.
		// we can use that to detect the stream change.
		if (currUrl !== window.location.href) {
			// stream changed
			sendStreamChangeEvent()
			currUrl = window.location.href
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
		if (isSpotifyService()) {
			return listenToSpotifyAudioEvents()
		}
		if (!VID_ELEM) return
		VID_ELEM.addEventListener('play', sendPlayEvent)
		VID_ELEM.addEventListener('pause', sendPauseEvent)
		VID_ELEM.addEventListener('seeked', sendSeekEvent)
		VID_ELEM.addEventListener('volumechange', sendMediaEvent)
		VID_ELEM.addEventListener('ratechange', sendMediaEvent)
		VID_ELEM.addEventListener('waiting', sendStallEvent)
	}

	const listenToSpotifyAudioEvents = () => {
		const requiredProp = getPropertyBeginningWith('__reactFiber$', document.querySelector(spotifyRootElemSelector))
		if (!requiredProp) {
			log('reactFiber prop name not found')
			return
		}

		let topMostComponent = document.querySelector(spotifyRootElemSelector)[requiredProp]
		if (!topMostComponent) {
			log('reactFiber prop on root elem not found')
			return
		}
		while (true) {
			if (!topMostComponent.return) break;
			topMostComponent = topMostComponent.return;
		}

		topMostComponent.child.memoizedProps.platform.getPlayerAPI()._events._emitter.addListener('update', (e) => {
			const data = e.data
			sendMediaEvent(data)
		})
	}

	const removeVideoEvents = () => {
		if (!VID_ELEM) return
		VID_ELEM.removeEventListener('play', sendPlayEvent)
		VID_ELEM.removeEventListener('pause', sendPauseEvent)
		VID_ELEM.removeEventListener('seeked', sendSeekEvent)
		VID_ELEM.removeEventListener('volumechange', sendMediaEvent)
		VID_ELEM.removeEventListener('ratechange', sendMediaEvent)
		VID_ELEM.removeEventListener('waiting', sendStallEvent)
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
		const result = await sendMessageToBG({ type: 'create_room', 'data': { roomName: roomName, meta: getMediaCurrentState() } })
		if (result.success) {
			// if room was created, we are the owner now and we should install listeners for media events to forward to room members.
			currUrl = window.location.href
			currRoom = await sendMessageToBG({ type: 'set_storage', data: { key: CURR_ROOM_ID, value: roomName } })
			listenToMediaEvents()
		}
		return result
	}

	const joinRoom = async (roomName) => {
		const result = await sendMessageToBG({ type: 'join_room', 'data': { roomName: roomName } })
		if (result.success) {
			currRoom = await sendMessageToBG({ type: 'set_storage', data: { key: CURR_ROOM_ID, value: roomName } })
			if (result.data.isOwner) {
				listenToMediaEvents()
			} else {
				// just listen to video buffering events and ask for fresh
				// data after buffer
				// joineeVideoListenEvents()
			}
		}
		return result
	}

	const leaveRoom = async (roomName) => {
		const result = await sendMessageToBG({ type: 'leave_room', 'data': { roomName: roomName } })
		if (result.success) {
			currRoom = await sendMessageToBG({ type: 'set_storage', data: { key: CURR_ROOM_ID, value: null } })
			await sendMessageToBG({ type: 'remove_all_listeners' })
			if (result.data.isOwner) {
				removeVideoEvents()
			} else {
				// joineeVideoUnListenEvents()
			}
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
	const connectToWebSocket = async () => {
		return await sendMessageToBG({
			type: 'websocket_connect'
		})
	}


})()

// window.addEventListener('message',  (event) => {
// 	console.log('message received2', event.data);
// 	if (event.source !== window && event.data.type !== 'syncer-extension-bg-to-mcs') {
// 		return
// 	}
// 	return event.ports[0].postMessage({})
// })


