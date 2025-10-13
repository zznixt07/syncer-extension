;(async () => {
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

	const spotifyRootElemSelector = '[data-testid="root"]'
	let CURR_SONG_URI = ''
	let CURR_SONG_URI_OWNERPOV = ''
	let PLAYER_API_STORE

	const log = (...msg) => {
		// console.log('CS:', ...msg)
	}

	const asleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

	const isYoutubeClient = () =>
		window.location.host.startsWith('www.youtube.com')
	const isYoutubeService = (data) => data.service === 'youtube'
	const isSpotifyClient = () => window.location.host.startsWith('open.spotify')
	const isSpotifyService = (data) => data.service === 'spotify'

	let VID_ELEM = document.querySelector(
		'video[src]:not([rel=""]), video > source[src]:not([rel=""])'
	)
	if (VID_ELEM && VID_ELEM.tagName === 'SOURCE') {
		VID_ELEM = VID_ELEM.parentElement
	}

	const CURR_ROOM_ID = 'currRoom'
	let currRoom = await sendMessageToBG({
		type: 'get_storage',
		data: { key: CURR_ROOM_ID },
	})
	let currUrl = window.location.href
	const prevRoomName = await getPrevRoomFromLS()
	const WAS_REDIRECTED = !!prevRoomName

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
		const latency = new Date().getTime() - recv.tms + 80
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
			tms: new Date().getTime(),
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
			tms: new Date().getTime(),
			volume: VID_ELEM?.volume || 0,
			isMuted: VID_ELEM?.muted || false,
			resolution: '720p',
			isCCOn: true,
			playbackRate: VID_ELEM?.playbackRate || 1,
			url: window.location.href,
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

	const onMediaEvent = async (result) => {
		log('called onMediaEvent', result)
		const { roomName, data } = result
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
					data.timestamp + (new Date().getTime() - data.tms) / 1000
			}
			if (data.mediaState === 'buffer' && !VID_ELEM.paused) {
				VID_ELEM.pause()
			} else if (data.mediaState === 'play' && VID_ELEM.paused) {
				VID_ELEM.play()
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
		const currURL = window.location.href
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
			window.location.href = recvdURL
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
		if (currUrl !== window.location.href) {
			// stream changed
			await sendStreamChangeEvent()
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
		const result = await sendMessageToBG({
			type: 'create_room',
			data: { roomName: roomName, meta: await getMediaCurrentState() },
		})
		if (result.success) {
			// if room was created, we are the owner now and we should install listeners for media events to forward to room members.
			currUrl = window.location.href
			currRoom = await sendMessageToBG({
				type: 'set_storage',
				data: { key: CURR_ROOM_ID, value: roomName },
			})
			listenToMediaEvents()
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
			type: 'websocket_connect',
		})
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
		// log('message/....', message)
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
						window.location.href = `https://open.spotify.com${rootPath}/${playlistComps[2]}`
					} else {
						window.location.href = 'https://open.spotify.com'
					}
					return
				}
				handleSpotifyStreamEvent(resp, true)
			} else {
				onStreamChangeEvent(message.data)
			}
			return port.postMessage({})
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
			result = await leaveRoom(currRoom)
		} else if (message.type === 'list_rooms') {
			result = await listRooms()
		}
		port.postMessage(result)
	})

	// Note: keep this below event listeners cuz this block below calls some functions
	// which ought to trigger the "onmessage" event listener above.
	// if that event listener is not set up, then the funntions below would keep waiting until timeout.
	if (prevRoomName) {
		await removePrevRoomFromLS()
		// log('previous room found: ', prevRoomName)
		const result = await connectToWebSocket()
		if (result.success) {
			currUrl = window.location.href
			await joinRoom(prevRoomName)
			// sometimes the video is stll streaming after being freshly loaded
			// and the media_event from the owner could arrive while buffering
			// which will put the video out of sync. hence, after sometime,
			// request the owner to send the media_event again.
			const timeoutMs = 1000
			setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 2.2)
			setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 5.1)
			setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 7.9)
		}
	} else {
		// log('prev room not found')
	}
})()
