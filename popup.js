import { toast } from './lib/wc-toast.js'

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
if (
	!url.startsWith('https://www.youtube.com/') &&
	!url.startsWith('https://music.youtube.com/') &&
	!url.startsWith('https://open.spotify.com/')
) {
	document.body.innerHTML =
		"<p style='padding:1em;font-size:1.1em;'>This extension only works on YouTube and Spotify.<br>Please open one of those sites to use Syncer.</p>"
} else {
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

	const sendMessageToCurrTab = async (type, roomName, throwError = false) => {
		// console.log(`Sending message to current tab: ${type}`);
		let res
		const currTabId = await getCurrentTabId()
		try {
			res = await chrome.tabs.sendMessage(currTabId, {
				type: type,
				roomName: roomName,
			})
		} catch (e) {
			if (throwError) throw e
			fail(`Failed on: ${type}: ${e.message}`)
			res = null
		}
		console.log(`got resp from curr tab: ${res}`)
		return res
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

	listRoomsBtn.addEventListener('click', async (e) => {
		const target = e.currentTarget
		setIsLoading(target, true)
		const currRoomName = document.getElementById('new-room-name').value
		const result = await sendMessageToCurrTab('list_rooms', currRoomName)
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
				roomList.textContent += room + '\n'
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
		const result = await sendMessageToCurrTab('create_room', currRoomName)
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
		const result = await sendMessageToCurrTab('join_room', currRoomName)
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
		const result = await sendMessageToCurrTab('leave_room', currRoomName)
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
		await sendMessageToCurrTab('set_server_address', newAddress)
	}
	let storedServerAddress = ''
	let errorOnAddress = false
	try {
		storedServerAddress = await sendMessageToCurrTab('get_server_address', null, true)
	} catch (e) {
		errorOnAddress = true
		fail(`Error getting stored server address: ${e.message}`)
	}
	if (storedServerAddress) {
		serverAddressInput.value = storedServerAddress
	} else if (!errorOnAddress) {
		await updateServerAddress(serverAddressInput.value)
	}

	// chrome.runtime.onMessage.addListener(async (message, sender, reply) => {
	//     // if (!sender.tab) return
	//     const offsetMs = message.offsetMs
	//     if (offsetMs) chrome.storage.sync.set({ offsetMs: offsetMs })
	//     reply()
	// })
}
