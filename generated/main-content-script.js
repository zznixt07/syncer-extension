// node_modules/syncer-extension-core/dist/protocol.js
var states = /* @__PURE__ */ new Set(["play", "pause", "buffer", "ended"]);
var platforms = /* @__PURE__ */ new Set(["desktop", "android", "ios"]);
var adapters = /* @__PURE__ */ new Set(["html", "media-session", "youtube", "spotify"]);
var capabilityKeys = ["canPlay", "canPause", "canSeek", "canSetRate", "canLoadMedia"];
var isPlaybackEnvelopeV2 = (data) => Boolean(data?.version === 2 && Number.isFinite(data.capturedAtMs) && platforms.has(data.source?.platform) && adapters.has(data.source?.adapter) && typeof data.media?.isLive === "boolean" && states.has(data.playback?.state) && Number.isFinite(data.playback?.positionMs) && Number.isFinite(data.playback?.rate) && data.capabilities && capabilityKeys.every((key) => typeof data.capabilities[key] === "boolean"));
var normalizePlaybackEnvelope = (data) => isPlaybackEnvelopeV2(data) ? data : null;
var normalizePlaybackPayload = normalizePlaybackEnvelope;
var PlaybackSequenceGate = class {
  constructor() {
    this.value = 0;
  }
  get lastSequence() {
    return this.value;
  }
  accept(data = {}) {
    if (!Number.isFinite(data.sequence) || data.sequence <= this.value)
      return false;
    this.value = data.sequence;
    return true;
  }
  reset() {
    this.value = 0;
  }
};

// node_modules/syncer-extension-core/dist/sync-math.js
var HTML_IGNORE_MS = 50;
var HTML_HARD_SEEK_MS = 350;
var NUDGE_FACTOR = 0.02;
var NUDGE_DURATION_MS = 3e3;
var MAX_NUDGE_ATTEMPTS = 2;
var DRIFT_IGNORE_S = HTML_IGNORE_MS / 1e3;
var DRIFT_HARD_SEEK_S = HTML_HARD_SEEK_MS / 1e3;
var targetPositionMs = (positionMs, state, capturedAtMs, nowMs, rate = 1) => state === "play" ? positionMs + Math.max(0, nowMs - capturedAtMs) * rate : positionMs;
var targetTimeFor = (data, nowMs) => targetPositionMs(data.playback.positionMs, data.playback.state, data.capturedAtMs, nowMs, data.playback.rate) / 1e3;
var decideCorrection = ({ currentTime, targetTime, roomRate, isLive, isPaused, nudgeAttempts = 0 }) => {
  const drift = currentTime - targetTime;
  const magnitude = Math.abs(drift);
  if (magnitude >= DRIFT_HARD_SEEK_S)
    return { action: "seek", reason: "drift", drift };
  if (magnitude <= DRIFT_IGNORE_S)
    return { action: "ignore", drift };
  if (isLive || isPaused || nudgeAttempts >= MAX_NUDGE_ATTEMPTS)
    return { action: "seek", reason: "no-nudge", drift };
  const base = Number(roomRate) > 0 ? Number(roomRate) : 1;
  return { action: "nudge", rate: base * (drift > 0 ? 1 - NUDGE_FACTOR : 1 + NUDGE_FACTOR), base, drift };
};

