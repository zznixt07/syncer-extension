// lib/wc-toast.js
var generateId = /* @__PURE__ */ (function() {
  let count = 0;
  return function() {
    return (++count).toString();
  };
})();
function createToast(message, type = "blank", options = {
  icon: { type: "", content: "" },
  duration: "",
  closeable: false,
  theme: { type: "light", style: { background: "", color: "", stroke: "" } }
}) {
  const id = generateId();
  const toastItem = createToastItem(id, type, options);
  const toastIcon = createToastIcon(type, options);
  const toastContent = createToastContent(message);
  toastItem.appendChild(toastIcon);
  toastItem.appendChild(toastContent);
  if (options.closeable)
    toastItem.appendChild(createToastCloseButton(toastItem));
  document.querySelector("wc-toast").appendChild(toastItem);
  return {
    id,
    type,
    message,
    ...options
  };
}
function createToastItem(id, type, options) {
  const { duration, theme } = options;
  const toastItem = document.createElement("wc-toast-item");
  toastItem.setAttribute("type", type);
  toastItem.setAttribute("duration", duration ? duration : "");
  toastItem.setAttribute("data-toast-item-id", id);
  toastItem.setAttribute("theme", (theme == null ? void 0 : theme.type) ? theme.type : "light");
  if ((theme == null ? void 0 : theme.type) === "custom" && (theme == null ? void 0 : theme.style)) {
    const { background, stroke, color } = theme.style;
    toastItem.style.setProperty("--wc-toast-background", background);
    toastItem.style.setProperty("--wc-toast-stroke", stroke);
    toastItem.style.setProperty("--wc-toast-color", color);
  }
  return toastItem;
}
function createToastIcon(type, options) {
  const { icon } = options;
  const toastIcon = document.createElement("wc-toast-icon");
  toastIcon.setAttribute("type", (icon == null ? void 0 : icon.type) ? icon.type : type);
  toastIcon.setAttribute("icon", (icon == null ? void 0 : icon.content) && (icon == null ? void 0 : icon.type) === "custom" ? icon.content : "");
  if ((icon == null ? void 0 : icon.type) === "svg")
    toastIcon.innerHTML = (icon == null ? void 0 : icon.content) ? icon.content : "";
  return toastIcon;
}
function createToastContent(message) {
  const toastContent = document.createElement("wc-toast-content");
  toastContent.setAttribute("message", message);
  return toastContent;
}
function createToastCloseButton(toastItem) {
  const toastCloseButton = document.createElement("wc-toast-close-button");
  toastCloseButton.addEventListener("click", () => {
    toastItem.classList.add("dismiss-with-close-button");
  });
  return toastCloseButton;
}
function createHandler(type) {
  return function(message, options) {
    const toast2 = createToast(message, type, options);
    return toast2.id;
  };
}
function toast(message, options) {
  return createHandler("blank")(message, options);
}
toast.loading = createHandler("loading");
toast.success = createHandler("success");
toast.error = createHandler("error");
toast.dismiss = function(toastId) {
  const toastItems = document.querySelectorAll("wc-toast-item");
  for (const toastItem of toastItems) {
    const dataId = toastItem.getAttribute("data-toast-item-id");
    if (toastId === dataId) {
      toastItem.classList.add("dismiss");
    }
  }
};
toast.promise = async function(promise, message = { loading: "", success: "", error: "" }, options) {
  const id = toast.loading(message.loading, { ...options });
  try {
    const result = await promise;
    toast.dismiss(id);
    toast.success(message.success, { ...options });
    return result;
  } catch (error) {
    toast.dismiss(id);
    toast.error(message.error, { ...options });
    return error;
  }
};
var WCToast = class _WCToast extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = _WCToast.template();
    this.shadowRoot.append(this.template.content.cloneNode(true));
  }
  connectedCallback() {
    this.setAttribute("role", "status");
    this.setAttribute("aria-live", "polite");
    this.position = this.getAttribute("position") || "top-center";
    this.arrangeToastPosition(this.position);
  }
  static get observedAttributes() {
    return ["position"];
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "position") {
      this.position = newValue;
      this.arrangeToastPosition(this.position);
    }
  }
  arrangeToastPosition(position) {
    const top = position.includes("top");
    const verticalStyle = { top: top && 0, bottom: !top && 0 };
    const horizontalStyle = position.includes("center") ? "center" : position.includes("right") ? "flex-end" : "flex-start";
    const factor = top ? 1 : -1;
    const toastWrapperDirection = top ? "column-reverse" : "column";
    const css = window.getComputedStyle(document.querySelector("html"));
    const scrollbarGutter = css.getPropertyValue("scrollbar-gutter");
    this.style.setProperty("--wc-toast-factor", factor);
    this.style.setProperty("--wc-toast-position", horizontalStyle);
    this.style.setProperty("--wc-toast-direction", toastWrapperDirection);
    const toastContainer = this.shadowRoot.querySelector(".wc-toast-container");
    toastContainer.style.top = verticalStyle.top;
    toastContainer.style.bottom = verticalStyle.bottom;
    toastContainer.style.right = scrollbarGutter.includes("stable") && "4px";
    toastContainer.style.justifyContent = horizontalStyle;
  }
  static template() {
    return `
    <style>
      :host {
        --wc-toast-factor: 1;
        --wc-toast-position: center;
        --wc-toast-direction: column-reverse;

        position: fixed;
        z-index: 9999;
        top: 16px;
        left: 16px;
        right: 16px;
        bottom: 16px;
        pointer-events: none;
      }

      .wc-toast-container {
        z-index: 9999;
        left: 0;
        right: 0;
        display: flex;
        position: absolute;
      }

      .wc-toast-wrapper {
        display: flex;
        flex-direction: var(--wc-toast-direction);
        justify-content: flex-end;
        gap: 16px;
        will-change: transform;
        transition: all 230ms cubic-bezier(0.21, 1.02, 0.73, 1);
        pointer-events: none;
      }
    </style>
    <div class="wc-toast-container">
      <div class="wc-toast-wrapper" aria-live="polite">
        <slot> </slot>
      </div>
    </div>
    `;
  }
};
customElements.define("wc-toast", WCToast);
var WCToastItem = class _WCToastItem extends HTMLElement {
  constructor() {
    super();
    this.createdAt = /* @__PURE__ */ new Date();
    this.EXIT_ANIMATION_DURATION = 350;
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = _WCToastItem.template();
    this.shadowRoot.append(this.template.content.cloneNode(true));
  }
  connectedCallback() {
    this.type = this.getAttribute("type") || "blank";
    this.theme = this.getAttribute("theme") || "light";
    this.duration = this.getAttribute("duration") || this.getDurationByType(this.type);
    if (this.theme === "dark") {
      this.style.setProperty("--wc-toast-background", "#2a2a32");
      this.style.setProperty("--wc-toast-stroke", "#f9f9fa");
      this.style.setProperty("--wc-toast-color", "#f9f9fa");
    }
    setTimeout(() => {
      this.shadowRoot.querySelector(".wc-toast-bar").classList.add("dismiss");
      setTimeout(() => {
        this.remove();
      }, this.EXIT_ANIMATION_DURATION);
    }, this.duration);
  }
  static get observedAttributes() {
    return ["class"];
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "class") {
      switch (newValue) {
        case "dismiss-with-close-button":
          this.shadowRoot.querySelector(".wc-toast-bar").classList.add("dismiss");
          setTimeout(() => {
            this.remove();
          }, this.EXIT_ANIMATION_DURATION);
          break;
        case "dismiss":
        default:
          this.remove();
          break;
      }
    }
  }
  getDurationByType(type) {
    switch (type) {
      case "success":
        return 2e3;
      case "loading":
        return 1e5 * 60;
      case "error":
      case "blank":
      case "custom":
      default:
        return 3500;
    }
  }
  static template() {
    return `
    <style>
      /*
       * Author: Timo Lins
       * License: MIT
       * Source: https://github.com/timolins/react-hot-toast/blob/main/src/components/toast-bar.tsx
       */

      :host {
        --wc-toast-background: #fff;
        --wc-toast-max-width: 350px;
        --wc-toast-stroke: #2a2a32;
        --wc-toast-color: #000;
        --wc-toast-font-family: 'Roboto', 'Amiri', sans-serif;
        --wc-toast-font-size: 16px;
        --wc-toast-border-radius: 8px;
        --wc-toast-content-margin: 4px 10px;

        display: flex;
        justify-content: var(--wc-toast-position);
        transition: all 230ms cubic-bezier(0.21, 1.02, 0.73, 1);
      }

      :host > * {
        pointer-events: auto;
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --wc-toast-background: #2a2a32;
          --wc-toast-stroke: #f9f9fa;
          --wc-toast-color: #f9f9fa;
        }
      }

      @keyframes enter-animation {
        0% {
          transform: translate3d(0, calc(var(--wc-toast-factor) * -200%), 0) scale(0.6);
          opacity: 0.5;
        }
        100% {
          transform: translate3d(0, 0, 0) scale(1);
          opacity: 1;
        }
      }

      @keyframes exit-animation {
        0% {
          transform: translate3d(0, 0, -1px) scale(1);
          opacity: 1;
        }
        100% {
          transform: translate3d(0, calc(var(--wc-toast-factor) * -150%), -1px) scale(0.6);
          opacity: 0;
        }
      }

      @keyframes fade-in {
        0% {
          opacity: 0;
        }
        100% {
          opacity: 1;
        }
      }

      @keyframes fade-out {
        0% {
          opacity: 1;
        }
        100% {
          opacity: 0;
        }
      }

      .wc-toast-bar {
        display: flex;
        align-items: center;
        background: var(--wc-toast-background, #fff);
        line-height: 1.3;
        will-change: transform;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1), 0 3px 3px rgba(0, 0, 0, 0.05);
        animation: enter-animation 0.3s cubic-bezier(0.21, 1.02, 0.73, 1) forwards;
        max-width: var(--wc-toast-max-width);
        pointer-events: auto;
        padding: 8px 10px;
        border-radius: var(--wc-toast-border-radius);
      }

      .wc-toast-bar.dismiss {
        animation: exit-animation 0.3s forwards cubic-bezier(0.06, 0.71, 0.55, 1);
      }

      @media (prefers-reduced-motion: reduce) {
        .wc-toast-bar {
          animation-name: fade-in;
        }

        .wc-toast-bar.dismiss {
          animation-name: fade-out;
        }
      }
    </style>
    <div class="wc-toast-bar">
      <slot></slot>
    </div>
    `;
  }
};
customElements.define("wc-toast-item", WCToastItem);
var WCToastIcon = class _WCToastIcon extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = _WCToastIcon.template();
    this.shadowRoot.append(this.template.content.cloneNode(true));
  }
  connectedCallback() {
    this.icon = this.getAttribute("icon");
    this.type = this.getAttribute("type") || "blank";
    this.setAttribute("aria-hidden", "true");
    if (this.type === "svg")
      return;
    this.icon = this.icon != null ? this.createIcon(this.type, this.icon) : this.createIcon(this.type);
    this.shadowRoot.appendChild(this.icon);
  }
  createIcon(toastType = "blank", icon = "") {
    switch (toastType) {
      case "success":
        const checkmarkIcon = document.createElement("div");
        checkmarkIcon.classList.add("checkmark-icon");
        return checkmarkIcon;
      case "error":
        const errorIcon = document.createElement("div");
        errorIcon.classList.add("error-icon");
        errorIcon.innerHTML = `<svg focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>`;
        return errorIcon;
      case "loading":
        const loadingIcon = document.createElement("div");
        loadingIcon.classList.add("loading-icon");
        return loadingIcon;
      case "custom":
        const customIcon = document.createElement("div");
        customIcon.classList.add("custom-icon");
        customIcon.innerHTML = icon;
        return customIcon;
      case "blank":
      default:
        const div = document.createElement("div");
        return div;
    }
  }
  static template() {
    return `
    <style>
      /*
      * Author: Timo Lins
      * License: MIT
      * Source: 
      * - https://github.com/timolins/react-hot-toast/blob/main/src/components/checkmark.tsx
      * - https://github.com/timolins/react-hot-toast/blob/main/src/components/error.tsx
      * - https://github.com/timolins/react-hot-toast/blob/main/src/components/loader.tsx
      */

      :host {
        display: flex;
        align-self: flex-start;
        margin-block: 4px !important;
      }

      @keyframes circle-animation {
        from {
          transform: scale(0) rotate(45deg);
          opacity: 0;
        }
        to {
          transform: scale(1) rotate(45deg);
          opacity: 1;
        }
      }

      .checkmark-icon {
        width: 20px;
        opacity: 0;
        height: 20px;
        border-radius: 10px;
        background: #61d345;
        position: relative;
        transform: rotate(45deg);
        animation: circle-animation 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        animation-delay: 100ms;
      }

      @keyframes checkmark-animation {
        0% {
          height: 0;
          width: 0;
          opacity: 0;
        }
        40% {
          height: 0;
          width: 6px;
          opacity: 1;
        }
        100% {
          opacity: 1;
          height: 10px;
        }
      }

      .checkmark-icon::after {
        content: '';
        box-sizing: border-box;
        animation: checkmark-animation 0.2s ease-out forwards;
        opacity: 0;
        animation-delay: 200ms;
        position: absolute;
        border-right: 2px solid;
        border-bottom: 2px solid;
        border-color: #fff;
        bottom: 6px;
        left: 6px;
        height: 10px;
        width: 6px;
      }

      @keyframes slide-in {
        from {
          transform: scale(0);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }

      .error-icon {
        width: 20px;
        height: 20px;
        border-radius: 10px;
        background: #ff4b4b;
        display: flex;
        justify-content: center;
        align-items: center;
        animation: slide-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      }

      .error-icon svg{
        width: 16px;
        padding-left: 1px;
        height: 20px;
        stroke: #fff;
        animation: slide-in .2s ease-out;
        animation-delay: 100ms;
      }

      @keyframes rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .loading-icon {
        height: 20px;
        width: 20px;
        position: relative;
        border-radius: 10px;
        background-color: white;
      }

      .loading-icon::after {
        content: '';
        position: absolute;
        bottom: 4px;
        left: 4px;
        width: 12px;
        height: 12px;
        box-sizing: border-box;
        border: 2px solid;
        border-radius: 100%;
        border-color: #e0e0e0;
        border-right-color: #616161;
        animation: rotate 1s linear infinite;
      }

      @media (prefers-color-scheme: dark) {
        ::slotted(svg) {
          stroke: var(--wc-toast-stroke, #fff);
        }
      }
    </style>
    <slot name="svg"></slot>
    `;
  }
};
customElements.define("wc-toast-icon", WCToastIcon);
var WCToastContent = class _WCToastContent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = _WCToastContent.template();
    this.shadowRoot.append(this.template.content.cloneNode(true));
  }
  connectedCallback() {
    this.message = this.getAttribute("message");
    this.shadowRoot.querySelector('slot[name="content"]').innerHTML = this.message;
  }
  static template() {
    return `
    <style>
      :host {
        display: flex;
        justify-content: center;
        flex: 1 1 auto;
        margin: var(--wc-toast-content-margin) !important;
        color: var(--wc-toast-color, #000);
        font-family: var(--wc-toast-font-family);
        font-size: var(--wc-toast-font-size);
      }
    </style>
    <slot name="content"></slot>
    `;
  }
};
customElements.define("wc-toast-content", WCToastContent);
var WCToastCloseButton = class _WCToastCloseButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = _WCToastCloseButton.template();
    this.shadowRoot.append(this.template.content.cloneNode(true));
  }
  static template() {
    return `
    <style>
      :host {
        width: 20px;
        opacity: 1;
        height: 20px;
        border-radius: 2px;
        border: 1px solid #dadce0;
        background: var(--wc-toast-background);
        position: relative;
        cursor: pointer;
        display: flex;
        justify-content: center;
        align-items: center;
        margin-left: 5px;
      }

      svg {
        stroke: var(--wc-toast-stroke, #2a2a32);
      }
    </style>
    <svg
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
    `;
  }
};
customElements.define("wc-toast-close-button", WCToastCloseButton);

