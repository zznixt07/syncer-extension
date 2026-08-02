// const src = chrome.runtime.getURL('lib/socket.io.min.js')
// const contentMain = await import(src)
// const { io } = contentMain

// Declare chrome as a global variable for linting tools
/* global chrome */

import { io } from '/lib/socket.io.min.js'

const EXT_ID = `${chrome.runtime.id}`
const STORAGE_KEY = `${EXT_ID}_prev_room`
const SERVER_KEY = `${EXT_ID}_server`
const ROOM_TOKEN_PREFIX = `${EXT_ID}_room_token_`
const URLS_REDIRECTS_COUNT = {}
const CONNECT_TIMEOUT_MS = 5000
const SOCKET_ACK_TIMEOUT_MS = 5000

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

const getRoomToken = async (roomName) => {
	const key = `${ROOM_TOKEN_PREFIX}${roomName}`
	const result = await chrome.storage.local.get(key)
	return result[key] || null
}

const setRoomToken = async (roomName, token) => {
	const key = `${ROOM_TOKEN_PREFIX}${roomName}`
	await chrome.storage.local.set({ [key]: token })
}

const removeRoomToken = async (roomName) => {
	const key = `${ROOM_TOKEN_PREFIX}${roomName}`
	await chrome.storage.local.remove(key)
}

let BASE_HOST
let SOCKET

// debounce/connect management
let _pendingConnectTimer = null
const DEBOUNCE_MS = 1500
let _lastSavedAddress = null
let _lastAttemptedAddress = null

const disconnectSocket = async () => {
    if (!SOCKET) return
    try {
        
		// remove our known event handlers (clear all to be safe)
		try {
			SOCKET.removeAllListeners && SOCKET.removeAllListeners()
		} catch (e) {
			/* ignore */
		}
        
        if (typeof SOCKET.disconnect === 'function') {
            SOCKET.disconnect()
        } else if (typeof SOCKET.close === 'function') {
            SOCKET.close()
        }
    } catch (e) {
        log('Error while disconnecting socket', e)
    } finally {
        SOCKET = null
        _lastAttemptedAddress = null
        // Without a socket we are in no room, so any cached count is meaningless.
        clearAllUserCounts()
    }
}

async function connectImmediate(address) {
    disconnectSocket()
    if (!address) {
        log('No server address provided, skipping connect.')
        return { success: false, data: { message: 'no address' } }
    }

    _lastAttemptedAddress = address
    BASE_HOST = address

    try {
        SOCKET = io(address, {
            reconnectionAttempts: 0,
            reconnection: false,
            transports: ['websocket'],
        })
        // Attach before the connect promise resolves so no broadcast is missed.
        attachGlobalSocketListeners()
    } catch (e) {
        log('Error creating socket', e)
        SOCKET = null
        return { success: false, data: { message: 'failed to create socket', dbg: e.toString() } }
    }

    return await new Promise((resolve) => {
        SOCKET.once('connect', () => {
            resolve({ success: true, data: { message: 'connected successfully' } })
        })
        // if connect_error occurs, resolve with error
        SOCKET.once('connect_error', (error) => {
            resolve({
                success: false,
                data: {
                    message: 'error connecting to websocket.',
                    dbg: error && error.toString ? error.toString() : String(error),
                },
            })
        })
        // fallback timeout to avoid hanging forever
        setTimeout(() => {
            if (!SOCKET || !SOCKET.connected) {
                resolve({
                    success: false,
                    data: { message: 'connection timeout' },
                })
            }
        }, CONNECT_TIMEOUT_MS)
    })
}

// Debounced entrypoint — call this on every input change but it will only connect
// after the value remains stable for DEBOUNCE_MS and is different from last attempted address.
const scheduleConnect = (address) => {
    _lastSavedAddress = address

    if (_pendingConnectTimer) {
        clearTimeout(_pendingConnectTimer)
        _pendingConnectTimer = null
    }
    _pendingConnectTimer = setTimeout(async () => {
        _pendingConnectTimer = null
        const addr = _lastSavedAddress
        if (!addr) {
            disconnectSocket()
            return
        }
        if (addr === _lastAttemptedAddress && SOCKET && SOCKET.connected) {
            log('Address unchanged and socket already connected, skipping connect.')
            return
        }
        await connectImmediate(addr)
    }, DEBOUNCE_MS)
}

