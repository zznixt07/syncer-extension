// const src = chrome.runtime.getURL('lib/socket.io.min.js')
// const contentMain = await import(src)
// const { io } = contentMain

// Declare chrome as a global variable for linting tools
/* global chrome */

import {io} from 'socket.io-client'
import {hostMediaFallbackFromEvent} from 'syncer-extension-core'

const EXT_ID = `${chrome.runtime.id}`
const STORAGE_KEY = `${EXT_ID}_prev_room`
const SERVER_KEY = `${EXT_ID}_server`
const ROOM_TOKEN_PREFIX = `${EXT_ID}_room_token_`
const URLS_REDIRECTS_COUNT = {}
const CONNECT_TIMEOUT_MS = 5000
const SOCKET_ACK_TIMEOUT_MS = 5000
const HOST_MEDIA_KEY_PREFIX = `${EXT_ID}_host_media_`

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
            // A blip used to drop the room silently and permanently. Keep
            // retrying; resumeSessions() rejoins whatever we were in.
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 8000,
            timeout: CONNECT_TIMEOUT_MS,
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

// Auto-reconnect may already be in flight. Wait for it rather than tearing the
// socket down and starting over, which would abandon the retry backoff.
const RECONNECT_WAIT_MS = 3000
const waitForConnection = () => {
    return new Promise((resolve) => {
        if (!SOCKET) return resolve(false)
        if (SOCKET.connected) return resolve(true)
        const onConnect = () => {
            clearTimeout(timer)
            resolve(true)
        }
        const timer = setTimeout(() => {
            SOCKET?.off('connect', onConnect)
            resolve(false)
        }, RECONNECT_WAIT_MS)
        SOCKET.once('connect', onConnect)
    })
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

const hostMediaKey = (tabId) => `${HOST_MEDIA_KEY_PREFIX}${tabId}`

const getHostMedia = async (tabId) => {
	if (tabId == null) return null
	const key = hostMediaKey(tabId)
	const stored = await chrome.storage.session.get(key)
	return stored[key] || null
}

const clearHostMedia = async (tabId) => {
	if (tabId == null) return
	await chrome.storage.session.remove(hostMediaKey(tabId))
	chrome.runtime.sendMessage({ type: 'host_media', data: { tabId, media: null } }).catch(() => {})
}

const updateHostMedia = async (tabId, event) => {
	const media = hostMediaFallbackFromEvent(event)
	if (!media) return clearHostMedia(tabId)
	await chrome.storage.session.set({ [hostMediaKey(tabId)]: media })
	chrome.runtime.sendMessage({ type: 'host_media', data: { tabId, media } }).catch(() => {})
}

let LISTEN_EVTS_CALLED = 0
/*
frameId is not captured here on purpose. A reload replaces every frame in the
tab, so an id captured at bind time is dead by the time the next event arrives.
The routing layer reads videoFrameMap at send time instead.
*/
const listenToEvents = (tabId) => {
    log('Number of times listenEvents() was called:', LISTEN_EVTS_CALLED++)

    // Remove previous socket event listeners so they don't stack
    SOCKET.removeAllListeners('media_event')
    SOCKET.removeAllListeners('sync_room_data')
    SOCKET.removeAllListeners('stream_change')

    SOCKET.on('media_event', (result) => {
        log('media event')
        queueOrRouteRoomEvent(tabId, 'media_event', result)
    })
    SOCKET.on('sync_room_data', (result) => {
        queueOrRouteRoomEvent(tabId, 'sync_room_data', result)
    })
    SOCKET.on('stream_change', (result) => {
        queueOrRouteRoomEvent(tabId, 'stream_change', result)
    })
}

// Track active room sessions per tab so we can re-route when a video frame registers later
// Map<tabId, { roomName, isOwner }>
const activeTabSessions = new Map()

// The server replays a room snapshot immediately after join_room is
// acknowledged. The socket handlers have to be attached before that request,
// but the receiving content frame is not configured until the acknowledgement
// has been processed. Keep that small gap lossless.
// Map<tabId, Array<{ type: string, data: unknown }>>
const pendingRoomEvents = new Map()

// A page that takes its time loading must not grow this without bound; the
// newest events are the ones worth replaying anyway.
const MAX_PENDING_ROOM_EVENTS = 10

const routeRoomEvent = (tabId, type, data) => {
    if (type === 'media_event' || type === 'stream_change') {
        updateHostMedia(tabId, data).catch(() => {})
    }
    // Resolved now, not when the listener was bound: a reload swaps the frame.
    const frameId = videoFrameMap.get(tabId)
    const opts = frameId != null ? { frameId } : {}
    chrome.tabs.sendMessage(tabId, { type, data }, opts).catch(() => {})
}

const queueOrRouteRoomEvent = (tabId, type, data) => {
    // Two gaps to cover: before the join is acknowledged (no session yet) and
    // while a reload is in flight (session kept, but every frame is gone).
    // Sending into either one is a silent drop, so hold the event instead.
    if (activeTabSessions.has(tabId) && videoFrameMap.has(tabId)) {
        routeRoomEvent(tabId, type, data)
        return
    }
    const events = pendingRoomEvents.get(tabId) || []
    events.push({ type, data })
    pendingRoomEvents.set(tabId, events.slice(-MAX_PENDING_ROOM_EVENTS))
}

const flushRoomEvents = (tabId) => {
    const events = pendingRoomEvents.get(tabId)
    pendingRoomEvents.delete(tabId)
    events?.forEach(({ type, data }) => routeRoomEvent(tabId, type, data))
}

/*
MV3 terminates the service worker when it goes idle, taking SOCKET and every
Map in this file with it. Mirror the sessions into storage.session (which is
in-memory and cleared on browser restart, so it can't resurrect a stale room
days later) and rebuild on wake.
*/
const SESSIONS_KEY = `${EXT_ID}_active_sessions`

const persistSessions = () => {
    return chrome.storage.session
        .set({ [SESSIONS_KEY]: [...activeTabSessions] })
        .catch(() => {})
}

const setSession = (tabId, session) => {
    activeTabSessions.set(tabId, session)
    return persistSessions()
}

const deleteSession = (tabId) => {
    forgetNavigation(tabId)
	clearHostMedia(tabId).catch(() => {})
	pendingRoomEvents.delete(tabId)
	lastSnapshotRequest.delete(tabId)
    if (!activeTabSessions.delete(tabId)) return Promise.resolve()
    return persistSessions()
}

// Map<tabId, frameId> — which frame owns the video
const videoFrameMap = new Map()

/*
The probe injects into every frame and retries, so one page load can produce
several register_video_frame messages. Asking the host for a snapshot is cheap
but not free — it makes the host broadcast to the whole room — so rate-limit it.
*/
// Map<tabId, timestamp>
const lastSnapshotRequest = new Map()
const SNAPSHOT_REQUEST_THROTTLE_MS = 5000

const shouldRequestSnapshot = (tabId) => {
    const now = Date.now()
    const last = lastSnapshotRequest.get(tabId)
    if (last != null && now - last < SNAPSHOT_REQUEST_THROTTLE_MS) return false
    lastSnapshotRequest.set(tabId, now)
    return true
}

/*
--- Following the host to the next episode ---

The content script cannot notice a full page load: it *is* the new page, with
no memory of the URL it replaced. So the owner's navigation is detected here,
where we outlive it. chrome.tabs.onUpdated covers both kinds of move — a real
load (status) and an SPA pushState (changeInfo.url) — so one detector does.
*/

// Map<tabId, string> — the last top URL we broadcast, so a redirect chain or a
// repeated onUpdated for the same URL doesn't emit twice.
const lastBroadcastUrl = new Map()
// Map<tabId, timeoutId> — settle debounce in flight
const pendingNav = new Map()
const NAV_SETTLE_MS = 800
// Heavy players mount their <video> well after the page reports 'complete'.
const NAV_VIDEO_RETRIES = 12
const NAV_VIDEO_RETRY_MS = 1000

const forgetNavigation = (tabId) => {
    clearTimeout(pendingNav.get(tabId))
    pendingNav.delete(tabId)
    lastBroadcastUrl.delete(tabId)
}

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

// Tell the popup and the toolbar that we've dropped, so a dead session doesn't
// look like a live one.
const notifyConnectionState = (connected) => {
    chrome.runtime
        .sendMessage({ type: 'connection_state', data: { connected } })
        .catch(() => {})
    for (const tabId of activeTabSessions.keys()) {
        chrome.action.setTitle({
            tabId,
            title: connected ? 'Syncer' : 'Syncer: disconnected — reconnecting…',
        }).catch(() => {})
        if (!connected) setBadge(tabId, '…')
    }
}

// After a reconnect the socket has a new id, so the server no longer has us in
// any room. Rejoin everything we were in. Owners present their stored token and
// reclaim, which is exactly what the token is for.
let _resuming = false
const resumeSessions = async () => {
    if (_resuming || activeTabSessions.size === 0) return
    _resuming = true
    try {
        for (const [tabId, session] of [...activeTabSessions]) {
            const res = await joinRoom({ roomName: session.roomName })
            if (!res?.success) {
                log('Could not resume room', session.roomName, res?.data?.message)
                continue
            }
            session.isOwner = !!res.data?.isOwner
            listenToEvents(tabId)
            applyUserCount(session.roomName, res.data?.userCount)
            try {
                await chrome.tabs.sendMessage(
                    tabId,
                    {
                        type: 'setup_after_join',
                        roomName: session.roomName,
                        isOwner: session.isOwner,
                    },
                    videoFrameMap.get(tabId) != null
                        ? { frameId: videoFrameMap.get(tabId) }
                        : {}
                )
            } catch (_) { /* tab may be gone or not ready */ }
        }
    } finally {
        _resuming = false
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
    SOCKET.removeAllListeners('connect')
    SOCKET.on('connect', () => {
        log('socket connected')
        notifyConnectionState(true)
        resumeSessions()
    })
    SOCKET.removeAllListeners('disconnect')
    SOCKET.on('disconnect', (reason) => {
        log('socket disconnected', reason)
        notifyConnectionState(false)
    })
}

chrome.tabs.onRemoved.addListener((tabId) => {
    videoFrameMap.delete(tabId)
    deleteSession(tabId)
    setBadge(tabId, '')
})
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        videoFrameMap.delete(tabId)
        // Don't delete activeTabSessions here — the session persists across navigation
        // (the rejoined page needs it to re-route listeners)
    }

    const session = activeTabSessions.get(tabId)
    if (!session) return

    // A load replaced every frame, so the video frame has to announce itself
    // again before anything can be routed to it.
    if (changeInfo.status === 'complete') {
        waitForVideoFrame(tabId)
        // Chrome clears tab-scoped action state on navigation, so a reloaded
        // tab silently loses its user count and keeps a stale title.
        updateBadgeForRoom(session.roomName)
        chrome.action.setTitle({ tabId, title: 'Syncer' }).catch(() => {})
    }

    // changeInfo.url covers SPA history navigation, which never reports a
    // status at all; 'complete' covers a real load.
    if (changeInfo.url || changeInfo.status === 'complete') {
        scheduleStreamChange(tabId)
    }
})

