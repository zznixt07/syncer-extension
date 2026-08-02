import { toast } from './lib/wc-toast.js'

// Declare chrome as a global variable for linting tools
/* global chrome */

const getCurrentTab = async () => {
	const tabs = await chrome.tabs.query({ currentWindow: true, active: true })
	return tabs[0]
}

const getCurrentTabId = async () => {
	const tab = await getCurrentTab()
	return tab.id
}

const tab = await getCurrentTab()
const url = tab?.url || ''
if (true) {
	const REQUEST_TIMEOUT_MS = 7000
	const withTimeout = (promise, label) => {
		return Promise.race([
			promise,
			new Promise((_, reject) => {
				setTimeout(() => reject(new Error(`${label} timed out`)), REQUEST_TIMEOUT_MS)
			}),
		])
	}

	const success = (message) => {
		toast(`<span>${message}</span>`, {
			...{ icon: { type: 'success' } },
			...OPTION,
		})
	}
	const fail = (message) => {
		if (!message) {
			return
		}
		toast(`<span>${message}</span>`, {
			...{ icon: { type: 'error' } },
			...OPTION,
		})
	}

	// Send message directly to background (not via content scripts)
	const sendMessageToBG = async (type, data) => {
		try {
			return await withTimeout(
				chrome.runtime.sendMessage({ type, data }),
				type
			)
		} catch (e) {
			fail(`Failed: ${e.message}`)
			return null
		}
	}

	const sendMessageToCurrTab = async (type, roomName, throwError = false) => {
		// console.log(`Sending message to current tab: ${type}`);
		const currTabId = await getCurrentTabId()
		try {
			const res = await chrome.tabs.sendMessage(currTabId, {
				type: type,
				roomName: roomName,
			})
			console.log(`got resp from curr tab: ${res}`)
			return res
		} catch (e) {
			if (throwError) throw e
			fail(`Failed: ${e.message}`)
			return null
		}
	}

	const sendMessageToVideoFrame = async (type, roomName) => {
		const currTabId = await getCurrentTabId()
		try {
			const result = await withTimeout(
				chrome.runtime.sendMessage({
					type: 'forward_to_video_frame',
					tabId: currTabId,
					innerMessage: { type, roomName },
				}),
				type
			)
			return result
		} catch (e) {
			fail(`Failed on: ${type}: ${e.message}`)
			return null
		}
	}

	const setIsLoading = (elem, isLoading) => {
		// console.log(elem)
		if (isLoading) {
			elem.disabled = true

			const span = document.createElement('span')
			span.textContent = '...'
			elem.style.position = 'relative'
			span.className = 'loading'
			span.style = `
			position: absolute;
			top: 0;
			left: 0;
			width: 95%;
			height: 95%;
			background-color: black;
			border-radius: inherit;
		`
			elem.appendChild(span)
		} else {
			elem.disabled = false
			const span = elem.querySelector('span.loading')
			if (span) span.remove()
		}
	}

	const OPTION = {
		theme: {
			type: 'custom',
			style: { background: '#00529b', color: 'white' },
		},
		duration: 2000,
	}

	const toaster = document.createElement('wc-toast')
	const style = document.createElement('style')
	style.textContent = `
wc-toast-content {
	--wc-toast-font-size: 12px;
}
`
	// toaster.setAttribute('position', 'bottom-center')
	document.head.appendChild(style)
	document.body.prepend(toaster)

	const createRoomBtn = document.getElementById('create-room')
	const joinRoomBtn = document.getElementById('join-room')
	const leaveRoomBtn = document.getElementById('leave-room')
	const listRoomsBtn = document.getElementById('list-rooms')
	const serverAddressInput = document.getElementById('server-address')
	const roomUserCountElem = document.getElementById('room-user-count')
	const recheckBtn = document.getElementById('recheck-video')

	// The server counts everyone in the room, including us. What actually matters
	// is how many *other* people are watching, so subtract ourselves when we're in.
	const othersIn = (roomName, userCount) => {
		return Math.max(0, userCount - (roomName === activeRoomName ? 1 : 0))
	}

	const formatUserCount = (others) => {
		if (others === 0) return 'no one else'
		return `${others} ${others === 1 ? 'other' : 'others'}`
	}

	const updateRoomUserCount = (roomName, userCount) => {
		if (!roomUserCountElem || typeof userCount !== 'number') return
		// The host is the one whose play/pause/seek is broadcast; everyone else
		// only receives. Worth saying out loud.
		const role = roomName === activeRoomName && activeIsOwner != null
			? (activeIsOwner ? " · you're the host" : " · you're a guest")
			: ''
		// No room name here — the input right above already shows it.
		const others = othersIn(roomName, userCount)
		const summary = others === 0
			? 'No one else here yet'
			: `${others} ${others === 1 ? 'other' : 'others'} present`
		roomUserCountElem.textContent = `${summary}${role}`
	}

	const clearRoomUserCount = () => {
		if (roomUserCountElem) roomUserCountElem.textContent = ''
	}

	const currentRoomName = () => document.getElementById('new-room-name').value

	// The room this tab is actually in, as opposed to whatever is typed in the
	// input. Kept in sync with create/join/leave and restored on popup open.
	let activeRoomName = null
	// Whether we hold ownership of that room (null when not in a room).
	let activeIsOwner = null

	const PROTECTED_PAGE_MESSAGE = 'Open a normal webpage first. Chrome does not allow extensions to access this page.'
	const isProtectedPageUrl = (url) => /^(chrome|edge|brave|opera|vivaldi|about|chrome-extension|moz-extension):/.test(url || '')
	const ensureCurrentTabIsAccessible = async () => {
		const tab = await getCurrentTab()
		if (isProtectedPageUrl(tab?.url)) {
			fail(PROTECTED_PAGE_MESSAGE)
			return null
		}
		return tab
	}

	// Scans all frames for a video element and registers the frame that has one
	const recheckVideoFrames = async () => {
		const tab = await getCurrentTab()
		if (isProtectedPageUrl(tab?.url)) {
			return false
		}
		const currTabId = tab.id
		try {
			await chrome.scripting.executeScript({
				target: { tabId: currTabId, allFrames: true },
				func: () => {
					const video = document.querySelector('video')
					if (video) {
						chrome.runtime.sendMessage({ type: 'register_video_frame' })
					}
				},
			})
		} catch (err) {
			return false
		}
		const result = await chrome.runtime.sendMessage({
			type: 'has_video_frame',
			tabId: currTabId,
		})
		return !!result?.found
	}

	listRoomsBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		try {
			const result = await sendMessageToBG('list_rooms')
			if (result?.success) {
				const dataList = document.getElementById('rooms')
				const roomList = document.querySelector('pre#rooms-list')
				dataList.innerHTML = ''
				roomList.textContent = ''
				const rooms = result.data.roomUserCounts || result.data.rooms.map((roomName) => ({
					roomName,
					userCount: null,
				}))
				if (rooms.length === 0) {
					roomList.textContent += 'No rooms found'
				}
				rooms.forEach((room) => {
					const roomName = room.roomName
					const option = document.createElement('option')
					option.value = roomName
					option.textContent = roomName
					dataList.appendChild(option)
					// roomList.textContent += room + '\n'

					const wrapper = document.createElement('div')
					wrapper.style.display = 'flex'
					wrapper.style.alignItems = 'center'
					wrapper.style.marginBottom = '4px'

					const roomNameSpan = document.createElement('span')
					roomNameSpan.style.flexGrow = '1'

					// The room we're already in gets Leave instead of Join.
					const actionBtn = document.createElement('button')
					actionBtn.className = 'btn'
					actionBtn.style.marginLeft = '8px'

					// Repaints just this row — no refetch of the whole list.
					const paintRow = (userCount) => {
						const isActiveRoom = roomName === activeRoomName
						let label = typeof userCount === 'number'
							? `${roomName} (${formatUserCount(othersIn(roomName, userCount))})`
							: roomName
						if (isActiveRoom && activeIsOwner) {
							label += ' · host'
							roomNameSpan.title = "You're hosting this room."
						} else if (isActiveRoom) {
							label += ' · guest'
							roomNameSpan.title = "You're following this room's host."
						} else if (room.isOwner) {
							// server-verified: we own it from another tab
							label += ' · yours'
							roomNameSpan.title = 'You own this room, from another tab.'
						}
						roomNameSpan.textContent = label
						roomNameSpan.style.fontWeight = isActiveRoom ? 'bold' : 'normal'
						actionBtn.textContent = isActiveRoom ? 'Leave' : 'Join'
					}
					paintRow(room.userCount)

					actionBtn.addEventListener('click', async () => {
						document.getElementById('new-room-name').value = roomName
						const leaving = roomName === activeRoomName
						setIsLoading(actionBtn, true)
						let result
						try {
							result = leaving
								? await doLeaveRoom(roomName)
								: await doJoinRoom(roomName)
						} finally {
							setIsLoading(actionBtn, false)
						}
						// The ack's count already accounts for us joining/leaving.
						if (result?.success) paintRow(result.data?.userCount)
					})
					wrapper.appendChild(roomNameSpan)
					wrapper.appendChild(actionBtn)
					roomList.appendChild(wrapper)
				})
			} else {
				fail(result?.data?.message)
			}
		} finally {
			setIsLoading(target, false)
		}
	})
	createRoomBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		target.disabled = true
		try {
			const currRoomName = document.getElementById('new-room-name').value
			const tab = await ensureCurrentTabIsAccessible()
			if (!tab) return

			// Auto-recheck for video before creating room
			const found = await recheckVideoFrames()
			if (!found) {
				fail('No video found in any accessible frame.')
				return
			}

			const result = await sendMessageToVideoFrame('create_room', currRoomName)
			if (result?.success) {
				success(result.data.message)
				activeRoomName = currRoomName
				activeIsOwner = true // creating a room always makes us its owner
				updateRoomUserCount(currRoomName, result.data.userCount)
			} else {
				fail(result?.data?.message)
			}
		} finally {
			target.disabled = false
		}
	})
	// Shared by the main buttons and the per-room buttons in the rooms list.
	// Returns the raw result so callers can read the acked user count.
	const doJoinRoom = async (roomName) => {
		const tab = await ensureCurrentTabIsAccessible()
		if (!tab) return null

		// Pre-register the video frame when the current tab allows extension access.
		await recheckVideoFrames()

		const result = await sendMessageToBG('join_room', { roomName, tabId: tab.id })
		if (result?.success) {
			success(result.data.message)
			activeRoomName = roomName
			// true when we presented a stored token and reclaimed the room
			activeIsOwner = !!result.data.isOwner
			updateRoomUserCount(roomName, result.data.userCount)
		} else {
			fail(result?.data?.message)
		}
		return result
	}

	const doLeaveRoom = async (roomName) => {
		const currTabId = await getCurrentTabId()
		const result = await sendMessageToBG('leave_room', { roomName, tabId: currTabId })
		if (result?.success) {
			success(result.data.message)
			activeRoomName = null
			activeIsOwner = null
			// The leave ack's count excludes us, so it says nothing about
			// the room we just left — show nothing rather than a wrong number.
			clearRoomUserCount()
		} else {
			fail(result?.data?.message)
		}
		return result
	}

	joinRoomBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		try {
			await doJoinRoom(document.getElementById('new-room-name').value)
		} finally {
			setIsLoading(target, false)
		}
	})
	leaveRoomBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		try {
			await doLeaveRoom(document.getElementById('new-room-name').value)
		} finally {
			setIsLoading(target, false)
		}
	})

	serverAddressInput.addEventListener('input', async (e) => {
		const newAddress = e.currentTarget.value
		await updateServerAddress(newAddress)
	})

	const updateServerAddress = async (newAddress) => {
		await sendMessageToBG('set_server_address', newAddress)
	}
	let storedServerAddress = ''
	let errorOnAddress = false
	try {
		storedServerAddress = await sendMessageToBG('get_server_address')
	} catch (e) {
		errorOnAddress = true
		fail(`Error getting stored server address: ${e.message}`)
	}
	if (storedServerAddress) {
		serverAddressInput.value = storedServerAddress
	} else if (!errorOnAddress) {
		await updateServerAddress(serverAddressInput.value)
	}

	recheckBtn?.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		try {
			const found = await recheckVideoFrames()
			if (found) success('Video found')
			else fail('No video found in any frame')
		} catch (err) {
			fail(`Recheck failed: ${err.message}`)
		}
		setIsLoading(target, false)
	})

	// Live updates pushed by the background.
	chrome.runtime.onMessage.addListener((message) => {
		if (message?.type === 'connection_state') {
			if (!activeRoomName) return
			if (message.data?.connected) {
				// The count that follows the rejoin will overwrite this.
				roomUserCountElem.textContent = 'Reconnected'
			} else {
				roomUserCountElem.textContent = 'Disconnected — reconnecting…'
			}
			return
		}
		if (message?.type !== 'room_user_count') return
		const { roomName, userCount } = message.data || {}
		// Ignore counts for a room another tab is in.
		if (roomName !== (activeRoomName ?? currentRoomName())) return
		updateRoomUserCount(roomName, userCount)
	})

	// Restore the active room (if any) so a reopened popup isn't blank/stale.
	const roomStatus = await sendMessageToBG('get_room_status', {
		tabId: await getCurrentTabId(),
	})
	if (roomStatus?.roomName) {
		activeRoomName = roomStatus.roomName
		activeIsOwner = !!roomStatus.isOwner
		document.getElementById('new-room-name').value = roomStatus.roomName
		updateRoomUserCount(roomStatus.roomName, roomStatus.userCount)
	}
}