const connectToWebSocket = async () => {
    const addr = await getServerAddress()
    if (addr) {
        return await connectImmediate(addr)
    }
    return { success: false, data: { message: 'no stored address' } }
}

const socket_emit = async (eventName, data) => {
	return await new Promise((resolve) => {
		if (!SOCKET || !SOCKET.connected) {
			resolve({
				success: false,
				data: { message: 'websocket is not connected' },
			})
			return
		}
		const timer = setTimeout(() => {
			resolve({
				success: false,
				data: { message: `${eventName} timed out` },
			})
		}, SOCKET_ACK_TIMEOUT_MS)
		const done = (result) => {
			clearTimeout(timer)
			resolve(result)
		}
		if (data === undefined) {
			SOCKET.emit(eventName, done)
		} else {
			SOCKET.emit(eventName, data, done)
		}
	})
}

const getServerTime = async () => {
	return await socket_emit('time_sync', {})
}

const createRoom = async ({ roomName, meta }) => {
	// Get existing token for potential reclamation
	const existingToken = await getRoomToken(roomName)
	const data = { ...meta }
	if (existingToken) {
		data.ownerToken = existingToken
	}
	
	const result = await socket_emit('create_room', { roomName: roomName, data: data })
	
	// Store the token on success (for new rooms or reclaimed rooms)
	if (result.success && result.data?.ownerToken) {
		await setRoomToken(roomName, result.data.ownerToken)
		log('Stored owner token for room:', roomName)
	}
	
	return result
}

const listRooms = async () => {
	return await socket_emit('list_rooms')
}