/*
Ask every frame in the tab whether it has a video; the ones that do answer with
register_video_frame, which is what populates videoFrameMap.
*/
const probeForVideoFrame = async (tabId) => {
    try {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: () => {
                if (document.querySelector('video')) {
                    chrome.runtime.sendMessage({ type: 'register_video_frame' })
                }
            },
        })
    } catch (e) {
        log('Video frame probe failed:', e.message)
    }
}

// Map<tabId, Promise<boolean>> — so the rescan and the pending broadcast for
// the same tab share one probe loop instead of racing two.
const videoFrameWaits = new Map()

const waitForVideoFrame = (tabId) => {
    if (videoFrameMap.has(tabId)) return Promise.resolve(true)
    const existing = videoFrameWaits.get(tabId)
    if (existing) return existing

    const wait = (async () => {
        for (let attempt = 0; attempt < NAV_VIDEO_RETRIES; attempt++) {
            if (!activeTabSessions.has(tabId)) return false
            await probeForVideoFrame(tabId)
            // register_video_frame arrives as a separate message, so give it a
            // moment to land before deciding this attempt failed.
            await new Promise((r) => setTimeout(r, NAV_VIDEO_RETRY_MS))
            if (videoFrameMap.has(tabId)) return true
        }
        return false
    })().finally(() => videoFrameWaits.delete(tabId))

    videoFrameWaits.set(tabId, wait)
    return wait
}

