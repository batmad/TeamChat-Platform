/* eslint-disable @typescript-eslint/no-this-alias */
(function (global) {
  "use strict";

  var DEFAULTS = {
    position: "right-bottom",
    bubbleIconUrl: null,
    bubbleSize: 60,
    primaryColor: "#2563EB",
    windowWidth: 380,
    windowHeight: 600,
    theme: "light",
  };

  function normalizeSocketPath(value) {
    var path = String(value || "/socket.io").trim();

    if (path.charAt(0) !== "/") {
      path = "/" + path;
    }

    return path.replace(/\/+$/, "");
  }

  function resolveRealtimeEndpoint(realtimeUrl, socketPath) {
    var parsed = new URL(
      realtimeUrl || global.location.origin,
      global.location.href,
    );

    var urlPath = parsed.pathname.replace(/\/+$/, "");

    var resolvedPath;

    // data-socket-path selalu memiliki prioritas paling tinggi.
    if (socketPath) {
      resolvedPath = normalizeSocketPath(socketPath);
    } else if (urlPath && urlPath !== "/") {
      // Mendukung:
      // /realtime           -> /realtime/socket.io
      // /realtime/socket.io -> /realtime/socket.io
      resolvedPath = /\/socket\.io$/i.test(urlPath)
        ? normalizeSocketPath(urlPath)
        : normalizeSocketPath(urlPath + "/socket.io");
    } else {
      resolvedPath = "/socket.io";
    }

    return {
      realtimeUrl: parsed.origin,
      socketPath: resolvedPath,
    };
  }

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function scriptBaseUrl(script) {
    try {
      return new URL(script.src).origin;
    } catch {
      return global.location.origin;
    }
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID)
      return global.crypto.randomUUID();
    return (
      "cw-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2)
    );
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTime(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    } catch {
      return "";
    }
  }

  function truncate(value, size) {
    var text = String(value || "");
    return text.length > size ? text.slice(0, size - 1) + "…" : text;
  }

  function loadScript(src) {
    global.__centralChatScriptPromises =
      global.__centralChatScriptPromises || {};
    if (global.__centralChatScriptPromises[src])
      return global.__centralChatScriptPromises[src];
    global.__centralChatScriptPromises[src] = new Promise(function (
      resolve,
      reject,
    ) {
      var existing = document.querySelector(
        'script[data-central-chat-src="' + src.replace(/"/g, '\\"') + '"]',
      );
      if (existing) {
        if (existing.getAttribute("data-loaded") === "true") resolve();
        else {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
        }
        return;
      }
      var tag = document.createElement("script");
      tag.src = src;
      tag.async = true;
      tag.setAttribute("data-central-chat-src", src);
      tag.onload = function () {
        tag.setAttribute("data-loaded", "true");
        resolve();
      };
      tag.onerror = function () {
        reject(new Error("Unable to load " + src));
      };
      document.head.appendChild(tag);
    });
    return global.__centralChatScriptPromises[src];
  }

  async function fetchPublicConfig(chatBaseUrl, applicationKey) {
    var response = await fetch(
      chatBaseUrl + "/api/widget/config/" + encodeURIComponent(applicationKey),
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
    var payload = await response.json().catch(function () {
      return null;
    });
    if (!response.ok || !payload || !payload.success || !payload.data) {
      throw new Error(
        payload && payload.error && payload.error.message
          ? payload.error.message
          : "Unable to load widget configuration",
      );
    }
    return payload.data;
  }

  function mergeWidgetConfig(remote, options) {
    var override = options.widget || {};
    var widget = Object.assign(
      {},
      DEFAULTS,
      (remote && remote.widget) || {},
      override,
    );
    if (options.position) widget.position = options.position;
    if (options.theme) widget.theme = options.theme;
    if (options.primaryColor) widget.primaryColor = options.primaryColor;
    return widget;
  }

  function Widget(options) {
    if (!options || !options.applicationKey)
      throw new Error("applicationKey is required");
    this.options = Object.assign({}, options);
    this.applicationKey = options.applicationKey;
    this.chatBaseUrl = normalizeBaseUrl(
      options.chatBaseUrl || global.location.origin,
    );
    var realtimeEndpoint;

    if (options.realtimeUrl) {
      realtimeEndpoint = resolveRealtimeEndpoint(
        options.realtimeUrl,
        options.socketPath,
      );
    } else {
      // Pertahankan perilaku lama jika realtimeUrl tidak diberikan:
      // gunakan origin chatBaseUrl dengan default /socket.io.
      var chatUrl = new URL(this.chatBaseUrl, global.location.href);

      realtimeEndpoint = {
        realtimeUrl: chatUrl.origin,
        socketPath: normalizeSocketPath(options.socketPath || "/socket.io"),
      };
    }

    this.realtimeUrl = realtimeEndpoint.realtimeUrl;
    this.socketPath = realtimeEndpoint.socketPath;
    this.bootstrapToken = options.bootstrapToken || null;
    this.host = null;
    this.shadow = null;
    this.root = null;
    this.application = null;
    this.config = Object.assign({}, DEFAULTS);
    this.authClient = null;
    this.realtimeClient = null;
    this.groupClient = null;
    this.privateClient = null;
    this.notifications = null;
    this.session = null;
    this.opened = false;
    this.activeTab = "group";
    this.activeRoom = null;
    this.groups = [];
    this.conversations = [];
    this.contacts = [];
    this.messages = [];
    this.unreadByRoom = {};
    this.totalUnread = 0;
    this.loading = true;
    this.error = null;
    this.typingText = "";
    this.replyTo = null;

    this.contactMode = false;
    this.contactSearch = "";
    this.contactSearchTimer = null;
    this.contactSearchRequestId = 0;

    this.settingsOpen = false;
    this.typingTimer = null;
    this.boundEvents = [];
    this.eventsInstalled = false;
    this.dragState = {
      dragging: false,
      startX: 0,
      startY: 0,
      startLeft: 0,
      startTop: 0,
    };

    this.dragMoved = false;
  }

  Widget.prototype.bind = function (target, name, handler) {
    target.addEventListener(name, handler);
    this.boundEvents.push([target, name, handler]);
  };

  Widget.prototype.enableDrag = function () {
    var self = this;

    if (!this.launcher || !this.panel || !this.root) {
      return;
    }

    var activePointerId = null;

    function clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(value, maximum));
    }

    function applyDraggedPosition(left, top) {
      var padding = 8;
      var gap = 14;

      var bubbleSize = Number(self.config.bubbleSize) || 60;

      var panelWidth = Math.min(
        Number(self.config.windowWidth) || 380,
        global.innerWidth - 24,
      );

      var panelHeight = Math.min(
        Number(self.config.windowHeight) || 600,
        global.innerHeight - 110,
      );

      // Batasi bubble agar tidak keluar viewport.
      left = clamp(
        left,
        padding,
        Math.max(padding, global.innerWidth - bubbleSize - padding),
      );

      top = clamp(
        top,
        padding,
        Math.max(padding, global.innerHeight - bubbleSize - padding),
      );

      /*
       * Jika bubble berada di sisi kanan layar,
       * sejajarkan sisi kanan panel dengan sisi kanan bubble.
       * Jika di sisi kiri, sejajarkan sisi kirinya.
       */
      var panelLeft =
        left + bubbleSize / 2 > global.innerWidth / 2
          ? left + bubbleSize - panelWidth
          : left;

      panelLeft = clamp(
        panelLeft,
        padding,
        Math.max(padding, global.innerWidth - panelWidth - padding),
      );

      // Secara default panel muncul di atas bubble.
      var panelTop = top - panelHeight - gap;

      // Jika ruang di atas tidak cukup, tampilkan di bawah bubble.
      if (panelTop < padding) {
        panelTop = top + bubbleSize + gap;
      }

      panelTop = clamp(
        panelTop,
        padding,
        Math.max(padding, global.innerHeight - panelHeight - padding),
      );

      self.root.classList.add("cw-dragged");

      self.root.style.setProperty("--cw-launcher-left", left + "px");

      self.root.style.setProperty("--cw-launcher-top", top + "px");

      self.root.style.setProperty("--cw-panel-left", panelLeft + "px");

      self.root.style.setProperty("--cw-panel-top", panelTop + "px");
    }

    this.bind(this.launcher, "pointerdown", function (event) {
      // Hanya tombol kiri mouse.
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      var rect = self.launcher.getBoundingClientRect();

      activePointerId = event.pointerId;

      self.dragState.dragging = true;
      self.dragMoved = false;

      self.dragState.startX = event.clientX;
      self.dragState.startY = event.clientY;
      self.dragState.startLeft = rect.left;
      self.dragState.startTop = rect.top;

      if (self.launcher.setPointerCapture) {
        self.launcher.setPointerCapture(activePointerId);
      }
    });

    this.bind(this.launcher, "pointermove", function (event) {
      if (!self.dragState.dragging || event.pointerId !== activePointerId) {
        return;
      }

      var deltaX = event.clientX - self.dragState.startX;
      var deltaY = event.clientY - self.dragState.startY;

      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        self.dragMoved = true;
      }

      // Jangan mengubah posisi jika masih dianggap klik biasa.
      if (!self.dragMoved) {
        return;
      }

      applyDraggedPosition(
        self.dragState.startLeft + deltaX,
        self.dragState.startTop + deltaY,
      );
    });

    function finishDrag(event) {
      if (event.pointerId !== activePointerId) {
        return;
      }

      self.dragState.dragging = false;

      if (
        self.launcher.hasPointerCapture &&
        self.launcher.hasPointerCapture(activePointerId)
      ) {
        self.launcher.releasePointerCapture(activePointerId);
      }

      activePointerId = null;
    }

    this.bind(this.launcher, "pointerup", finishDrag);
    this.bind(this.launcher, "pointercancel", finishDrag);
  };

  Widget.prototype.unbindAll = function () {
    this.boundEvents.forEach(function (item) {
      item[0].removeEventListener(item[1], item[2]);
    });
    this.boundEvents = [];
    this.eventsInstalled = false;
  };

  Widget.prototype.ensureHost = function () {
    if (this.host) return;
    var host = document.createElement("div");
    host.setAttribute("data-central-chat-widget", this.applicationKey);
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.zIndex = "2147483000";
    host.style.pointerEvents = "none";
    document.body.appendChild(host);
    this.host = host;
    this.shadow = host.attachShadow({ mode: "open" });
    this.root = document.createElement("div");
    this.root.className = "cw-root";
    this.shadow.appendChild(this.root);
  };

  Widget.prototype.css = function () {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, textarea { font: inherit; }
      button { cursor: pointer; }
      .cw-root {
        --cw-primary: ${this.config.primaryColor};
        --cw-bg: #ffffff;
        --cw-bg-soft: #f8fafc;
        --cw-text: #0f172a;
        --cw-muted: #64748b;
        --cw-border: #e2e8f0;
        --cw-own: var(--cw-primary);
        --cw-own-text: #ffffff;
        --cw-shadow: 0 24px 60px rgba(15, 23, 42, .22);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--cw-text);
        pointer-events: auto;
      }
      .cw-root.cw-dark {
        --cw-bg: #0f172a;
        --cw-bg-soft: #172033;
        --cw-text: #f8fafc;
        --cw-muted: #94a3b8;
        --cw-border: #293548;
        --cw-shadow: 0 24px 60px rgba(0,0,0,.48);
      }
      @media (prefers-color-scheme: dark) {
        .cw-root.cw-auto {
          --cw-bg: #0f172a;
          --cw-bg-soft: #172033;
          --cw-text: #f8fafc;
          --cw-muted: #94a3b8;
          --cw-border: #293548;
          --cw-shadow: 0 24px 60px rgba(0,0,0,.48);
        }
      }
      .cw-launcher {
        position: fixed;
        bottom: 20px;
        width: ${this.config.bubbleSize}px;
        height: ${this.config.bubbleSize}px;
        border: 0;
        border-radius: 999px;
        background: var(--cw-primary);
        color: white;
        box-shadow: 0 12px 32px color-mix(in srgb, var(--cw-primary) 40%, transparent);
        display: grid;
        place-items: center;
        transition: transform .18s ease, box-shadow .18s ease;
        z-index: 2;
      }
      .cw-launcher:hover { transform: translateY(-2px) scale(1.02); }
      .cw-launcher:focus-visible { outline: 3px solid color-mix(in srgb, var(--cw-primary) 35%, white); outline-offset: 3px; }
      
      /* Posisi default tetap mengikuti konfigurasi left-bottom/right-bottom */
      .cw-right .cw-launcher,
      .cw-right .cw-panel {
        right: 20px;
      }

      .cw-left .cw-launcher,
      .cw-left .cw-panel {
        left: 20px;
      }

      /* Aktif setelah pengguna melakukan drag */
      .cw-root.cw-dragged .cw-launcher {
        left: var(--cw-launcher-left);
        top: var(--cw-launcher-top);
        right: auto;
        bottom: auto;
      }

      .cw-root.cw-dragged .cw-panel {
        left: var(--cw-panel-left);
        top: var(--cw-panel-top);
        right: auto;
        bottom: auto;
        width: min(${this.config.windowWidth}px, calc(100vw - 24px));
        height: min(${this.config.windowHeight}px, calc(100dvh - 110px));
      }

      .cw-launcher {
        cursor: grab;
        touch-action: none;
        user-select: none;
      }

      .cw-launcher:active {
        cursor: grabbing;
      }

      .cw-launcher-icon { width: 28px; height: 28px; object-fit: contain; }
      .cw-badge {
        position: absolute; top: -5px; right: -5px;
        min-width: 22px; height: 22px; padding: 0 6px;
        border-radius: 999px; background: #ef4444; color: white;
        border: 2px solid white; font-size: 11px; font-weight: 800;
        display: flex; align-items: center; justify-content: center;
      }
      .cw-badge[hidden] { display: none; }
      .cw-panel {
        position: fixed;
        bottom: ${this.config.bubbleSize + 34}px;
        width: min(${this.config.windowWidth}px, calc(100vw - 24px));
        height: min(${this.config.windowHeight}px, calc(100dvh - 110px));
        border: 1px solid var(--cw-border);
        border-radius: 22px;
        background: var(--cw-bg);
        color: var(--cw-text);
        box-shadow: var(--cw-shadow);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform-origin: bottom right;
        animation: cw-in .18s ease-out;
      }
      .cw-left .cw-panel { transform-origin: bottom left; }
      @keyframes cw-in { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
      .cw-panel[hidden] { display: none; }
      .cw-header {
        min-height: 64px; padding: 12px 14px;
        display: flex; align-items: center; gap: 10px;
        border-bottom: 1px solid var(--cw-border);
        background: var(--cw-bg);
      }
      .cw-header-main { min-width: 0; flex: 1; }
      .cw-title { font-size: 15px; line-height: 1.2; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cw-subtitle { margin-top: 3px; color: var(--cw-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cw-icon-btn {
        width: 36px; height: 36px; flex: 0 0 36px; border: 0; border-radius: 10px;
        background: var(--cw-bg-soft); color: var(--cw-text); display: grid; place-items: center;
      }
      .cw-icon-btn:hover { filter: brightness(.97); }
      .cw-tabs { display: grid; grid-template-columns: repeat(2, 1fr); padding: 8px; gap: 6px; border-bottom: 1px solid var(--cw-border); }
      .cw-tab { border: 0; padding: 9px 12px; border-radius: 10px; background: transparent; color: var(--cw-muted); font-size: 13px; font-weight: 650; }
      .cw-tab.cw-active { background: var(--cw-bg-soft); color: var(--cw-primary); }
      .cw-body { min-height: 0; flex: 1; display: flex; flex-direction: column; background: var(--cw-bg); }
      .cw-scroll { min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
      .cw-list { padding: 8px; }
      .cw-list-item { width: 100%; border: 0; background: transparent; color: inherit; text-align: left; display: flex; gap: 11px; align-items: center; padding: 11px; border-radius: 13px; }
      .cw-list-item:hover { background: var(--cw-bg-soft); }
      .cw-avatar { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 50%; background: color-mix(in srgb, var(--cw-primary) 15%, var(--cw-bg)); color: var(--cw-primary); display: grid; place-items: center; font-weight: 800; font-size: 13px; }
      .cw-item-main { min-width: 0; flex: 1; }
      .cw-item-row { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
      .cw-item-title { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cw-item-preview { margin-top: 4px; margin-left: 8px; color: var(--cw-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cw-count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--cw-primary); color: white; font-size: 10px; font-weight: 750; display: inline-flex; align-items: center; justify-content: center; }
      .cw-empty, .cw-loading, .cw-error { padding: 34px 20px; text-align: center; color: var(--cw-muted); font-size: 13px; line-height: 1.5; }
      .cw-error { color: #dc2626; }
      .cw-search { padding: 10px; border-bottom: 1px solid var(--cw-border); display: flex; gap: 8px; }
      .cw-search input, .cw-input {
        width: 100%; border: 1px solid var(--cw-border); background: var(--cw-bg-soft); color: var(--cw-text); border-radius: 12px; padding: 10px 12px; outline: 0; font-size: 13px;
      }
      .cw-search input:focus, .cw-input:focus { border-color: var(--cw-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cw-primary) 15%, transparent); }
      .cw-new-chat { margin: 10px; border: 1px dashed var(--cw-border); color: var(--cw-primary); background: transparent; border-radius: 12px; padding: 10px; font-size: 12px; font-weight: 700; }
      .cw-messages { padding: 14px; display: flex; flex-direction: column; gap: 9px; }
      .cw-message { display: flex; flex-direction: column; max-width: 82%; align-self: flex-start; }
      .cw-message.cw-own { align-self: flex-end; }
      .cw-sender { margin: 0 7px 4px; color: var(--cw-muted); font-size: 10px; }
      .cw-bubble { padding: 9px 11px; border-radius: 15px 15px 15px 5px; background: var(--cw-bg-soft); border: 1px solid var(--cw-border); color: var(--cw-text); font-size: 13px; line-height: 1.42; white-space: pre-wrap; word-break: break-word; }
      .cw-own .cw-bubble { background: var(--cw-own); border-color: var(--cw-own); color: var(--cw-own-text); border-radius: 15px 15px 5px 15px; }
      .cw-message-meta { margin: 4px 7px 0; color: var(--cw-muted); font-size: 9px; align-self: flex-end; }
      .cw-reply { margin-bottom: 6px; padding: 6px 8px; border-left: 3px solid currentColor; border-radius: 7px; background: rgba(127,127,127,.12); font-size: 10px; opacity: .82; }
      .cw-message-actions { opacity: 0; margin-top: 2px; }
      .cw-message:hover .cw-message-actions { opacity: 1; }
      .cw-reply-btn { border: 0; background: transparent; color: var(--cw-muted); font-size: 9px; padding: 2px 6px; }
      .cw-composer { border-top: 1px solid var(--cw-border); padding: 9px; background: var(--cw-bg); }
      .cw-reply-preview { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; padding: 7px 9px; border-radius: 10px; background: var(--cw-bg-soft); font-size: 11px; color: var(--cw-muted); }
      .cw-reply-preview span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cw-compose-row { display: flex; align-items: flex-end; gap: 7px; }
      .cw-input { resize: none; max-height: 110px; min-height: 42px; }
      .cw-send { width: 42px; height: 42px; flex: 0 0 42px; border: 0; border-radius: 12px; background: var(--cw-primary); color: white; display: grid; place-items: center; }
      .cw-send:disabled { opacity: .5; cursor: default; }
      .cw-typing { min-height: 20px; padding: 2px 14px 5px; font-size: 10px; color: var(--cw-muted); }
      .cw-settings { padding: 14px; display: grid; gap: 12px; }
      .cw-setting-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--cw-border); padding-bottom: 12px; font-size: 13px; }
      .cw-switch { width: 42px; height: 24px; border: 0; border-radius: 999px; background: var(--cw-border); padding: 3px; }
      .cw-switch::after { content: ""; display: block; width: 18px; height: 18px; background: white; border-radius: 50%; transition: transform .15s ease; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
      .cw-switch.cw-on { background: var(--cw-primary); }
      .cw-switch.cw-on::after { transform: translateX(18px); }
      .cw-action { border: 1px solid var(--cw-border); background: var(--cw-bg-soft); color: var(--cw-text); border-radius: 10px; padding: 9px 11px; font-size: 12px; font-weight: 650; }
      .cw-footer-note { color: var(--cw-muted); font-size: 10px; text-align: center; padding: 6px; }
      @media (max-width: 560px) {
        .cw-right .cw-panel, .cw-left .cw-panel { left: 8px; right: 8px; bottom: 82px; width: auto; height: min(${this.config.windowHeight}px, calc(100dvh - 96px)); border-radius: 18px; }
        .cw-right .cw-launcher { right: 14px; }
        .cw-left .cw-launcher { left: 14px; }
      }
    `;
  };

  Widget.prototype.renderShell = function () {
    this.ensureHost();
    var sideClass =
      this.config.position === "left-bottom" ? "cw-left" : "cw-right";
    var themeClass =
      this.config.theme === "dark"
        ? "cw-dark"
        : this.config.theme === "auto"
          ? "cw-auto"
          : "";
    this.root.className = "cw-root " + sideClass + " " + themeClass;
    var icon = this.config.bubbleIconUrl
      ? '<img class="cw-launcher-icon" alt="Chat" src="' +
        escapeHtml(this.config.bubbleIconUrl) +
        '">'
      : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18.5 3.5 21l4-1.25A9 9 0 1 0 5 18.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    this.shadow.innerHTML =
      "<style>" +
      this.css() +
      "</style>" +
      '<div class="cw-root ' +
      sideClass +
      " " +
      themeClass +
      '">' +
      '<button class="cw-launcher" type="button" aria-label="Open chat">' +
      icon +
      '<span class="cw-badge" hidden>0</span></button>' +
      '<section class="cw-panel" hidden aria-label="Chat widget"></section>' +
      "</div>";
    this.root = this.shadow.querySelector(".cw-root");
    this.launcher = this.shadow.querySelector(".cw-launcher");
    this.panel = this.shadow.querySelector(".cw-panel");
    this.badge = this.shadow.querySelector(".cw-badge");
    var self = this;

    this.launcher.addEventListener("click", function () {
      if (self.dragMoved) {
        self.dragMoved = false;
        return;
      }

      self.toggle();
    });
  };

  Widget.prototype.renderPanel = function () {
    if (!this.panel) return;
    var title = this.activeRoom
      ? this.activeRoom.title
      : this.application
        ? this.application.name
        : "Chat";
    var subtitle = this.activeRoom
      ? this.activeRoom.type === "GROUP"
        ? "Group chat"
        : this.activeRoom.canSend === false
          ? "History only · no shared group"
          : "Private chat"
      : this.session && this.session.user
        ? this.session.user.name || this.session.user.username
        : "Realtime chat";
    var back =
      this.activeRoom || this.contactMode || this.settingsOpen
        ? '<button class="cw-icon-btn" type="button" data-action="back" aria-label="Back">←</button>'
        : "";
    var settings =
      !this.activeRoom && !this.contactMode
        ? '<button class="cw-icon-btn" type="button" data-action="settings" aria-label="Notification settings">⚙</button>'
        : "";
    var roomMute = "";
    if (this.activeRoom && this.notifications && this.activeRoom.roomId) {
      var roomMutes =
        (this.notifications.settings &&
          this.notifications.settings.roomMutes) ||
        [];
      var muted = roomMutes.some(
        function (item) {
          return item.roomId === this.activeRoom.roomId;
        }.bind(this),
      );
      roomMute =
        '<button class="cw-icon-btn" type="button" data-action="room-mute" aria-label="' +
        (muted ? "Unmute conversation" : "Mute conversation") +
        '">' +
        (muted ? "🔕" : "🔔") +
        "</button>";
    }
    this.panel.innerHTML =
      '<header class="cw-header">' +
      back +
      '<div class="cw-header-main"><div class="cw-title">' +
      escapeHtml(title) +
      '</div><div class="cw-subtitle">' +
      escapeHtml(subtitle) +
      "</div></div>" +
      settings +
      roomMute +
      '<button class="cw-icon-btn" type="button" data-action="close" aria-label="Close">×</button>' +
      "</header>" +
      (this.activeRoom || this.contactMode || this.settingsOpen
        ? ""
        : this.renderTabs()) +
      '<div class="cw-body">' +
      this.renderBody() +
      "</div>";

    var close = this.panel.querySelector('[data-action="close"]');
    if (close) close.addEventListener("click", this.close.bind(this));
    var backBtn = this.panel.querySelector('[data-action="back"]');
    if (backBtn) backBtn.addEventListener("click", this.goBack.bind(this));
    var settingsBtn = this.panel.querySelector('[data-action="settings"]');
    if (settingsBtn)
      settingsBtn.addEventListener("click", () => {
        this.settingsOpen = true;
        this.renderPanel();
      });
    var roomMuteBtn = this.panel.querySelector('[data-action="room-mute"]');
    if (roomMuteBtn)
      roomMuteBtn.addEventListener("click", async () => {
        var roomId = this.activeRoom && this.activeRoom.roomId;
        if (!roomId) return;
        var roomMutes =
          (this.notifications.settings &&
            this.notifications.settings.roomMutes) ||
          [];
        var muted = roomMutes.some(function (item) {
          return item.roomId === roomId;
        });
        try {
          if (muted) await this.notifications.unmuteRoom(roomId);
          else await this.notifications.muteRoom(roomId, null);
          this.renderPanel();
        } catch (error) {
          this.toast(error.message || "Unable to update conversation mute");
        }
      });
    this.bindPanelActions();
  };

  Widget.prototype.renderTabs = function () {
    var perms =
      (this.session && this.session.user && this.session.user.permissions) ||
      [];
    var canPrivate = perms.indexOf("chat.private.view") >= 0;
    var canGroup = perms.indexOf("chat.group.view") >= 0;
    if (!canPrivate && canGroup) this.activeTab = "group";
    if (!canGroup && canPrivate) this.activeTab = "private";
    return (
      '<nav class="cw-tabs">' +
      (canPrivate
        ? '<button class="cw-tab ' +
          (this.activeTab === "private" ? "cw-active" : "") +
          '" type="button" data-tab="private">Private</button>'
        : "<span></span>") +
      (canGroup
        ? '<button class="cw-tab ' +
          (this.activeTab === "group" ? "cw-active" : "") +
          '" type="button" data-tab="group">Group</button>'
        : "<span></span>") +
      "</nav>"
    );
  };

  Widget.prototype.renderBody = function () {
    if (this.loading)
      return '<div class="cw-loading">Connecting to chat…</div>';
    if (this.error)
      return (
        '<div class="cw-error">' +
        escapeHtml(this.error) +
        '<br><button class="cw-action" data-action="retry" type="button" style="margin-top:12px">Try again</button></div>'
      );
    if (this.settingsOpen) return this.renderSettings();
    if (this.contactMode) return this.renderContacts();
    if (this.activeRoom) return this.renderConversation();
    return this.activeTab === "private"
      ? this.renderPrivateList()
      : this.renderGroupList();
  };

  Widget.prototype.renderPrivateList = function () {
    var items = this.conversations
      .map((item) => {
        var participant = item.participant || {};
        var name = participant.name || participant.username || "Unknown user";
        var unread =
          this.unreadByRoom[item.roomId] != null
            ? this.unreadByRoom[item.roomId]
            : item.unreadCount || 0;
        var preview = item.lastMessage
          ? (item.lastMessage.senderName || item.lastMessage.senderUsername) +
            ": " +
            item.lastMessage.content
          : "No messages yet";
        return (
          '<button class="cw-list-item" type="button" data-private-room="' +
          escapeHtml(item.roomId) +
          '">' +
          '<span class="cw-avatar">' +
          escapeHtml(name.slice(0, 2).toUpperCase()) +
          "</span>" +
          '<span class="cw-item-main"><span class="cw-item-row"><span class="cw-item-title">' +
          escapeHtml(name) +
          "</span>" +
          (unread
            ? '<span class="cw-count">' +
              (unread > 99 ? "99+" : unread) +
              "</span>"
            : "") +
          "</span>" +
          '<span class="cw-item-preview">' +
          escapeHtml(truncate(preview, 70)) +
          "</span></span></button>"
        );
      })
      .join("");
    return (
      '<button class="cw-new-chat" data-action="new-private" type="button">＋ Start a new private chat</button><div class="cw-scroll"><div class="cw-list">' +
      (items || '<div class="cw-empty">No private conversations yet.</div>') +
      "</div></div>"
    );
  };

  Widget.prototype.renderGroupList = function () {
    var items = this.groups
      .map((item) => {
        var unread =
          item.roomId && this.unreadByRoom[item.roomId] != null
            ? this.unreadByRoom[item.roomId]
            : item.unreadCount || 0;
        var preview = item.lastMessage
          ? (item.lastMessage.senderName || item.lastMessage.senderUsername) +
            ": " +
            item.lastMessage.content
          : "No messages yet";
        return (
          '<button class="cw-list-item" type="button" data-group-id="' +
          escapeHtml(item.id) +
          '">' +
          '<span class="cw-avatar">#</span><span class="cw-item-main"><span class="cw-item-row"><span class="cw-item-title">' +
          escapeHtml(item.name) +
          "</span>" +
          (unread
            ? '<span class="cw-count">' +
              (unread > 99 ? "99+" : unread) +
              "</span>"
            : "") +
          "</span>" +
          '<span class="cw-item-preview">' +
          escapeHtml(truncate(preview, 70)) +
          "</span></span></button>"
        );
      })
      .join("");
    return (
      '<div class="cw-scroll"><div class="cw-list">' +
      (items ||
        '<div class="cw-empty">No groups are available for your account.</div>') +
      "</div></div>"
    );
  };

  Widget.prototype.renderContacts = function () {
    var items = this.contacts
      .map(function (item) {
        var name = item.name || item.username;

        return (
          '<button class="cw-list-item" type="button" data-contact-id="' +
          escapeHtml(item.userIdentityId) +
          '">' +
          '<span class="cw-avatar">' +
          escapeHtml(name.slice(0, 2).toUpperCase()) +
          "</span>" +
          '<span class="cw-item-main">' +
          '<span class="cw-item-title">' +
          escapeHtml(name) +
          "</span>" +
          '<span class="cw-item-preview">' +
          escapeHtml(item.username) +
          "</span>" +
          "</span>" +
          "</button>"
        );
      })
      .join("");

    return (
      '<div class="cw-search">' +
      '<input type="search" ' +
      'placeholder="Search user…" ' +
      "data-contact-search " +
      'value="' +
      escapeHtml(this.contactSearch || "") +
      '">' +
      "</div>" +
      '<div class="cw-scroll">' +
      '<div class="cw-list">' +
      (items || '<div class="cw-empty">No eligible users found.</div>') +
      "</div>" +
      "</div>"
    );
  };

  Widget.prototype.renderConversation = function () {
    var ownIdentityId =
      this.session && this.session.user && this.session.user.identityId;
    var messages = this.messages
      .map((message) => {
        var own =
          message.sender && message.sender.userIdentityId === ownIdentityId;
        var sender =
          (message.sender &&
            (message.sender.name || message.sender.username)) ||
          "Unknown";
        var reply = message.replyTo
          ? '<div class="cw-reply"><strong>' +
            escapeHtml(
              message.replyTo.senderName || message.replyTo.senderUsername,
            ) +
            "</strong><br>" +
            escapeHtml(truncate(message.replyTo.content, 90)) +
            "</div>"
          : "";
        return (
          '<div class="cw-message ' +
          (own ? "cw-own" : "") +
          '" data-message-id="' +
          escapeHtml(message.id) +
          '">' +
          (!own && this.activeRoom.type === "GROUP"
            ? '<div class="cw-sender">' + escapeHtml(sender) + "</div>"
            : "") +
          '<div class="cw-bubble">' +
          reply +
          escapeHtml(message.content) +
          "</div>" +
          '<div class="cw-message-meta">' +
          escapeHtml(formatTime(message.createdAt)) +
          (own ? " · ✓" + (message.readCount > 0 ? "✓" : "") : "") +
          "</div>" +
          '<div class="cw-message-actions"><button class="cw-reply-btn" type="button" data-reply-id="' +
          escapeHtml(message.id) +
          '">Reply</button></div>' +
          "</div>"
        );
      })
      .join("");
    var replyPreview = this.replyTo
      ? '<div class="cw-reply-preview"><span>Replying to ' +
        escapeHtml(this.replyTo.sender.name || this.replyTo.sender.username) +
        ": " +
        escapeHtml(truncate(this.replyTo.content, 70)) +
        '</span><button class="cw-icon-btn" type="button" data-action="cancel-reply" style="width:26px;height:26px;flex-basis:26px">×</button></div>'
      : "";
    var disabled =
      this.activeRoom.canSend === false
        ? ' disabled placeholder="You can view history but cannot send new messages"'
        : ' placeholder="Type a message…"';
    return (
      '<div class="cw-scroll" data-message-scroll><div class="cw-messages">' +
      (messages || '<div class="cw-empty">No messages yet. Say hello!</div>') +
      "</div></div>" +
      '<div class="cw-typing">' +
      escapeHtml(this.typingText) +
      "</div>" +
      '<div class="cw-composer">' +
      replyPreview +
      '<div class="cw-compose-row"><textarea class="cw-input" rows="1" maxlength="4000" data-message-input' +
      disabled +
      '></textarea><button class="cw-send" type="button" data-action="send"' +
      (this.activeRoom.canSend === false ? " disabled" : "") +
      ' aria-label="Send">➤</button></div></div>'
    );
  };

  Widget.prototype.renderSettings = function () {
    var settings = (this.notifications && this.notifications.settings) || {
      soundEnabled: true,
      browserNotificationEnabled: true,
      muteAll: false,
      roomMutes: [],
    };
    return (
      '<div class="cw-scroll"><div class="cw-settings">' +
      '<div class="cw-setting-row"><span><strong>Notification sound</strong><br><small style="color:var(--cw-muted)">Play a sound for new messages</small></span><button class="cw-switch ' +
      (settings.soundEnabled ? "cw-on" : "") +
      '" type="button" data-setting="soundEnabled"></button></div>' +
      '<div class="cw-setting-row"><span><strong>Browser notification</strong><br><small style="color:var(--cw-muted)">Show system notifications when chat is hidden</small></span><button class="cw-switch ' +
      (settings.browserNotificationEnabled ? "cw-on" : "") +
      '" type="button" data-setting="browserNotificationEnabled"></button></div>' +
      '<div class="cw-setting-row"><span><strong>Mute all</strong><br><small style="color:var(--cw-muted)">Keep unread badges but silence alerts</small></span><button class="cw-switch ' +
      (settings.muteAll ? "cw-on" : "") +
      '" type="button" data-setting="muteAll"></button></div>' +
      '<button class="cw-action" type="button" data-action="browser-permission">Enable browser notification permission</button>' +
      '<div class="cw-footer-note">Notification preferences are saved for this chat account.</div>' +
      "</div></div>"
    );
  };

  Widget.prototype.bindPanelActions = function () {
    var self = this;
    this.panel.querySelectorAll("[data-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        self.activeTab = button.getAttribute("data-tab");
        self.renderPanel();
      });
    });
    var retry = this.panel.querySelector('[data-action="retry"]');
    if (retry)
      retry.addEventListener("click", function () {
        self.initializeSession();
      });
    var newPrivate = this.panel.querySelector('[data-action="new-private"]');
    if (newPrivate)
      newPrivate.addEventListener("click", function () {
        self.openContacts();
      });
    this.panel.querySelectorAll("[data-group-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        self.openGroup(button.getAttribute("data-group-id"));
      });
    });
    this.panel
      .querySelectorAll("[data-private-room]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          self.openPrivateRoom(button.getAttribute("data-private-room"));
        });
      });
    this.panel.querySelectorAll("[data-contact-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        self.openPrivateContact(button.getAttribute("data-contact-id"));
      });
    });
    var contactSearch = this.panel.querySelector("[data-contact-search]");

    if (contactSearch) {
      contactSearch.addEventListener("input", function (event) {
        var value = event.currentTarget.value;

        // Simpan keyword terbaru.
        self.contactSearch = value;

        // Batalkan hasil request sebelumnya secara logis.
        self.contactSearchRequestId += 1;

        clearTimeout(self.contactSearchTimer);

        self.contactSearchTimer = setTimeout(function () {
          self.searchContacts(value).catch(function (error) {
            self.toast(
              error && error.message
                ? error.message
                : "Unable to search contacts",
            );
          });
        }, 300);
      });
    }
    var send = this.panel.querySelector('[data-action="send"]');
    var input = this.panel.querySelector("[data-message-input]");
    if (send)
      send.addEventListener("click", function () {
        self.sendCurrentMessage();
      });
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          self.sendCurrentMessage();
          return;
        }
        self.emitTyping();
      });
      input.addEventListener("input", function () {
        self.emitTyping();
      });
      input.addEventListener("blur", function () {
        self.stopTyping();
      });
    }
    this.panel.querySelectorAll("[data-reply-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        self.replyTo =
          self.messages.find(function (message) {
            return message.id === button.getAttribute("data-reply-id");
          }) || null;
        self.renderPanel();
        self.focusComposer();
      });
    });
    var cancelReply = this.panel.querySelector('[data-action="cancel-reply"]');
    if (cancelReply)
      cancelReply.addEventListener("click", function () {
        self.replyTo = null;
        self.renderPanel();
        self.focusComposer();
      });
    this.panel.querySelectorAll("[data-setting]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var key = button.getAttribute("data-setting");
        var current =
          self.notifications.settings && self.notifications.settings[key];
        try {
          await self.notifications.updateSettings({ [key]: !current });
          self.renderPanel();
        } catch (error) {
          self.toast(error.message || "Unable to save notification settings");
        }
      });
    });
    var permissionBtn = this.panel.querySelector(
      '[data-action="browser-permission"]',
    );
    if (permissionBtn)
      permissionBtn.addEventListener("click", async function () {
        var result = await self.notifications.requestBrowserPermission();
        self.toast("Browser notification permission: " + result);
      });
    this.scrollMessagesToBottom();
  };

  Widget.prototype.focusComposer = function () {
    setTimeout(() => {
      var input =
        this.panel && this.panel.querySelector("[data-message-input]");
      if (input) input.focus();
    }, 0);
  };

  Widget.prototype.scrollMessagesToBottom = function () {
    setTimeout(() => {
      var scroll =
        this.panel && this.panel.querySelector("[data-message-scroll]");
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }, 0);
  };

  Widget.prototype.goBack = function () {
    this.error = null;

    if (this.activeRoom) {
      this.leaveActiveRoom();
    }

    this.activeRoom = null;
    this.messages = [];
    this.replyTo = null;
    this.typingText = "";

    this.contactMode = false;
    this.contactSearch = "";

    clearTimeout(this.contactSearchTimer);
    this.contactSearchRequestId += 1;

    this.settingsOpen = false;

    if (this.notifications) {
      this.notifications.setActiveRoom(null);
    }

    this.renderPanel();
    this.refreshLists();
  };

  Widget.prototype.open = function () {
    this.opened = true;
    this.panel.hidden = false;
    if (this.notifications) {
      this.notifications.setWidgetOpen(true);
      this.notifications.unlockSound();
      if (
        this.notifications.settings &&
        this.notifications.settings.browserNotificationEnabled
      )
        this.notifications.requestBrowserPermission().catch(function () {});
    }
    this.renderPanel();
  };

  Widget.prototype.close = function () {
    this.opened = false;
    this.panel.hidden = true;
    if (this.notifications) this.notifications.setWidgetOpen(false);
  };

  Widget.prototype.toggle = function () {
    if (this.opened) this.close();
    else this.open();
  };

  Widget.prototype.updateBadge = function (totalUnread, unreadByRoom) {
    this.totalUnread = Math.max(0, Number(totalUnread) || 0);
    if (unreadByRoom) this.unreadByRoom = Object.assign({}, unreadByRoom);
    if (this.badge) {
      this.badge.textContent =
        this.totalUnread > 99 ? "99+" : String(this.totalUnread);
      this.badge.hidden = this.totalUnread <= 0;
    }
    if (
      this.opened &&
      !this.activeRoom &&
      !this.settingsOpen &&
      !this.contactMode
    )
      this.renderPanel();
  };

  Widget.prototype.refreshLists = async function () {
    if (!this.session) return;
    var permissions =
      (this.session.user && this.session.user.permissions) || [];
    var tasks = [];
    if (permissions.indexOf("chat.group.view") >= 0)
      tasks.push(
        this.groupClient.listGroups().then((data) => {
          this.groups = data.groups || data || [];
        }),
      );
    if (permissions.indexOf("chat.private.view") >= 0)
      tasks.push(
        this.privateClient.listConversations().then((data) => {
          this.conversations = data.conversations || data || [];
        }),
      );
    await Promise.all(tasks);
    if (
      this.opened &&
      !this.activeRoom &&
      !this.contactMode &&
      !this.settingsOpen
    )
      this.renderPanel();
  };

  Widget.prototype.openContacts = async function () {
    this.error = null;
    this.contactMode = true;
    this.activeRoom = null;
    this.contacts = [];
    this.contactSearch = "";

    clearTimeout(this.contactSearchTimer);
    this.contactSearchRequestId += 1;

    this.renderPanel();
    this.focusContactSearch();

    try {
      await this.searchContacts("");
    } catch (error) {
      this.toast(
        error && error.message ? error.message : "Unable to load contacts",
      );
    }
  };

  Widget.prototype.searchContacts = async function (search) {
    var keyword = String(search || "");
    var requestId = ++this.contactSearchRequestId;

    this.contactSearch = keyword;

    try {
      var data = await this.privateClient.listContacts({
        search: keyword.trim() || undefined,
        limit: 50,
      });

      // Abaikan response lama.
      if (requestId !== this.contactSearchRequestId) {
        return;
      }

      this.contacts = data.contacts || data || [];

      if (this.contactMode) {
        this.renderPanel();
        this.focusContactSearch();
      }
    } catch (error) {
      // Jangan tampilkan error dari request pencarian lama.
      if (requestId !== this.contactSearchRequestId) {
        return;
      }

      throw error;
    }
  };

  Widget.prototype.focusContactSearch = function () {
    setTimeout(() => {
      if (!this.contactMode || !this.panel) {
        return;
      }

      var input = this.panel.querySelector("[data-contact-search]");

      if (!input) {
        return;
      }

      input.focus();

      var cursorPosition = input.value.length;

      if (typeof input.setSelectionRange === "function") {
        input.setSelectionRange(cursorPosition, cursorPosition);
      }
    }, 0);
  };

  Widget.prototype.openGroup = async function (groupId) {
    try {
      this.error = null;
      this.loading = true;
      this.renderPanel();
      var group = this.groups.find(function (item) {
        return item.id === groupId;
      });
      var joined = await this.groupClient.join(groupId);
      var history = await this.groupClient.getHistory(groupId, { limit: 60 });
      this.activeRoom = {
        type: "GROUP",
        groupId: groupId,
        roomId: history.room.id,
        title: group ? group.name : history.group.name,
        canSend: true,
      };
      this.messages = (history.messages || []).slice().reverse();
      this.loading = false;
      this.contactMode = false;
      this.contactSearch = "";

      clearTimeout(this.contactSearchTimer);
      this.contactSearchRequestId += 1;
      this.settingsOpen = false;
      this.notifications.setActiveRoom(history.room.id);
      this.renderPanel();
      var latest = this.messages[this.messages.length - 1];
      if (latest)
        await this.groupClient
          .markRead(groupId, latest.id)
          .catch(function () {});
      if (joined && joined.unreadCount != null) this.refreshLists();
    } catch (error) {
      this.loading = false;
      this.error = error.message || "Unable to open group";
      this.renderPanel();
    }
  };

  Widget.prototype.openPrivateRoom = async function (roomId) {
    try {
      this.error = null;
      this.loading = true;
      this.renderPanel();
      var conversation = this.conversations.find(function (item) {
        return item.roomId === roomId;
      });
      await this.privateClient.join(roomId);
      var history = await this.privateClient.getHistory(roomId, { limit: 60 });
      var participant =
        history.participant || (conversation && conversation.participant) || {};
      this.activeRoom = {
        type: "PRIVATE",
        roomId: roomId,
        title: participant.name || participant.username || "Private chat",
        canSend: history.canSend !== false,
      };
      this.messages = (history.messages || []).slice().reverse();
      this.loading = false;
      this.contactMode = false;
      this.contactSearch = "";

      clearTimeout(this.contactSearchTimer);
      this.contactSearchRequestId += 1;
      this.settingsOpen = false;
      this.notifications.setActiveRoom(roomId);
      this.renderPanel();
      var latest = this.messages[this.messages.length - 1];
      if (latest)
        await this.privateClient
          .markRead(roomId, latest.id)
          .catch(function () {});
      this.refreshLists();
    } catch (error) {
      this.loading = false;
      this.error = error.message || "Unable to open private conversation";
      this.renderPanel();
    }
  };

  Widget.prototype.openPrivateContact = async function (userIdentityId) {
    try {
      this.error = null;
      this.loading = true;
      this.contactMode = false;
      this.renderPanel();
      var opened = await this.privateClient.open(userIdentityId);
      await this.openPrivateRoom(opened.roomId);
    } catch (error) {
      this.loading = false;
      this.error = error.message || "Unable to start private conversation";
      this.renderPanel();
    }
  };

  Widget.prototype.leaveActiveRoom = function () {
    if (!this.activeRoom) return;
    if (this.activeRoom.type === "GROUP")
      this.groupClient.leave(this.activeRoom.groupId).catch(function () {});
    else this.privateClient.leave(this.activeRoom.roomId).catch(function () {});
    this.stopTyping();
  };

  Widget.prototype.appendMessage = function (message) {
    if (
      !message ||
      this.messages.some(function (item) {
        return item.id === message.id;
      })
    )
      return;
    this.messages.push(message);
    if (this.opened) {
      this.renderPanel();
      this.scrollMessagesToBottom();
    }
  };

  Widget.prototype.sendCurrentMessage = async function () {
    if (!this.activeRoom || this.activeRoom.canSend === false) return;
    var input = this.panel.querySelector("[data-message-input]");
    var content = input ? input.value.trim() : "";
    if (!content) return;
    if (input) input.value = "";
    this.stopTyping();
    try {
      var options = {
        clientMessageId: uid(),
        replyMessageId: (this.replyTo && this.replyTo.id) || null,
      };
      var message =
        this.activeRoom.type === "GROUP"
          ? await this.groupClient.send(
              this.activeRoom.groupId,
              content,
              options,
            )
          : await this.privateClient.send(
              this.activeRoom.roomId,
              content,
              options,
            );
      this.replyTo = null;
      this.appendMessage(message);
      this.refreshLists();
    } catch (error) {
      this.toast(error.message || "Unable to send message");
      if (input) input.value = content;
    }
  };

  Widget.prototype.emitTyping = function () {
    if (!this.activeRoom) return;
    clearTimeout(this.typingTimer);
    if (this.activeRoom.type === "GROUP")
      this.groupClient.startTyping(this.activeRoom.groupId);
    else this.privateClient.startTyping(this.activeRoom.roomId);
    this.typingTimer = setTimeout(this.stopTyping.bind(this), 1200);
  };

  Widget.prototype.stopTyping = function () {
    clearTimeout(this.typingTimer);
    if (!this.activeRoom) return;
    if (this.activeRoom.type === "GROUP")
      this.groupClient.stopTyping(this.activeRoom.groupId);
    else this.privateClient.stopTyping(this.activeRoom.roomId);
  };

  Widget.prototype.toast = function (message) {
    if (!this.shadow) return;
    var existing = this.shadow.querySelector(".cw-toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.className = "cw-toast";
    toast.style.cssText =
      "position:fixed;bottom:92px;left:50%;transform:translateX(-50%);max-width:320px;padding:10px 14px;border-radius:10px;background:#0f172a;color:white;font:12px system-ui;box-shadow:0 10px 30px rgba(0,0,0,.25);z-index:5;pointer-events:none";
    toast.textContent = message;
    this.shadow.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 3200);
  };

  Widget.prototype.installEvents = function () {
    if (this.eventsInstalled) return;
    this.eventsInstalled = true;
    this.bind(global, "chatwidget:notification:badge-change", (event) => {
      var detail = event.detail || {};
      this.updateBadge(detail.totalUnread, detail.unreadByRoom);
    });
    this.bind(global, "chatwidget:group:message:new", (event) => {
      var message = event.detail;
      if (
        this.activeRoom &&
        this.activeRoom.type === "GROUP" &&
        message.groupId === this.activeRoom.groupId
      ) {
        this.appendMessage(message);
        this.groupClient
          .markRead(this.activeRoom.groupId, message.id)
          .catch(function () {});
      }
      this.refreshLists();
    });
    this.bind(global, "chatwidget:private:message:new", (event) => {
      var message = event.detail;
      if (
        this.activeRoom &&
        this.activeRoom.type === "PRIVATE" &&
        message.roomId === this.activeRoom.roomId
      ) {
        this.appendMessage(message);
        this.privateClient
          .markRead(this.activeRoom.roomId, message.id)
          .catch(function () {});
      }
      this.refreshLists();
    });
    this.bind(global, "chatwidget:group:typing", (event) => {
      var detail = event.detail || {};
      if (
        !this.activeRoom ||
        this.activeRoom.type !== "GROUP" ||
        detail.groupId !== this.activeRoom.groupId
      )
        return;
      this.typingText =
        detail.isTyping === false
          ? ""
          : ((detail.user && (detail.user.name || detail.user.username)) ||
              "Someone") + " is typing…";
      if (this.opened) this.renderPanel();
    });
    this.bind(global, "chatwidget:private:typing", (event) => {
      var detail = event.detail || {};
      if (
        !this.activeRoom ||
        this.activeRoom.type !== "PRIVATE" ||
        detail.roomId !== this.activeRoom.roomId
      )
        return;
      this.typingText =
        detail.isTyping === false
          ? ""
          : ((detail.user && (detail.user.name || detail.user.username)) ||
              "Someone") + " is typing…";
      if (this.opened) this.renderPanel();
    });
    this.bind(global, "chatwidget:notification:open", (event) => {
      var payload = event.detail || {};
      var metadata =
        (payload.notification && payload.notification.metadata) || {};
      this.open();
      if (metadata.chatType === "GROUP" && metadata.groupId)
        this.openGroup(metadata.groupId);
      else if (metadata.chatType === "PRIVATE" && metadata.senderUserIdentityId)
        this.openPrivateContact(metadata.senderUserIdentityId);
    });
    this.bind(global, "chatwidget:realtime:error", (event) => {
      var error = event.detail;
      if (error && error.message) this.toast(error.message);
    });
  };

  Widget.prototype.loadDependencies = async function () {
    var base = this.chatBaseUrl;
    await loadScript(base + "/chat-widget-auth.js");
    var socketScript =
      this.realtimeUrl + normalizeSocketPath(this.socketPath) + "/socket.io.js";
    if (!global.io) await loadScript(socketScript);
    await loadScript(base + "/chat-widget-realtime.js");
    await Promise.all([
      loadScript(base + "/chat-widget-group-chat.js"),
      loadScript(base + "/chat-widget-private-chat.js"),
      loadScript(base + "/chat-widget-notifications.js"),
    ]);
  };

  Widget.prototype.initializeSession = async function () {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      await this.loadDependencies();
      this.authClient = global.ChatWidgetAuth.createClient({
        chatBaseUrl: this.chatBaseUrl,
        applicationKey: this.applicationKey,
        storage: this.options.storage || "session",
      });
      global.ChatWidgetAuth.client = this.authClient;
      this.session = await this.authClient.ensureAuthenticated(
        this.bootstrapToken,
      );
      this.realtimeClient = global.ChatWidgetRealtime.createClient({
        realtimeUrl: this.realtimeUrl,
        path: this.socketPath,
        authClient: this.authClient,
      });
      global.ChatWidgetRealtime.client = this.realtimeClient;
      this.groupClient = global.ChatWidgetGroupChat.createClient({
        chatBaseUrl: this.chatBaseUrl,
        authClient: this.authClient,
        realtimeClient: this.realtimeClient,
      });
      global.ChatWidgetGroupChat.client = this.groupClient;
      this.privateClient = global.ChatWidgetPrivateChat.createClient({
        chatBaseUrl: this.chatBaseUrl,
        authClient: this.authClient,
        realtimeClient: this.realtimeClient,
      });
      global.ChatWidgetPrivateChat.client = this.privateClient;
      this.notifications = global.ChatWidgetNotifications.createClient({
        chatBaseUrl: this.chatBaseUrl,
        authClient: this.authClient,
      });
      global.ChatWidgetNotifications.client = this.notifications;
      this.realtimeClient.connect();
      await this.notifications.start();
      this.notifications.setWidgetOpen(this.opened);
      this.updateBadge(
        this.notifications.totalUnread,
        this.notifications.unreadByRoom,
      );
      this.installEvents();
      this.error = null;
      var permissions =
        (this.session.user && this.session.user.permissions) || [];
      this.activeTab =
        permissions.indexOf("chat.private.view") >= 0 &&
        permissions.indexOf("chat.group.view") < 0
          ? "private"
          : "group";
      await this.refreshLists();
      this.loading = false;
      this.renderPanel();
      global.dispatchEvent(
        new CustomEvent("chatwidget:ready", {
          detail: { application: this.application, user: this.session.user },
        }),
      );
    } catch (error) {
      this.loading = false;
      this.error =
        error && error.message
          ? error.message
          : "Unable to initialize chat widget";
      this.renderPanel();
      global.dispatchEvent(
        new CustomEvent("chatwidget:error", { detail: error }),
      );
    }
  };

  Widget.prototype.init = async function () {
    this.ensureHost();
    try {
      var publicConfig = await fetchPublicConfig(
        this.chatBaseUrl,
        this.applicationKey,
      );
      this.application = publicConfig.application;
      this.config = mergeWidgetConfig(publicConfig, this.options);
    } catch (error) {
      this.application = {
        key: this.applicationKey,
        name: this.options.applicationName || "Chat",
      };
      this.config = mergeWidgetConfig(null, this.options);
      this.error = error.message;
    }
    this.renderShell();

    this.enableDrag();

    this.renderPanel();

    await this.initializeSession();
    return this;
  };

  Widget.prototype.destroy = function () {
    clearTimeout(this.contactSearchTimer);
    this.contactSearchRequestId += 1;

    this.unbindAll();
    this.leaveActiveRoom();

    if (this.notifications) {
      this.notifications.stop();
    }

    if (this.realtimeClient) {
      this.realtimeClient.disconnect();
    }

    if (this.host) {
      this.host.remove();
    }

    this.host = null;
    this.shadow = null;
    this.root = null;
  };

  global.ChatWidget = {
    instance: null,
    Widget: Widget,
    init: async function (options) {
      if (global.ChatWidget.instance) global.ChatWidget.instance.destroy();
      var widget = new Widget(options);
      global.ChatWidget.instance = widget;
      await widget.init();
      return widget;
    },
    open: function () {
      if (global.ChatWidget.instance) global.ChatWidget.instance.open();
    },
    close: function () {
      if (global.ChatWidget.instance) global.ChatWidget.instance.close();
    },
    toggle: function () {
      if (global.ChatWidget.instance) global.ChatWidget.instance.toggle();
    },
    destroy: function () {
      if (global.ChatWidget.instance) {
        global.ChatWidget.instance.destroy();
        global.ChatWidget.instance = null;
      }
    },
  };

  var currentScript = document.currentScript;
  if (
    currentScript &&
    currentScript.getAttribute("data-application-key") &&
    !currentScript.hasAttribute("data-manual")
  ) {
    var base =
      currentScript.getAttribute("data-chat-base-url") ||
      scriptBaseUrl(currentScript);
    var options = {
      chatBaseUrl: base,
      realtimeUrl: currentScript.getAttribute("data-realtime-url") || undefined,
      socketPath: currentScript.getAttribute("data-socket-path") || undefined,
      applicationKey: currentScript.getAttribute("data-application-key"),
      bootstrapToken:
        currentScript.getAttribute("data-bootstrap-token") || null,
      storage: currentScript.getAttribute("data-storage") || "session",
      position: currentScript.getAttribute("data-position") || undefined,
      theme: currentScript.getAttribute("data-theme") || undefined,
      primaryColor:
        currentScript.getAttribute("data-primary-color") || undefined,
    };
    global.ChatWidget.init(options).catch(function (error) {
      if (global.console && console.error) console.error("[ChatWidget]", error);
    });
  }
})(window);