const joinRoom = async ({ roomName }) => {
	const existingToken = await getRoomToken(roomName)
	const data = {}
	if (existingToken) {
		data.ownerToken = existingToken
	}
	const result = await socket_emit('join_room', { roomName: roomName, data: data })

	// We presented a token and still weren't made owner, so it belongs to a room
	// that no longer exists (the server keeps rooms in memory only). Drop it
	// rather than keep claiming ownership of a name someone else now holds.
	if (existingToken && result.success && !result.data?.isOwner) {
		await removeRoomToken(roomName)
		log('Discarded stale owner token for room:', roomName)
	}

	return result
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
const listenToEvents = (tabId, frameId) => {
    log('Number of times listenEvents() was called:', LISTEN_EVTS_CALLED++)

    // Remove previous socket event listeners so they don't stack
    SOCKET.removeAllListeners('media_event')
    SOCKET.removeAllListeners('sync_room_data')
    SOCKET.removeAllListeners('stream_change')

    const opts = frameId != null ? { frameId } : {}

    SOCKET.on('media_event', (result) => {
        log('media event')
        chrome.tabs.sendMessage(tabId, { type: 'media_event', data: result }, opts)
    })
    SOCKET.on('sync_room_data', (result) => {
        chrome.tabs.sendMessage(tabId, { type: 'sync_room_data', data: result }, opts)
    })
    SOCKET.on('stream_change', (result) => {
        chrome.tabs.sendMessage(tabId, { type: 'stream_change', data: result }, opts)
    })
}

// Track active room sessions per tab so we can re-route when a video frame registers later
// Map<tabId, { roomName, isOwner }>
const activeTabSessions = new Map()

// Map<tabId, frameId> — which frame owns the video
const videoFrameMap = new Map()

// --- Room user count ---
// Map<roomName, userCount> — latest count broadcast by the server
const roomUserCounts = new Map()

const setBadge = (tabId, text) => {
    chrome.action.setBadgeText({ tabId, text }).catch(() => {})
    if (text) {
        // same blue as the popup toasts
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#00529b' }).catch(() => {})
    }
}

const updateBadgeForRoom = (roomName) => {
    const count = roomUserCounts.get(roomName)
    for (const [tabId, session] of activeTabSessions) {
        if (session.roomName !== roomName) continue
        // These tabs are in the room, so don't count ourselves. '0' is still
        // worth showing — it means "in a room, nobody else yet".
        const others = typeof count === 'number' ? Math.max(0, count - 1) : null
        setBadge(tabId, others == null ? '' : String(others))
    }
}

// Single fan-out point: cache the count, paint the badge, push to the popup.
const applyUserCount = (roomName, userCount) => {
    if (!roomName || typeof userCount !== 'number') return
    roomUserCounts.set(roomName, userCount)
    updateBadgeForRoom(roomName)
    // The popup is usually closed — that rejection is expected, not an error.
    chrome.runtime
        .sendMessage({ type: 'room_user_count', data: { roomName, userCount } })
        .catch(() => {})
}

const clearAllUserCounts = () => {
    roomUserCounts.clear()
    for (const tabId of activeTabSessions.keys()) {
        setBadge(tabId, '')
    }
}

// Socket handlers that are not tab-scoped. Several code paths call the bare
// SOCKET.removeAllListeners(), so this must be re-attached after each of them.
const attachGlobalSocketListeners = () => {
    if (!SOCKET) return
    SOCKET.removeAllListeners('room_user_count')
    SOCKET.on('room_user_count', (result) => {
        applyUserCount(result?.roomName, result?.userCount)
    })
}

chrome.tabs.onRemoved.addListener((tabId) => {
    videoFrameMap.delete(tabId)
    activeTabSessions.delete(tabId)
    setBadge(tabId, '')
})
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        videoFrameMap.delete(tabId)
        // Don't delete activeTabSessions here — the session persists across navigation
        // (the rejoined page needs it to re-route listeners)
    }

    // After redirect completes, auto-scan for video if there's an active session
    if (changeInfo.status === 'complete' && activeTabSessions.has(tabId)) {
        // Small delay to let iframes/video elements load
        setTimeout(async () => {
            if (!activeTabSessions.has(tabId)) return
            try {
                await chrome.scripting.executeScript({
                    target: { tabId, allFrames: true },
                    func: () => {
                        const video = document.querySelector('video')
                        if (video) {
                            chrome.runtime.sendMessage({ type: 'register_video_frame' })
                        }
                    },
                })
            } catch (e) {
                log('Auto video scan after redirect failed:', e.message)
            }
        }, 5000)
    }
})

// Commands that MUST go through the video frame
const VIDEO_FRAME_COMMANDS = new Set([
    'create_room',
    'media_event',
    'sync_room_data',
    'stream_change',
    'remove_all_listeners',
])

// Commands that should work from ANY frame (top frame preferred)
const ANY_FRAME_COMMANDS = new Set([
    'join_room',
    'leave_room',
    'list_rooms',
    'websocket_connect',
])

