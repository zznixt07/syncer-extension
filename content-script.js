
; (async () => {
	/*
	------ a HACK to make service workers persistent --------
	Thx wOxxOm. Source: https://stackoverflow.com/a/66618269/12091475
	*/
	// <Hack>
	let port;
	function connect() {
		port = chrome.runtime.connect({ name: 'foo' });
		port.onDisconnect.addListener(connect);
		port.onMessage.addListener(msg => {
			console.log('received', msg, 'from bg');
		});
	}
	connect();
	// </Hack>

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

	const getServerAddress = async () => {
		// log('getting server address')
		return await sendMessageToBG({ type: 'get_server_address' })
	}

	const getVideoCurrentState = (data) => {
		return {
			nodeId: 42,
			timestamp: VID_ELEM?.currentTime || 0,
			videoState: data?.isBuffering
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
			if (data.videoState === 'buffer' && !VID_ELEM.paused) {
				VID_ELEM.pause()
			}
			else if (data.videoState === 'play' && VID_ELEM.paused) {
				VID_ELEM.play()
			}
			else if (data.videoState === 'pause' && !VID_ELEM.paused) {
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

	const onSyncRoomEvent = (result) => {
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
				meta: getVideoCurrentState(),
			}
		})
	}

	const sendMediaEvent = (...args) => {
		sendMessageToBG({
			type: 'media_event',
			data: {
				roomName: currRoom,
				meta: getVideoCurrentState(...args),
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

	const listenToVideoEvents = () => {
		if (!VID_ELEM) return
		VID_ELEM.addEventListener('play', sendPlayEvent)
		VID_ELEM.addEventListener('pause', sendPauseEvent)
		VID_ELEM.addEventListener('seeked', sendSeekEvent)
		VID_ELEM.addEventListener('volumechange', sendMediaEvent)
		VID_ELEM.addEventListener('ratechange', sendMediaEvent)
		VID_ELEM.addEventListener('waiting', sendStallEvent)
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
		const result = await sendMessageToBG({ type: 'create_room', 'data': { roomName: roomName, meta: getVideoCurrentState() } })
		if (result.success) {
			currUrl = window.location.href
			currRoom = await sendMessageToBG({type: 'set_storage', data: {key: CURR_ROOM_ID, value: roomName}})
			listenToVideoEvents()
		}
		return result
	}

	const joinRoom = async (roomName) => {
		const result = await sendMessageToBG({ type: 'join_room', 'data': { roomName: roomName } })
		if (result.success) {
			currRoom = await sendMessageToBG({type: 'set_storage', data: {key: CURR_ROOM_ID, value: roomName}})
			if (result.data.isOwner) {
				listenToVideoEvents()
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
			currRoom = await sendMessageToBG({type: 'set_storage', data: {key: CURR_ROOM_ID, value: null}})
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
	const sendMessageToBG = async (message) => {
		// log('req', message)
		const resp = await chrome.runtime.sendMessage(message)
		// log('res', resp)
		return resp
	}

	const CURR_ROOM_ID = 'currRoom'
	let currRoom = await sendMessageToBG({type: 'get_storage', data: {key: CURR_ROOM_ID}})
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

	chrome.runtime.onMessage.addListener((message, sender, reply) => {
		// do not use async function if u want to return value after awaiting.
		// instead use an async IIFE and use return true;

		; (async () => {
			if (message.type === 'media_event') {
				onMediaEvent(message.data)
				reply()
			}
			else if (message.type === 'sync_room_data') {
				onSyncRoomEvent(message.data)
				reply()
			}
			else if (message.type === 'stream_change') {
				onStreamChangeEvent(message.data)
				reply()
			}

			else if (message.type === 'get_prev_room_from_storage') {
				const result = await getPrevRoomFromLS()
				reply(result)
				return
			} else if (message.type === 'remove_prev_room_from_storage') {
				removePrevRoomFromLS()
				reply(result)
				return
			} else if (message.type === 'set_server_address') {
				const result = await sendMessageToBG({ type: message.type, data: message.roomName })
				reply(result)
				return
			} else if (message.type === 'get_server_address') {
				const result = await getServerAddress()
				reply(result)
				return
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
				reply(result)
				return
			}
			if (message.type === 'create_room') {
				if (!VID_ELEM) {
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

			reply(result)
		})()
		return true
	})
})()