// node_modules/syncer-extension-core/dist/media-controller.js
var MediaController = class {
  constructor(options = {}) {
    this.options = options;
    this.video = null;
    this.nudgeTimer = null;
    this.attempts = 0;
    this.nudgeBaseRate = 1;
    this.pendingGestureRetry = false;
  }
  get now() {
    return this.options.now ?? Date.now;
  }
  get setTimer() {
    return this.options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }
  get clearTimer() {
    return this.options.clearTimer ?? ((timer) => clearTimeout(timer));
  }
  get isNudging() {
    return this.nudgeTimer !== null;
  }
  get nudgeAttempts() {
    return this.attempts;
  }
  setVideo(video) {
    if (this.video === video)
      return;
    this.cancelNudge();
    this.video = video;
    this.attempts = 0;
  }
  isLive() {
    const duration = this.video?.duration;
    return !Number.isFinite(duration) || duration === 0;
  }
  cancelNudge() {
    if (!this.nudgeTimer)
      return;
    this.clearTimer(this.nudgeTimer);
    this.nudgeTimer = null;
    if (this.video)
      this.video.playbackRate = this.nudgeBaseRate;
  }
  applyNudge(decision) {
    const video = this.video;
    if (this.nudgeTimer) {
      this.clearTimer(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    this.nudgeBaseRate = decision.base;
    video.preservesPitch = true;
    video.playbackRate = decision.rate;
    if (Math.abs(video.playbackRate - decision.rate) > 1e-3) {
      video.playbackRate = decision.base;
      this.attempts = MAX_NUDGE_ATTEMPTS;
      return false;
    }
    this.attempts += 1;
    this.nudgeTimer = this.setTimer(() => {
      this.nudgeTimer = null;
      video.playbackRate = this.nudgeBaseRate;
    }, NUDGE_DURATION_MS);
    return true;
  }
  async play() {
    const video = this.video;
    if (!video)
      return false;
    try {
      await video.play();
      this.pendingGestureRetry = false;
      this.options.onPlaybackBlocked?.(false);
      return true;
    } catch (error) {
      this.options.log?.("play() was blocked", error);
      this.options.onPlaybackBlocked?.(true);
      if (!this.pendingGestureRetry && this.options.onGestureNeeded) {
        this.pendingGestureRetry = true;
        this.options.onGestureNeeded(() => {
          this.pendingGestureRetry = false;
          if (this.video?.paused)
            void this.play();
        });
      }
      return false;
    }
  }
  correctPosition(data) {
    const video = this.video;
    const targetTime = targetTimeFor(data, this.now());
    const decision = decideCorrection({ currentTime: video.currentTime, targetTime, roomRate: data.playback.rate, isLive: this.isLive(), isPaused: video.paused, nudgeAttempts: this.attempts });
    if (decision.action === "nudge") {
      if (!this.applyNudge(decision))
        video.currentTime = targetTime;
    } else if (decision.action === "seek") {
      this.cancelNudge();
      if (decision.reason === "drift")
        this.attempts = 0;
      video.currentTime = targetTime;
    } else {
      this.cancelNudge();
      this.attempts = 0;
    }
    return decision;
  }
  async applyRemoteState(data) {
    const video = this.video;
    if (!video)
      return false;
    if (Number.isFinite(data.playback.positionMs))
      this.correctPosition(data);
    if (data.playback.state === "buffer" && !video.paused) {
      this.cancelNudge();
      video.pause();
    } else if (data.playback.state === "play" && video.paused)
      await this.play();
    else if (data.playback.state === "pause" && !video.paused) {
      this.cancelNudge();
      video.pause();
    }
    if (Number.isFinite(data.playback.rate)) {
      if (this.nudgeTimer)
        this.nudgeBaseRate = data.playback.rate;
      else
        video.playbackRate = data.playback.rate;
    }
    if (data.playback.muted !== void 0)
      video.muted = data.playback.muted;
    return true;
  }
};

// main-content-script.js
var sendMessageToBG = async (message) => {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      channel.port1.close();
      resolve(event.data);
    };
    window.postMessage(
      { type: "syncer-extension-mcs-to-bg", data: message },
      "*",
      [channel.port2]
    );
  });
};
var sendLogToBG = async (message) => {
};
var VID_ELEM = null;
var IS_OWNER = false;
var _scanObserver = null;
var _scanTimer = null;
var _snapshotTimer = null;
var PLAYBACK_SEQUENCE = new PlaybackSequenceGate();
var TOP_FRAME_URL = null;
try {
  TOP_FRAME_URL = window.top.location.href;
} catch (_) {
}
if (!TOP_FRAME_URL || TOP_FRAME_URL === "about:blank") {
  const resp = await sendMessageToBG({ type: "get_top_frame_url" });
  if (resp) TOP_FRAME_URL = resp;
}
var getTopURLSync = () => {
  try {
    return window.top.location.href;
  } catch (_) {
    return TOP_FRAME_URL || window.location.href;
  }
};
var navigateTab = async (url) => {
  await sendMessageToBG({ type: "navigate_tab", data: { url } });
};
var findBestVideoElement = () => {
  let el = document.querySelector("video[src], video > source[src], video");
  if (el && el.tagName === "SOURCE") el = el.parentElement;
  return el || null;
};
var recheckVideoElement = () => {
  const next = findBestVideoElement();
  if (!next) return { found: false };
  if (VID_ELEM !== next) {
    if (VID_ELEM) removeVideoEvents();
    VID_ELEM = next;
    MEDIA.setVideo(next);
    if (IS_OWNER) listenToMediaEvents();
  }
  return { found: true };
};
var _scanDebounceTimer = null;
var debouncedRecheck = () => {
  if (_scanDebounceTimer) return;
  _scanDebounceTimer = setTimeout(() => {
    _scanDebounceTimer = null;
    recheckVideoElement();
  }, 400);
};
var startAutoVideoScan = () => {
  recheckVideoElement();
  if (!_scanObserver) {
    _scanObserver = new MutationObserver(debouncedRecheck);
    _scanObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
  }
  let tries = 0;
  if (_scanTimer) clearInterval(_scanTimer);
  _scanTimer = setInterval(() => {
    const res = recheckVideoElement();
    tries++;
    if (res.found || tries > 90) {
      clearInterval(_scanTimer);
      _scanTimer = null;
    }
  }, 1e3);
};
var stopAutoVideoScan = () => {
  if (_scanObserver) {
    _scanObserver.disconnect();
    _scanObserver = null;
  }
  if (_scanTimer) {
    clearInterval(_scanTimer);
    _scanTimer = null;
  }
  if (_scanDebounceTimer) {
    clearTimeout(_scanDebounceTimer);
    _scanDebounceTimer = null;
  }
};
var connectToWebSocket = async () => {
  return await sendMessageToBG({
    type: "websocket_connect"
  });
};
var isYoutubeClient = () => window.location.host.startsWith("www.youtube.com");
var isSpotifyClient = () => window.location.host.startsWith("open.spotify");
var isSpotifyService = (data) => data?.source?.service === "spotify" || data?.source?.adapter === "spotify";
var acceptOrderedPayload = (data = {}) => PLAYBACK_SEQUENCE.accept(data);
var log = (...msg) => {
};
var correctedNow = () => {
  return Date.now() + OFFSET_TIME_MS;
};
var remoteTimeExchangeViaBG = async () => {
  const resp = await sendMessageToBG({ type: "request_remote_time" });
  return resp?.serverTime || Date.now();
};
var estimateClockOffset = async () => {
  const t0 = Date.now();
  const remoteTime = await remoteTimeExchangeViaBG();
  const t1 = Date.now();
  const rtt = t1 - t0;
  const offset = remoteTime - (t0 + rtt / 2);
  return { offset, rtt };
};
var getURLRedirectInfo = async (url) => {
  const resp = await sendMessageToBG({
    type: "get_url_redirect_info",
    data: { url }
  });
  return resp;
};
var setPrevRoomInLS = async (roomName) => {
  await sendMessageToBG({ type: "set_prev_room", data: roomName });
};
var getPrevRoomFromLS = async () => {
  return await sendMessageToBG({ type: "get_prev_room" });
};
var removePrevRoomFromLS = async () => {
  await sendMessageToBG({ type: "remove_prev_room" });
};
var OFFSET_TIME_MS = 0;
var _initialized = false;
var initializeFrame = async () => {
  if (_initialized) return;
  _initialized = true;
  const clockOffset = await estimateClockOffset();
  OFFSET_TIME_MS = clockOffset.offset;
  currRoom = await sendMessageToBG({
    type: "get_storage",
    data: { key: CURR_ROOM_ID }
  });
  currUrl = getTopURLSync();
  const prevRoomName = await getPrevRoomFromLS();
  if (prevRoomName) {
    await removePrevRoomFromLS();
    const result = await connectToWebSocket();
    if (result.success) {
      await joinRoom(prevRoomName);
      const timeoutMs = 1e3;
      setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 2.2);
      setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 5.1);
      setTimeout(() => requestEventFromOwner(prevRoomName), timeoutMs * 7.9);
    }
  }
};
var spotifyRootElemSelector = '[data-testid="root"]';
var CURR_SONG_URI_OWNERPOV = "";
var PLAYER_API_STORE;
var CURR_ROOM_ID = "currRoom";
var currRoom = null;
var currUrl = getTopURLSync();
var getPropertyBeginningWith = (propPrefix, elem) => {
  const reactProps = Object.getOwnPropertyNames(elem);
  let requiredProp = null;
  for (const prop of reactProps) {
    if (prop.startsWith(propPrefix)) {
      requiredProp = prop;
      break;
    }
  }
  return requiredProp;
};
var getPlayerAPIFn = () => {
  if (PLAYER_API_STORE) return PLAYER_API_STORE;
  const rootElem = document.querySelector(spotifyRootElemSelector);
  const requiredProp = getPropertyBeginningWith("__reactFiber$", rootElem);
  if (!requiredProp) {
    log("reactFiber prop name not found");
    return;
  }
  let topMostComponent = rootElem[requiredProp];
  if (!topMostComponent) {
    log("reactFiber prop on root elem not found");
    return;
  }
  while (true) {
    if (!topMostComponent.return) break;
    topMostComponent = topMostComponent.return;
  }
  PLAYER_API_STORE = topMostComponent.child.memoizedProps.platform.getPlayerAPI();
  return PLAYER_API_STORE;
};
var handleSpotifyStreamEvent = (recv, streamChanged) => {
  const playerAPI = getPlayerAPIFn();
  if (streamChanged) {
    const playerState = playerAPI.getState();
    const isRecvSongAlreadyPlaying = playerState.context.uri === recv.media.contextId && playerState.item.uri === recv.media.canonicalId;
    if (!isRecvSongAlreadyPlaying) {
      log("playing new song", recv.media.canonicalId, recv.media.contextId);
      playerAPI.play(
        { uri: recv.media.contextId },
        {},
        { skipTo: { uri: recv.media.canonicalId } }
      );
      return;
    }
    log("song already playing");
  }
  if (recv.playback.state === "play") {
    log("resuming song");
    playerAPI.resume();
  } else if (recv.playback.state === "pause") {
    log("puaseing song");
    playerAPI.pause();
  }
  const latency = recv.playback.state === "play" ? correctedNow() - recv.capturedAtMs + 80 : 0;
  playerAPI.seekTo(recv.playback.positionMs + latency);
};
var getAudioStateSpotify = async () => {
  const playerHarmonyState = await getPlayerAPIFn()._harmony.getCurrentState();
  const timestampMs = playerHarmonyState.position;
  const durationMs = playerHarmonyState.duration;
  const playState = playerHarmonyState.paused ? "pause" : "play";
  const playlistID = playerHarmonyState.context?.uri || "";
  const songURI = playerHarmonyState.track_window?.current_track?.uri || "";
  const capturedAtMs = correctedNow();
  return {
    version: 2,
    capturedAtMs,
    source: { platform: "desktop", adapter: "spotify", service: "spotify" },
    media: {
      canonicalId: songURI || void 0,
      contextId: playlistID || void 0,
      title: playerHarmonyState.track_window?.current_track?.name,
      artist: playerHarmonyState.track_window?.current_track?.artists?.map((artist) => artist.name).join(", "),
      durationMs,
      isLive: false
    },
    playback: { state: playState, positionMs: timestampMs, rate: 1, muted: false },
    capabilities: { canPlay: true, canPause: true, canSeek: true, canSetRate: false, canLoadMedia: true }
  };
};
var getVideoCurrentState = (data) => {
  const capturedAtMs = correctedNow();
  const url = getTopURLSync();
  const timestamp = VID_ELEM?.currentTime || 0;
  const mediaState = data?.isBuffering ? "buffer" : VID_ELEM?.ended ? "ended" : VID_ELEM?.paused ? "pause" : "play";
  const playbackRate = VID_ELEM?.playbackRate || 1;
  const youtubeId = isYoutubeClient() ? new URL(url).searchParams.get("v") : null;
  return {
    version: 2,
    capturedAtMs,
    source: {
      platform: "desktop",
      adapter: isYoutubeClient() ? "youtube" : "html",
      service: isYoutubeClient() ? "youtube" : "web"
    },
    media: {
      canonicalId: youtubeId || url,
      url,
      title: document.title,
      durationMs: Number.isFinite(VID_ELEM?.duration) ? VID_ELEM.duration * 1e3 : void 0,
      isLive: !Number.isFinite(VID_ELEM?.duration) || VID_ELEM?.duration === 0
    },
    playback: {
      state: mediaState,
      positionMs: timestamp * 1e3,
      rate: playbackRate,
      muted: VID_ELEM?.muted || false
    },
    capabilities: { canPlay: true, canPause: true, canSeek: true, canSetRate: true, canLoadMedia: true }
  };
};
var getMediaCurrentState = async (data) => {
  if (isSpotifyClient()) {
    return await getAudioStateSpotify(data);
  }
  return getVideoCurrentState(data);
};
var requestEventFromOwner = (roomName) => {
  sendMessageToBG({
    type: "sync_room_data",
    data: { roomName }
  });
};
var MEDIA = new MediaController({
  now: () => correctedNow(),
  onPlaybackBlocked: (blocked) => {
    sendMessageToBG({ type: "playback_blocked", data: { blocked } });
  },
  // The autoplay policy wants a real interaction; the next one anywhere on
  // the page will do.
  onGestureNeeded: (retry) => {
    const onGesture = () => {
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
      retry();
    };
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
  },
  log
});
var onMediaEvent = async (result) => {
  log("called onMediaEvent", result);
  const data = normalizePlaybackPayload(result.data);
  if (!data) return;
  if (!acceptOrderedPayload(data)) return;
  await sendLogToBG(`called onMediaEvent' ${result}`);
  MEDIA.setVideo(VID_ELEM);
  if (!await MEDIA.applyRemoteState(data)) {
    log("no video element found to act on media event");
    await sendLogToBG("no video element found to act on media event");
  }
};
var sendMediaEventAfterDelay = (delayMs) => {
  setTimeout(() => {
    log("delay complete .sending now");
    sendMediaEvent();
  }, delayMs);
};
var onSyncRoomEvent = () => {
  sendStreamChangeEvent();
  sendMediaEventAfterDelay(4200);
  sendMediaEventAfterDelay(7300);
};
var onStreamChangeEvent = async (resp) => {
  const recvdURL = resp.data.media.url;
  const currURL = getTopURLSync();
  if (!recvdURL) return;
  if (recvdURL !== currURL) {
    if (recvdURL.includes("list=")) {
      const recvdURLParams = new URLSearchParams(recvdURL.split("?")[1]);
      const currURLParams = new URLSearchParams(currURL.split("?")[1]);
      if (recvdURLParams.get("v") === currURLParams.get("v")) {
        return;
      }
    }
    const redInfo = await getURLRedirectInfo(recvdURL);
    if (redInfo.count > 3 && (/* @__PURE__ */ new Date()).getTime() - redInfo.lastUpdated < 18e3) {
      log("too much - too frequent redirections. STOP.");
      return;
    }
    await sendMessageToBG({
      type: "increment_redirect_count",
      data: {
        url: recvdURL
      }
    });
    await setPrevRoomInLS(resp.roomName);
    await navigateTab(recvdURL);
    return;
  }
};
var sendStreamChangeEvent = async (...args) => {
  sendMessageToBG({
    type: "stream_change",
    data: {
      roomName: currRoom,
      meta: await getMediaCurrentState(...args)
    }
  });
};
var sendMediaEvent = async (...args) => {
  await sendMessageToBG({
    type: "media_event",
    data: {
      roomName: currRoom,
      meta: await getMediaCurrentState(...args)
    }
  });
};
var sendStallEvent = () => {
  sendMediaEvent({ isBuffering: true });
};
var sendPlayEvent = async () => {
  const topUrl = getTopURLSync();
  if (currUrl !== topUrl) {
    await sendStreamChangeEvent();
    currUrl = topUrl;
    return;
  }
  sendMediaEvent();
};
var sendPauseEvent = () => {
  sendMediaEvent();
};
var sendSeekEvent = () => {
  sendMediaEvent();
};
var listenToMediaEvents = () => {
  if (!_snapshotTimer) {
    _snapshotTimer = setInterval(() => {
      if (IS_OWNER && currRoom) sendMediaEvent();
    }, 6e4);
  }
  if (isSpotifyClient()) {
    return listenToSpotifyAudioEvents();
  }
  if (!VID_ELEM) return;
  VID_ELEM.addEventListener("play", sendPlayEvent);
  VID_ELEM.addEventListener("pause", sendPauseEvent);
  VID_ELEM.addEventListener("seeked", sendSeekEvent);
  VID_ELEM.addEventListener("ratechange", sendMediaEvent);
  VID_ELEM.addEventListener("waiting", sendStallEvent);
  VID_ELEM.addEventListener("playing", sendPlayEvent);
};
var listenToSpotifyAudioEvents = () => {
  const spotifyPlayer = getPlayerAPIFn();
  spotifyPlayer._events._emitter.addListener("update", async (e) => {
    const data = e.data;
    if (!data) return;
    sendMediaEvent(data);
    if (data.item.uri !== CURR_SONG_URI_OWNERPOV) {
      CURR_SONG_URI_OWNERPOV = data.item.uri;
      await sendStreamChangeEvent();
      sendMediaEventAfterDelay(3100);
      sendMediaEventAfterDelay(4500);
      sendMediaEventAfterDelay(5200);
      sendMediaEventAfterDelay(5990);
    }
  });
};
var removeVideoEvents = () => {
  if (_snapshotTimer) {
    clearInterval(_snapshotTimer);
    _snapshotTimer = null;
  }
  if (!VID_ELEM) return;
  VID_ELEM.removeEventListener("play", sendPlayEvent);
  VID_ELEM.removeEventListener("pause", sendPauseEvent);
  VID_ELEM.removeEventListener("seeked", sendSeekEvent);
  VID_ELEM.removeEventListener("ratechange", sendMediaEvent);
  VID_ELEM.removeEventListener("waiting", sendStallEvent);
  VID_ELEM.removeEventListener("playing", sendPlayEvent);
};
var createRoom = async (roomName) => {
  const result = await sendMessageToBG({
    type: "create_room",
    data: { roomName, meta: await getMediaCurrentState() }
  });
  if (result.success) {
    PLAYBACK_SEQUENCE.reset();
    currUrl = getTopURLSync();
    currRoom = await sendMessageToBG({
      type: "set_storage",
      data: { key: CURR_ROOM_ID, value: roomName }
    });
    IS_OWNER = true;
    listenToMediaEvents();
    startAutoVideoScan();
    await sendStreamChangeEvent();
    await sendMediaEvent();
  }
  return result;
};
var joinRoom = async (roomName) => {
  const result = await sendMessageToBG({
    type: "join_room",
    data: { roomName }
  });
  if (result.success) {
    PLAYBACK_SEQUENCE.reset();
    currRoom = await sendMessageToBG({
      type: "set_storage",
      data: { key: CURR_ROOM_ID, value: roomName }
    });
    IS_OWNER = !!result.data.isOwner;
    if (IS_OWNER) {
      listenToMediaEvents();
    } else {
    }
    startAutoVideoScan();
  }
  return result;
};
var leaveRoom = async (roomName) => {
  const result = await sendMessageToBG({
    type: "leave_room",
    data: { roomName }
  });
  if (result.success) {
    PLAYBACK_SEQUENCE.reset();
    currRoom = await sendMessageToBG({
      type: "set_storage",
      data: { key: CURR_ROOM_ID, value: null }
    });
    await sendMessageToBG({ type: "remove_all_listeners" });
    if (result.data.isOwner) {
      removeVideoEvents();
    } else {
    }
    IS_OWNER = false;
    stopAutoVideoScan();
  }
  return result;
};
var listRooms = async () => {
  log("current room", currRoom);
  return await sendMessageToBG({ type: "list_rooms" });
};
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data.type !== "syncer-extension-bg-to-mcs") {
    return;
  }
  const port = event.ports[0];
  const message = event.data.data;
  if (message.type === "recheck_video_scan") {
    const result2 = findBestVideoElement();
    return port.postMessage({
      success: true,
      data: { found: !!result2, message: result2 ? "video found" : "no video found yet" }
    });
  }
  if (message.type === "cleanup_after_leave") {
    currRoom = null;
    if (message.isOwner) {
      removeVideoEvents();
    }
    IS_OWNER = false;
    stopAutoVideoScan();
    return port.postMessage({ success: true });
  }
  if (message.type === "setup_after_join") {
    await initializeFrame();
    currRoom = message.roomName;
    await sendMessageToBG({
      type: "set_storage",
      data: { key: CURR_ROOM_ID, value: message.roomName }
    });
    VID_ELEM = findBestVideoElement();
    await sendLogToBG("setupafterjoin, video element: " + !!VID_ELEM);
    IS_OWNER = !!message.isOwner;
    PLAYBACK_SEQUENCE.reset();
    if (IS_OWNER) {
      listenToMediaEvents();
    }
    startAutoVideoScan();
    return port.postMessage({ success: true });
  }
  if (message.type === "emit_stream_change") {
    if (IS_OWNER) {
      await sendStreamChangeEvent();
      currUrl = getTopURLSync();
    }
    return port.postMessage({ success: true });
  }
  if (message.type === "media_event") {
    const normalized = normalizePlaybackPayload(message.data.data);
    if (!normalized) return port.postMessage({});
    if (isSpotifyService(normalized)) {
      if (!acceptOrderedPayload(normalized)) return port.postMessage({});
      log("spotify media event");
      handleSpotifyStreamEvent(normalized);
    } else {
      onMediaEvent({ ...message.data, data: normalized });
    }
    return port.postMessage({});
  } else if (message.type === "sync_room_data") {
    onSyncRoomEvent();
    return port.postMessage({});
  } else if (message.type === "stream_change") {
    const normalized = normalizePlaybackPayload(message.data.data);
    if (!normalized) return port.postMessage({});
    if (!acceptOrderedPayload(normalized)) return port.postMessage({});
    if (isSpotifyService(normalized)) {
      const resp = normalized;
      if (!isSpotifyClient()) {
        await setPrevRoomInLS(message.data.roomName);
        const playlistComps = (resp.media.contextId || "").split(":");
        let rootPath = "";
        if (playlistComps[1] === "playlist") {
          rootPath = "/playlist";
        } else if (playlistComps[1] === "album") {
          rootPath = "/album";
        }
        if (rootPath) {
          await navigateTab(`https://open.spotify.com${rootPath}/${playlistComps[2]}`);
        } else {
          await navigateTab("https://open.spotify.com");
        }
        return;
      }
      handleSpotifyStreamEvent(resp, true);
    } else {
      onStreamChangeEvent({ ...message.data, data: normalized });
    }
    return port.postMessage({});
  }
  VID_ELEM = findBestVideoElement();
  await initializeFrame();
  let result = await connectToWebSocket();
  if (!result.success) {
    port.postMessage(result);
    return;
  }
  if (message.type === "create_room") {
    if (!VID_ELEM && !isSpotifyClient()) {
      result = {
        success: false,
        data: {
          message: "No video in current page. Go to a webpage with video."
        }
      };
    } else {
      result = await createRoom(message.roomName);
    }
  } else if (message.type === "join_room") {
    result = await joinRoom(message.roomName);
  } else if (message.type === "leave_room") {
    result = await leaveRoom(message.roomName || currRoom);
  } else if (message.type === "list_rooms") {
    result = await listRooms();
  }
  port.postMessage(result);
});
if (window.top === window.self) {
  await initializeFrame();
}
