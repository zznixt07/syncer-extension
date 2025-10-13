// const src = chrome.runtime.getURL('lib/socket.io.min.js')
// const contentMain = await import(src)
// const { io } = contentMain

import { io } from '/lib/socket.io.min.js'

const EXT_ID = `${chrome.runtime.id}`
const STORAGE_KEY = `${EXT_ID}_prev_room`
const SERVER_KEY = `${EXT_ID}_server`
const URLS_REDIRECTS_COUNT = {}

const log = (...msg) => {
	// console.log('BG:', ...msg)
}

/*
------ a way to make service workers persistent --------
Thx wOxxOm. Source: https://stackoverflow.com/a/66618269/12091475
*/
// <Necessary Code>
chrome.runtime.onConnect.addListener((port) => {
	if (port.name !== 'foo') return
	port.onMessage.addListener(onMessage)
	port.onDisconnect.addListener(deleteTimer)
	port._timer = setTimeout(forceReconnect, 250e3, port)
})

function onMessage(msg, port) {
	console.log('received', msg, 'from', port.sender)
}
function forceReconnect(port) {
	deleteTimer(port)
	port.disconnect()
}
function deleteTimer(port) {
	if (port._timer) {
		clearTimeout(port._timer)
		delete port._timer
	}
}
// </Necessary Code>

const incrementRedirectCount = (url) => {
	if (URLS_REDIRECTS_COUNT[url] === undefined) {
		URLS_REDIRECTS_COUNT[url] = {
			count: 0,
			lastUpdated: new Date().getTime(),
		}
	}
	URLS_REDIRECTS_COUNT[url].count += 1
	URLS_REDIRECTS_COUNT[url].lastUpdated = new Date().getTime()
}

const getRedirectInfo = (url) => {
	if (URLS_REDIRECTS_COUNT[url] === undefined) {
		return {
			count: 0,
			lastUpdated: new Date().getTime(),
		}
	}
	return URLS_REDIRECTS_COUNT[url]
}

const getServerAddress = async () => {
	const address = await chrome.storage.sync.get(SERVER_KEY)
	// log('fetched server address', address[SERVER_KEY])
	return address[SERVER_KEY]
}

let BASE_HOST
let SOCKET

const connectToWebSocket = async () => {
	try {
		BASE_HOST = await getServerAddress()
		SOCKET = io(BASE_HOST, {
			reconnectionAttempts: 5,
			transports: ['websocket'],
		})
	} catch (e) {
		log('Error', e)
	}
	return await new Promise((resolve) => {
		SOCKET.on('connect', () => {
			resolve({ success: true, data: { message: 'connected successfully' } })
		})
		SOCKET.on('connect_error', (error) => {
			resolve({
				success: false,
				data: {
					message: 'error connecting to websocket.',
					dbg: error.toString(),
				},
			})
		})
	})
}

const socket_emit = async (eventName, data) => {
	return await new Promise((resolve) => {
		if (data === undefined) {
			SOCKET.emit(eventName, (result) => resolve(result))
		} else {
			SOCKET.emit(eventName, data, (result) => resolve(result))
		}
	})
}

const createRoom = async ({ roomName, meta }) => {
	return await socket_emit('create_room', { roomName: roomName, data: meta })
}

const listRooms = async () => {
	return await socket_emit('list_rooms')
}

const joinRoom = async ({ roomName }) => {
	return await socket_emit('join_room', { roomName: roomName })
}

const leaveRoom = async ({ roomName }) => {
	return await socket_emit('leave_room', { roomName: roomName })
}

const sendMediaEvent = ({ roomName, meta }) => {
	return socket_emit('media_event', {
		roomName: roomName,
		data: meta,
	})
}

const sendStreamChangeEvent = ({ roomName, meta }) => {
	return socket_emit('stream_change', {
		roomName: roomName,
		data: meta,
	})
}

const requestEventFromOwner = ({ roomName }) => {
	return socket_emit('sync_room_data', { roomName: roomName })
}

const sendMsgToTab = (tabId, success, msg) =>
	chrome.tabs.sendMessage(tabId, { success: success, data: msg })

let LISTEN_EVTS_CALLED = 0
const listenToEvents = (tabId) => {
	log('Number of times listenEvents() was called:', LISTEN_EVTS_CALLED++)
	// TODO: use a for loop here to make code DRYer
	SOCKET.on('media_event', (result) => {
		log('media event')
		chrome.tabs.sendMessage(tabId, { type: 'media_event', data: result })
	})
	SOCKET.on('sync_room_data', (result) => {
		chrome.tabs.sendMessage(tabId, { type: 'sync_room_data', data: result })
	})
	SOCKET.on('stream_change', (result) => {
		chrome.tabs.sendMessage(tabId, { type: 'stream_change', data: result })
	})
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
	// if u want to use await, do not use async function as event listener fn.
	// instead use an async IIFE inside the event listener and return true from the event listener;
	;(async () => {
		log('message received', message)
		if (!message) {
			reply({})
		} else if (message.type === 'set_prev_room') {
			await chrome.storage.sync.set({ [STORAGE_KEY]: message.data })
			reply()
		} else if (message.type === 'set_storage') {
			const { key, value } = message.data
			await chrome.storage.sync.set({ [`${STORAGE_KEY}_${key}`]: value })
			reply(value)
		} else if (message.type === 'get_storage') {
			const { key } = message.data
			const values = await chrome.storage.sync.get(`${STORAGE_KEY}_${key}`)
			reply(values[`${STORAGE_KEY}_${key}`])
		} else if (message.type === 'get_prev_room') {
			const prevRoom = await chrome.storage.sync.get(STORAGE_KEY)
			reply(prevRoom[STORAGE_KEY])
		} else if (message.type === 'remove_prev_room') {
			await chrome.storage.sync.remove(STORAGE_KEY)
			reply()
		} else if (message.type === 'set_server_address') {
			await chrome.storage.sync.set({ [SERVER_KEY]: message.data })
			reply()
		} else if (message.type === 'get_server_address') {
			reply(await getServerAddress())
		} else {
			// gotta connect socket for these.
			let resp
			if (!SOCKET || !SOCKET.connected) {
				// log('connecting to socket for the first time.')
				resp = await connectToWebSocket()
			}
			if (message.type === 'websocket_connect') {
				if (resp) {
					reply(resp)
				} else {
					// log('already connected to websocket.')
					reply({
						success: true,
						data: { message: 'already connected to websocket' },
					})
				}
			} else if (message.type === 'create_room') {
				const res = await createRoom(message.data)
				if (res.success) listenToEvents(sender.tab.id)
				reply(res)
			} else if (message.type === 'join_room') {
				const res = await joinRoom(message.data)
				if (res.success) listenToEvents(sender.tab.id)
				reply(res)
			} else if (message.type === 'list_rooms') {
				reply(await listRooms())
			} else if (message.type === 'leave_room') {
				reply(await leaveRoom(message.data))
			} else if (message.type === 'media_event') {
				sendMediaEvent(message.data)
				reply()
			} else if (message.type === 'sync_room_data') {
				requestEventFromOwner(message.data)
				reply()
			} else if (message.type === 'stream_change') {
				sendStreamChangeEvent(message.data)
				reply()
			} else if (message.type === 'remove_all_listeners') {
				SOCKET.removeAllListeners()
				reply()
			} else if (message.type === 'increment_redirect_count') {
				incrementRedirectCount(message.data.url)
				reply()
			} else if (message.type === 'get_url_redirect_info') {
				reply(getRedirectInfo(message.data.url))
			}
		}
	})()
	return true
})