// Get the top-frame URL for a tab
const getTopFrameUrl = async (tabId) => {
    try {
        const tab = await chrome.tabs.get(tabId)
        return tab.url
    } catch (e) {
        return null
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    ;(async () => {
        log('message received', message)
        if (!message) {
            sendResponse({})
            return
        }

        // Pushed by us for the popup — never route it into the socket branch below.
        if (message.type === 'room_user_count') {
            sendResponse()
            return
        }

        // --- Storage / simple handlers ---
        if (message.type === 'set_prev_room') {
            await chrome.storage.sync.set({ [STORAGE_KEY]: message.data })
            sendResponse()
        } else if (message.type === 'set_storage') {
            const { key, value } = message.data
            await chrome.storage.sync.set({ [`${STORAGE_KEY}_${key}`]: value })
            sendResponse(value)
        } else if (message.type === 'get_storage') {
            const { key } = message.data
            const values = await chrome.storage.sync.get(`${STORAGE_KEY}_${key}`)
            sendResponse(values[`${STORAGE_KEY}_${key}`])
        } else if (message.type === 'get_prev_room') {
            const prevRoom = await chrome.storage.sync.get(STORAGE_KEY)
            sendResponse(prevRoom[STORAGE_KEY])
        } else if (message.type === 'remove_prev_room') {
            await chrome.storage.sync.remove(STORAGE_KEY)
            sendResponse()
        } else if (message.type === 'set_server_address') {
            const addr = String(message.data || '').trim()
            await chrome.storage.sync.set({ [SERVER_KEY]: addr })
            scheduleConnect(addr)
            sendResponse()
        } else if (message.type === 'get_server_address') {
            sendResponse(await getServerAddress())
        } else if (message.type === 'log') {
            console.log('log from content script:', message.data)
            sendResponse()
        } else if (message.type === 'increment_redirect_count') {
            incrementRedirectCount(message.data.url)
            sendResponse()
        } else if (message.type === 'get_url_redirect_info') {
            sendResponse(getRedirectInfo(message.data.url))

        // --- Video frame registration ---
        } else if (message.type === 'get_top_frame_url') {
            const tabId = sender.tab?.id
            if (tabId != null) {
                const topUrl = await getTopFrameUrl(tabId)
                sendResponse(topUrl || '')
            } else {
                sendResponse('')
            }
        } else if (message.type === 'navigate_tab') {
            const tabId = sender.tab?.id
            if (tabId != null && message.data?.url) {
                await chrome.tabs.update(tabId, { url: message.data.url })
            }
            sendResponse({ success: true })
        } else if (message.type === 'register_video_frame') {
            const tabId = sender.tab?.id
            const frameId = sender.frameId
            if (tabId != null && frameId != null) {
                videoFrameMap.set(tabId, frameId)
                log(`Registered video frame: tab=${tabId}, frame=${frameId}`)

                // If there's an active session for this tab, re-route socket events
                // to the newly registered video frame and set it up
                const session = activeTabSessions.get(tabId)
                if (session && SOCKET?.connected) {
                    listenToEvents(tabId, frameId)
                    try {
                        await chrome.tabs.sendMessage(
                            tabId,
                            {
                                type: 'setup_after_join',
                                roomName: session.roomName,
                                isOwner: session.isOwner,
                            },
                            { frameId }
                        )
                    } catch (_) { /* frame may not be ready */ }
                }
            }
            sendResponse({ success: true })
        } else if (message.type === 'has_video_frame') {
            const found = videoFrameMap.has(message.tabId)
            sendResponse({ success: true, found })
        } else if (message.type === 'get_room_status') {
            // Answered from cached state only — must never force a connect.
            const tabId = message.data?.tabId ?? sender.tab?.id
            const session = tabId != null ? activeTabSessions.get(tabId) : null
            sendResponse(
                session
                    ? {
                        roomName: session.roomName,
                        isOwner: session.isOwner,
                        userCount: roomUserCounts.get(session.roomName) ?? null,
                    }
                    : null
            )

        // --- Forward to video frame ---
        } else if (message.type === 'forward_to_video_frame') {
            const tabId = message.tabId
            const innerMsg = message.innerMessage
            const frameId = videoFrameMap.get(tabId)
            const needsVideoFrame = VIDEO_FRAME_COMMANDS.has(innerMsg.type)

            if (needsVideoFrame && frameId == null) {
                sendResponse({
                    success: false,
                    data: { message: 'No video frame registered. Click "Recheck Video" first.' },
                })
                return
            }

            // For video-frame commands, also inject the top-frame URL
            if (needsVideoFrame) {
                const topUrl = await getTopFrameUrl(tabId)
                if (topUrl) {
                    innerMsg.data = innerMsg.data || {}
                    innerMsg.data.topFrameUrl = topUrl
                }
            }

            try {
                // Route to video frame if registered & needed, otherwise top frame
                const opts = (frameId != null && needsVideoFrame) ? { frameId } : {}
                const result = await chrome.tabs.sendMessage(tabId, innerMsg, opts)
                sendResponse(result)
            } catch (e) {
                sendResponse({
                    success: false,
                    data: { message: e.message },
                })
            }

        // --- Socket-dependent commands (direct from content script) ---
        } else {
            let resp
            if (!SOCKET || !SOCKET.connected) {
                resp = await connectToWebSocket()
            }
            if (message.type === 'websocket_connect') {
                if (resp) {
                    sendResponse(resp)
                } else {
                    sendResponse({
                        success: true,
                        data: { message: 'already connected to websocket' },
                    })
                }
            } else if (resp && !resp.success) {
                sendResponse(resp)
            } else if (message.type === 'create_room') {
                // Inject top-frame URL into meta
                if (sender.tab?.id) {
                    const topUrl = await getTopFrameUrl(sender.tab.id)
                    if (topUrl && message.data?.meta) {
                        message.data.meta.url = topUrl
                    }
                }
                const res = await createRoom(message.data)
                if (res.success) {
                    const tabId = sender.tab.id
                    const frameId = videoFrameMap.get(tabId) ?? sender.frameId
                    // Track the session so the owner also gets a badge and a
                    // restorable popup, same as join_room does.
                    activeTabSessions.set(tabId, {
                        roomName: message.data.roomName,
                        isOwner: true,
                    })
                    listenToEvents(tabId, frameId)
                    applyUserCount(message.data.roomName, res.data?.userCount)
                }
                sendResponse(res)
            } else if (message.type === 'join_room') {
                const res = await joinRoom(message.data)
                if (res.success) {
                    const tabId = message.data?.tabId ?? sender.tab?.id
                    if (tabId != null) {
                        // Track the active session
                        activeTabSessions.set(tabId, {
                            roomName: message.data.roomName,
                            isOwner: res.data?.isOwner,
                        })

                        const frameId = videoFrameMap.get(tabId)
                        listenToEvents(tabId, frameId)

                        // Tell the video frame (if registered) to set up its state
                        if (frameId != null) {
                            try {
                                await chrome.tabs.sendMessage(
                                    tabId,
                                    {
                                        type: 'setup_after_join',
                                        roomName: message.data.roomName,
                                        isOwner: res.data?.isOwner,
                                    },
                                    { frameId }
                                )
                            } catch (_) { /* frame may not be ready yet */ }
                        }
                    }
                    applyUserCount(message.data.roomName, res.data?.userCount)
                }
                sendResponse(res)
            } else if (message.type === 'list_rooms') {
                sendResponse(await listRooms())
            } else if (message.type === 'leave_room') {
                const res = await leaveRoom(message.data)
                if (res.success) {
                    // Clean up active session
                    const tabId = message.data?.tabId ?? sender.tab?.id
                    const roomName = message.data?.roomName
                    if (tabId != null) {
                        activeTabSessions.delete(tabId)
                        setBadge(tabId, '')
                        const frameId = videoFrameMap.get(tabId)
                        if (frameId != null) {
                            try {
                                await chrome.tabs.sendMessage(
                                    tabId,
                                    { type: 'cleanup_after_leave', isOwner: res.data?.isOwner },
                                    { frameId }
                                )
                            } catch (_) { /* frame may be gone */ }
                        }
                    }
                    // Another tab may still hold this room on the shared socket;
                    // only forget the count once nobody local is left in it.
                    const stillJoined = [...activeTabSessions.values()].some(
                        (s) => s.roomName === roomName
                    )
                    if (stillJoined) {
                        applyUserCount(roomName, res.data?.userCount)
                    } else {
                        roomUserCounts.delete(roomName)
                    }
                    SOCKET.removeAllListeners()
                    attachGlobalSocketListeners()
                }
                sendResponse(res)
            } else if (message.type === 'media_event') {
                log('got media_event')
                sendMediaEvent(message.data)
                sendResponse()
            } else if (message.type === 'sync_room_data') {
                requestEventFromOwner(message.data)
                sendResponse()
            } else if (message.type === 'stream_change') {
                sendStreamChangeEvent(message.data)
                sendResponse()
            } else if (message.type === 'remove_all_listeners') {
                SOCKET?.removeAllListeners()
                attachGlobalSocketListeners()
                sendResponse()
            } else if (message.type === 'request_remote_time') {
                sendResponse(await getServerTime())
            }
        }
    })().catch((error) => {
        sendResponse({
            success: false,
            data: { message: error?.message || String(error) },
        })
    })
    return true
})