/*
Only the owner broadcasts, and only once the tab has come to rest: clicking
"next episode" can bounce through two or three redirects, and each one shows up
here.
*/
const scheduleStreamChange = (tabId) => {
    if (!activeTabSessions.get(tabId)?.isOwner) return
    clearTimeout(pendingNav.get(tabId))
    pendingNav.set(
        tabId,
        setTimeout(() => emitStreamChangeForTab(tabId), NAV_SETTLE_MS)
    )
}

const emitStreamChangeForTab = async (tabId) => {
    pendingNav.delete(tabId)
    if (!activeTabSessions.get(tabId)?.isOwner) return

    // Read the URL now rather than when this was scheduled — the point of the
    // debounce is that the URL at schedule time may already be stale.
    const url = await getTopFrameUrl(tabId)
    if (!url || lastBroadcastUrl.get(tabId) === url) return

    // Don't drag the room onto a menu or a search page.
    if (!(await waitForVideoFrame(tabId))) {
        log('No video appeared, not broadcasting:', url)
        return
    }
    // The tab may have moved on again while we waited.
    if ((await getTopFrameUrl(tabId)) !== url) return
    if (!activeTabSessions.get(tabId)?.isOwner) return

    lastBroadcastUrl.set(tabId, url)
    // register_video_frame has already sent setup_after_join, so IS_OWNER is
    // back in place on the new page and this will actually broadcast.
    await chrome.tabs
        .sendMessage(tabId, { type: 'emit_stream_change' }, { frameId: videoFrameMap.get(tabId) })
        .catch(() => {})
}

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
        if (message.type === 'room_user_count' || message.type === 'host_media') {
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
		} else if (message.type === 'get_host_media') {
			sendResponse(await getHostMedia(message.data?.tabId))
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
                // We were sent here; don't turn round and broadcast it back if
                // this tab later becomes the owner.
                lastBroadcastUrl.set(tabId, message.data.url)
                await chrome.tabs.update(tabId, { url: message.data.url })
            }
            sendResponse({ success: true })
        } else if (message.type === 'register_video_frame') {
            const tabId = sender.tab?.id
            const frameId = sender.frameId
            if (tabId != null && frameId != null) {
                const isNewFrame = videoFrameMap.get(tabId) !== frameId
                videoFrameMap.set(tabId, frameId)
                log(`Registered video frame: tab=${tabId}, frame=${frameId}`)

                // If there's an active session for this tab, re-route socket events
                // to the newly registered video frame and set it up
                const session = activeTabSessions.get(tabId)
                if (session && SOCKET?.connected) {
                    listenToEvents(tabId)
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
                    // Only now: setup_after_join resets the sequence gate, so
                    // anything replayed before it would be rejected as stale.
                    flushRoomEvents(tabId)
                    /*
                    A reload leaves the socket — and therefore the room — intact,
                    but the new page starts paused at zero and nobody has told it
                    otherwise. Without this the guest waits for the host's next
                    play/pause, or for the host's 60s corrective snapshot.
                    */
                    if (isNewFrame && !session.isOwner && shouldRequestSnapshot(tabId)) {
                        requestEventFromOwner({ roomName: session.roomName })
                    }
                }
            }
            sendResponse({ success: true })
        } else if (message.type === 'has_video_frame') {
            const found = videoFrameMap.has(message.tabId)
            sendResponse({ success: true, found })
        } else if (message.type === 'playback_blocked') {
            // Autoplay policy stopped us resuming. Say so in the toolbar tooltip
            // rather than the badge, which is showing the user count.
            const tabId = sender.tab?.id
            if (tabId != null) {
                chrome.action.setTitle({
                    tabId,
                    title: message.data?.blocked
                        ? 'Syncer: playback blocked — click the page to resume'
                        : 'Syncer',
                }).catch(() => {})
            }
            sendResponse({ success: true })
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
            const configuredAddress = await getServerAddress()
            if (!configuredAddress) {
                resp = { success: false, data: { message: 'no stored address' } }
            } else if (!SOCKET || _lastAttemptedAddress !== configuredAddress) {
                // Saving a new address is debounced for typing, but a room
                // command must never use a socket that still points at the old
                // server while that debounce is pending.
                resp = await connectImmediate(configuredAddress)
            } else if (!SOCKET.connected) {
                const reconnected = await waitForConnection()
                if (!reconnected) {
                    resp = {
                        success: false,
                        data: { message: 'websocket is reconnecting, try again' },
                    }
                }
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
						if (message.data.meta.media) message.data.meta.media.url = topUrl
                    }
                }
                const res = await createRoom(message.data)
                if (res.success) {
                    const tabId = sender.tab.id
					await clearHostMedia(tabId)
                    const frameId = videoFrameMap.get(tabId) ?? sender.frameId
                    // Routing reads videoFrameMap, so the creating frame has to
                    // be in it even when the probe never ran for this tab.
                    if (frameId != null) videoFrameMap.set(tabId, frameId)
                    // Track the session so the owner also gets a badge and a
                    // restorable popup, same as join_room does.
                    await setSession(tabId, {
                        roomName: message.data.roomName,
                        isOwner: true,
                    })
                    listenToEvents(tabId)
                    applyUserCount(message.data.roomName, res.data?.userCount)
                }
                sendResponse(res)
            } else if (message.type === 'join_room') {
                const tabId = message.data?.tabId ?? sender.tab?.id
                const frameId = tabId != null ? videoFrameMap.get(tabId) : undefined

                // The server acknowledges a join and then immediately replays
                // the latest stream/playback snapshot. Install the per-tab
                // handlers before emitting join_room so that first stream_change
                // cannot arrive in the gap after the acknowledgement.
                if (tabId != null) {
                    pendingRoomEvents.delete(tabId)
                    listenToEvents(tabId)
                }

                const res = await joinRoom(message.data)
                if (res.success) {
                    if (tabId != null) {
						await clearHostMedia(tabId)
                        // Track the active session
                        await setSession(tabId, {
                            roomName: message.data.roomName,
                            isOwner: res.data?.isOwner,
                        })

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
                    // Replay events received between join_room and
                    // setup_after_join are now safe to apply in order.
                    if (tabId != null) {
                        flushRoomEvents(tabId)
                    }
                    applyUserCount(message.data.roomName, res.data?.userCount)
                } else if (tabId != null) {
                    pendingRoomEvents.delete(tabId)
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
                        await deleteSession(tabId)
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

/* --- Recovering from service worker termination ---
Everything above lives in memory, so a terminated worker wakes up believing it
is in no rooms while the user's tabs think they are still synced. Rebuild from
storage.session and rejoin. */
const restoreSessions = async () => {
    const stored = await chrome.storage.session.get(SESSIONS_KEY)
    const entries = stored?.[SESSIONS_KEY]
    if (!Array.isArray(entries) || entries.length === 0) return

    for (const [tabId, session] of entries) {
        try {
            // the tab may have been closed while we were asleep
            await chrome.tabs.get(tabId)
            activeTabSessions.set(tabId, session)
        } catch (_) { /* gone */ }
    }
    await persistSessions()
    if (activeTabSessions.size === 0) return

    // videoFrameMap died with the worker too, and content scripts already
    // running won't re-announce themselves unprompted.
    for (const tabId of activeTabSessions.keys()) {
        await probeForVideoFrame(tabId)
    }

    if (!SOCKET || !SOCKET.connected) await connectToWebSocket()
    await resumeSessions()
}

const ensureSessionsAlive = async () => {
    try {
        if (activeTabSessions.size === 0) {
            // Either genuinely idle, or a fresh worker that lost everything.
            await restoreSessions()
            return
        }
        if (!SOCKET || !SOCKET.connected) {
            await connectToWebSocket()
            await resumeSessions()
        }
    } catch (e) {
        log('ensureSessionsAlive failed', e)
    }
}

// A timer is the only thing that will wake a terminated worker on its own —
// no tab or popup message is coming while the user just watches.
const SESSION_CHECK_ALARM = 'syncer-session-check'
chrome.alarms.create(SESSION_CHECK_ALARM, { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SESSION_CHECK_ALARM) return
    ensureSessionsAlive()
})

// Not awaited: MV3 requires the listeners above to be registered synchronously
// during evaluation, so recovery has to happen after that, not before.
ensureSessionsAlive()
