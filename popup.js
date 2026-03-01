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
			return await chrome.runtime.sendMessage({ type, data })
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
			const result = await chrome.runtime.sendMessage({
				type: 'forward_to_video_frame',
				tabId: currTabId,
				innerMessage: { type, roomName },
			})
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
	const recheckBtn = document.getElementById('recheck-video')

	// Scans all frames for a video element and registers the frame that has one
	const recheckVideoFrames = async () => {
		const currTabId = await getCurrentTabId()
		await chrome.scripting.executeScript({
			target: { tabId: currTabId, allFrames: true },
			func: () => {
				const video = document.querySelector('video')
				if (video) {
					chrome.runtime.sendMessage({ type: 'register_video_frame' })
				}
			},
		})
		const result = await chrome.runtime.sendMessage({
			type: 'has_video_frame',
			tabId: currTabId,
		})
		return !!result?.found
	}

	listRoomsBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		const currRoomName = document.getElementById('new-room-name').value
		const result = await sendMessageToBG('list_rooms')
		if (result?.success) {
			const dataList = document.getElementById('rooms')
			const roomList = document.querySelector('pre#rooms-list')
			dataList.innerHTML = ''
			roomList.textContent = ''
			const rooms = result.data.rooms
			if (rooms.length === 0) {
				roomList.textContent += 'No rooms found'
			}
			rooms.forEach((room) => {
				const option = document.createElement('option')
				option.value = room
				option.textContent = room
				dataList.appendChild(option)
				// roomList.textContent += room + '\n'

				const wrapper = document.createElement('div')
				wrapper.style.display = 'flex'
				wrapper.style.alignItems = 'center'
				wrapper.style.marginBottom = '4px'

				const roomNameSpan = document.createElement('span')
				roomNameSpan.textContent = room
				roomNameSpan.style.flexGrow = '1'

				const joinBtn = document.createElement('button')
				joinBtn.textContent = 'Join'
				joinBtn.className = 'btn'
				joinBtn.style.marginLeft = '8px'
				joinBtn.addEventListener('click', () => {
					document.getElementById('new-room-name').value = room
					joinRoomBtn.click() // Programmatically trigger the main join logic
				})
				wrapper.appendChild(roomNameSpan)
				wrapper.appendChild(joinBtn)
				roomList.appendChild(wrapper)
			})
		} else {
			fail(result?.data?.message)
		}
		setIsLoading(target, false)
	})
	createRoomBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		target.disabled = true
		const currRoomName = document.getElementById('new-room-name').value

		// Auto-recheck for video before creating room
		const found = await recheckVideoFrames()
		if (!found) {
			fail('No video found in any frame.')
			target.disabled = false
			return
		}

		const result = await sendMessageToVideoFrame('create_room', currRoomName)
		if (result?.success) {
			success(result.data.message)
		} else {
			fail(result?.data?.message)
		}
		target.disabled = false
	})
	joinRoomBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		const currRoomName = document.getElementById('new-room-name').value
		const currTabId = await getCurrentTabId()

		// Pre-register the video frame (if any) so background can target it
		await recheckVideoFrames()

		const result = await sendMessageToBG('join_room', { roomName: currRoomName, tabId: currTabId })
		if (result?.success) {
			success(result.data.message)
		} else {
			fail(result?.data?.message)
		}
		setIsLoading(target, false)
	})
	leaveRoomBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		const currRoomName = document.getElementById('new-room-name').value
		const currTabId = await getCurrentTabId()
		const result = await sendMessageToBG('leave_room', { roomName: currRoomName, tabId: currTabId })
		if (result?.success) {
			success(result.data.message)
		} else {
			fail(result?.data?.message)
		}
		setIsLoading(target, false)
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

	// chrome.runtime.onMessage.addListener(async (message, sender, reply) => {
	//     // if (!sender.tab) return
	//     const offsetMs = message.offsetMs
	//     if (offsetMs) chrome.storage.sync.set({ offsetMs: offsetMs })
	//     reply()
	// })
}