// node_modules/syncer-extension-core/dist/popup/index.js
var normalizePopupAction = (action) => {
  if ("serverUrl" in action)
    return { ...action, serverUrl: action.serverUrl.trim() };
  if ("roomName" in action)
    return { ...action, roomName: action.roomName.trim() };
  return action;
};
var formatDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    return "";
  const total = Math.max(0, Math.round(durationMs / 1e3));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
};

// popup.js
var getCurrentTab = async () => {
  const tabs = await chrome.tabs.query({ currentWindow: true, active: true });
  return tabs[0];
};
var getCurrentTabId = async () => {
  const tab2 = await getCurrentTab();
  return tab2.id;
};
var tab = await getCurrentTab();
var url = tab?.url || "";
if (true) {
  const REQUEST_TIMEOUT_MS = 7e3;
  const withTimeout = (promise, label) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out`)), REQUEST_TIMEOUT_MS);
      })
    ]);
  };
  const success = (message) => {
    toast(`<span>${message}</span>`, {
      ...{ icon: { type: "success" } },
      ...OPTION
    });
  };
  const fail = (message) => {
    if (!message) {
      return;
    }
    toast(`<span>${message}</span>`, {
      ...{ icon: { type: "error" } },
      ...OPTION
    });
  };
  const sendMessageToBG = async (type, data) => {
    try {
      return await withTimeout(
        chrome.runtime.sendMessage({ type, data }),
        type
      );
    } catch (e) {
      fail(`Failed: ${e.message}`);
      return null;
    }
  };
  const sendMessageToCurrTab = async (type, roomName, throwError = false) => {
    const currTabId = await getCurrentTabId();
    try {
      const res = await chrome.tabs.sendMessage(currTabId, {
        type,
        roomName
      });
      console.log(`got resp from curr tab: ${res}`);
      return res;
    } catch (e) {
      if (throwError) throw e;
      fail(`Failed: ${e.message}`);
      return null;
    }
  };
  const sendMessageToVideoFrame = async (type, roomName) => {
    const currTabId = await getCurrentTabId();
    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({
          type: "forward_to_video_frame",
          tabId: currTabId,
          innerMessage: { type, roomName }
        }),
        type
      );
      return result;
    } catch (e) {
      fail(`Failed on: ${type}: ${e.message}`);
      return null;
    }
  };
  const setIsLoading = (elem, isLoading) => {
    if (isLoading) {
      elem.disabled = true;
      const span = document.createElement("span");
      span.textContent = "...";
      elem.style.position = "relative";
      span.className = "loading";
      span.style = `
			position: absolute;
			top: 0;
			left: 0;
			width: 95%;
			height: 95%;
			background-color: black;
			border-radius: inherit;
		`;
      elem.appendChild(span);
    } else {
      elem.disabled = false;
      const span = elem.querySelector("span.loading");
      if (span) span.remove();
    }
  };
  const OPTION = {
    theme: {
      type: "custom",
      style: { background: "#00529b", color: "white" }
    },
    duration: 2e3
  };
  const toaster = document.createElement("wc-toast");
  const style = document.createElement("style");
  style.textContent = `
wc-toast-content {
	--wc-toast-font-size: 12px;
}
`;
  document.head.appendChild(style);
  document.body.prepend(toaster);
  const createRoomBtn = document.getElementById("create-room");
  const joinRoomBtn = document.getElementById("join-room");
  const leaveRoomBtn = document.getElementById("leave-room");
  const listRoomsBtn = document.getElementById("list-rooms");
  const serverAddressInput = document.getElementById("server-address");
  const roomUserCountElem = document.getElementById("room-user-count");
  const recheckBtn = document.getElementById("recheck-video");
  const hostMediaElem = document.getElementById("host-media");
  const hostMediaServiceElem = document.getElementById("host-media-service");
  const hostMediaTitleElem = document.getElementById("host-media-title");
  const hostMediaArtistElem = document.getElementById("host-media-artist");
  const hostMediaArtistRow = document.getElementById("host-media-artist-row");
  const hostMediaDurationElem = document.getElementById("host-media-duration");
  const hostMediaDurationRow = document.getElementById("host-media-duration-row");
  const copyHostMediaTitleBtn = document.getElementById("copy-host-media-title");
  let displayedHostMediaTitle = "";
  const renderHostMedia = (media) => {
    if (!hostMediaElem) return;
    if (!media) {
      displayedHostMediaTitle = "";
      hostMediaElem.hidden = true;
      return;
    }
    hostMediaServiceElem.textContent = media.service || "Media app";
    displayedHostMediaTitle = media.title || "";
    hostMediaTitleElem.textContent = displayedHostMediaTitle || "Unknown title";
    copyHostMediaTitleBtn.hidden = !displayedHostMediaTitle;
    hostMediaArtistElem.textContent = media.artist || "";
    hostMediaArtistRow.hidden = !media.artist;
    const duration = formatDuration(media.durationMs);
    hostMediaDurationElem.textContent = duration;
    hostMediaDurationRow.hidden = !duration;
    hostMediaElem.hidden = false;
  };
  copyHostMediaTitleBtn?.addEventListener("click", async () => {
    if (!displayedHostMediaTitle) return;
    try {
      await navigator.clipboard.writeText(displayedHostMediaTitle);
      success("Video title copied");
    } catch (error) {
      fail(`Could not copy title: ${error.message}`);
    }
  });
  const othersIn = (roomName, userCount) => {
    return Math.max(0, userCount - (roomName === activeRoomName ? 1 : 0));
  };
  const formatUserCount = (others) => {
    if (others === 0) return "no one else";
    return `${others} ${others === 1 ? "other" : "others"}`;
  };
  const updateRoomUserCount = (roomName, userCount) => {
    if (!roomUserCountElem || typeof userCount !== "number") return;
    const role = roomName === activeRoomName && activeIsOwner != null ? activeIsOwner ? " \xB7 you're the host" : " \xB7 you're a guest" : "";
    const others = othersIn(roomName, userCount);
    const summary = others === 0 ? "No one else here yet" : `${others} ${others === 1 ? "other" : "others"} present`;
    roomUserCountElem.textContent = `${summary}${role}`;
  };
  const clearRoomUserCount = () => {
    if (roomUserCountElem) roomUserCountElem.textContent = "";
  };
  const currentRoomName = () => document.getElementById("new-room-name").value;
  let activeRoomName = null;
  let activeIsOwner = null;
  const PROTECTED_PAGE_MESSAGE = "Open a normal webpage first. Chrome does not allow extensions to access this page.";
  const isProtectedPageUrl = (url2) => /^(chrome|edge|brave|opera|vivaldi|about|chrome-extension|moz-extension):/.test(url2 || "");
  const ensureCurrentTabIsAccessible = async () => {
    const tab2 = await getCurrentTab();
    if (isProtectedPageUrl(tab2?.url)) {
      fail(PROTECTED_PAGE_MESSAGE);
      return null;
    }
    return tab2;
  };
  const recheckVideoFrames = async () => {
    const tab2 = await getCurrentTab();
    if (isProtectedPageUrl(tab2?.url)) {
      return false;
    }
    const currTabId = tab2.id;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currTabId, allFrames: true },
        func: () => {
          const video = document.querySelector("video");
          if (video) {
            chrome.runtime.sendMessage({ type: "register_video_frame" });
          }
        }
      });
    } catch (err) {
      return false;
    }
    const result = await chrome.runtime.sendMessage({
      type: "has_video_frame",
      tabId: currTabId
    });
    return !!result?.found;
  };
  const loadRooms = async (target = listRoomsBtn) => {
    setIsLoading(target, true);
    try {
      const result = await sendMessageToBG("list_rooms");
      if (result?.success) {
        const dataList = document.getElementById("room-suggestions");
        const roomList = document.getElementById("rooms-list");
        dataList.innerHTML = "";
        roomList.textContent = "";
        const rooms = result.data.roomUserCounts || result.data.rooms.map((roomName) => ({
          roomName,
          userCount: null
        }));
        if (rooms.length === 0) {
          const emptyState = document.createElement("p");
          emptyState.className = "empty-state";
          emptyState.textContent = "No rooms yet. Create the first one below.";
          roomList.appendChild(emptyState);
        }
        rooms.forEach((room) => {
          const roomName = room.roomName;
          const option = document.createElement("option");
          option.value = roomName;
          option.textContent = roomName;
          dataList.appendChild(option);
          const wrapper = document.createElement("div");
          wrapper.className = "room-row";
          const roomNameSpan = document.createElement("span");
          roomNameSpan.className = "room-row-name";
          const actionBtn = document.createElement("button");
          actionBtn.className = "btn room-row-action";
          const paintRow = (userCount) => {
            const isActiveRoom = roomName === activeRoomName;
            let label = typeof userCount === "number" ? `${roomName} (${formatUserCount(othersIn(roomName, userCount))})` : roomName;
            if (isActiveRoom && activeIsOwner) {
              label += " \xB7 host";
              roomNameSpan.title = "You're hosting this room.";
            } else if (isActiveRoom) {
              label += " \xB7 guest";
              roomNameSpan.title = "You're following this room's host.";
            } else if (room.isOwner) {
              label += " \xB7 yours";
              roomNameSpan.title = "You own this room, from another tab.";
            }
            roomNameSpan.textContent = label;
            roomNameSpan.style.fontWeight = isActiveRoom ? "bold" : "normal";
            actionBtn.textContent = isActiveRoom ? "Leave" : "Join";
          };
          paintRow(room.userCount);
          actionBtn.addEventListener("click", async () => {
            const leaving = roomName === activeRoomName;
            if (!leaving) document.getElementById("new-room-name").value = roomName;
            setIsLoading(actionBtn, true);
            let result2;
            try {
              result2 = leaving ? await doLeaveRoom(roomName) : await doJoinRoom(roomName);
            } finally {
              setIsLoading(actionBtn, false);
            }
            if (result2?.success) paintRow(result2.data?.userCount);
          });
          wrapper.appendChild(roomNameSpan);
          wrapper.appendChild(actionBtn);
          roomList.appendChild(wrapper);
        });
      } else {
        fail(result?.data?.message);
      }
    } finally {
      setIsLoading(target, false);
    }
  };
  listRoomsBtn.addEventListener("click", (e) => loadRooms(e.currentTarget));
  createRoomBtn.addEventListener("click", async (e) => {
    const target = e.currentTarget;
    target.disabled = true;
    try {
      const currRoomName = document.getElementById("new-room-name").value;
      const tab2 = await ensureCurrentTabIsAccessible();
      if (!tab2) return;
      const found = await recheckVideoFrames();
      if (!found) {
        fail("No video found in any accessible frame.");
        return;
      }
      const result = await sendMessageToVideoFrame("create_room", currRoomName);
      if (result?.success) {
        success(result.data.message);
        activeRoomName = currRoomName;
        activeIsOwner = true;
        updateRoomUserCount(currRoomName, result.data.userCount);
      } else {
        fail(result?.data?.message);
      }
    } finally {
      target.disabled = false;
    }
  });
  const doJoinRoom = async (roomName) => {
    const tab2 = await ensureCurrentTabIsAccessible();
    if (!tab2) return null;
    await recheckVideoFrames();
    const result = await sendMessageToBG("join_room", { roomName, tabId: tab2.id });
    if (result?.success) {
      success(result.data.message);
      activeRoomName = roomName;
      activeIsOwner = !!result.data.isOwner;
      updateRoomUserCount(roomName, result.data.userCount);
    } else {
      fail(result?.data?.message);
    }
    return result;
  };
  const doLeaveRoom = async (roomName) => {
    const currTabId = await getCurrentTabId();
    const result = await sendMessageToBG("leave_room", { roomName, tabId: currTabId });
    if (result?.success) {
      success(result.data.message);
      activeRoomName = null;
      activeIsOwner = null;
      clearRoomUserCount();
    } else {
      fail(result?.data?.message);
    }
    return result;
  };
  joinRoomBtn.addEventListener("click", async (e) => {
    const target = e.currentTarget;
    setIsLoading(target, true);
    try {
      await doJoinRoom(document.getElementById("new-room-name").value);
    } finally {
      setIsLoading(target, false);
    }
  });
  leaveRoomBtn.addEventListener("click", async (e) => {
    const target = e.currentTarget;
    setIsLoading(target, true);
    try {
      await doLeaveRoom(activeRoomName ?? document.getElementById("new-room-name").value);
    } finally {
      setIsLoading(target, false);
    }
  });
  serverAddressInput.addEventListener("input", async (e) => {
    const newAddress = e.currentTarget.value;
    await updateServerAddress(newAddress);
  });
  const updateServerAddress = async (newAddress) => {
    const action = normalizePopupAction({ type: "save_server", serverUrl: newAddress });
    await sendMessageToBG("set_server_address", action.serverUrl);
  };
  let storedServerAddress = "";
  let errorOnAddress = false;
  try {
    storedServerAddress = await sendMessageToBG("get_server_address");
  } catch (e) {
    errorOnAddress = true;
    fail(`Error getting stored server address: ${e.message}`);
  }
  if (storedServerAddress) {
    serverAddressInput.value = storedServerAddress;
  } else if (!errorOnAddress) {
    await updateServerAddress(serverAddressInput.value);
  }
  document.documentElement.dataset.syncerReady = "true";
  recheckBtn?.addEventListener("click", async (e) => {
    const target = e.currentTarget;
    setIsLoading(target, true);
    try {
      const found = await recheckVideoFrames();
      if (found) success("Video found");
      else fail("No video found in any frame");
    } catch (err) {
      fail(`Recheck failed: ${err.message}`);
    }
    setIsLoading(target, false);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "host_media") {
      if (message.data?.tabId === tab?.id) renderHostMedia(message.data.media);
      return;
    }
    if (message?.type === "connection_state") {
      if (!activeRoomName) return;
      if (message.data?.connected) {
        roomUserCountElem.textContent = "Reconnected";
      } else {
        roomUserCountElem.textContent = "Disconnected \u2014 reconnecting\u2026";
      }
      return;
    }
    if (message?.type !== "room_user_count") return;
    const { roomName, userCount } = message.data || {};
    if (roomName !== (activeRoomName ?? currentRoomName())) return;
    updateRoomUserCount(roomName, userCount);
  });
  const roomStatus = await sendMessageToBG("get_room_status", {
    tabId: await getCurrentTabId()
  });
  if (roomStatus?.roomName) {
    activeRoomName = roomStatus.roomName;
    activeIsOwner = !!roomStatus.isOwner;
    document.getElementById("new-room-name").value = roomStatus.roomName;
    updateRoomUserCount(roomStatus.roomName, roomStatus.userCount);
  }
  renderHostMedia(await sendMessageToBG("get_host_media", { tabId: tab?.id }));
  await loadRooms();
}
