(function (global) {
  "use strict";

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function Client(options) {
    options = options || {};
    this.chatBaseUrl = normalizeBaseUrl(options.chatBaseUrl || global.location.origin);
    this.authClient = options.authClient || (global.ChatWidgetAuth && global.ChatWidgetAuth.client);
    this.totalUnread = 0;
    this.unreadByRoom = {};
    this.activeRoomId = null;
    this.widgetOpen = false;
    this.settings = null;
    this.audioContext = null;
    this.started = false;
    this.handleNotification = this.handleNotification.bind(this);
    this.handleBadge = this.handleBadge.bind(this);
  }

  Client.prototype.getAccessToken = function () {
    return this.authClient && this.authClient.getAccessToken ? this.authClient.getAccessToken() : null;
  };

  Client.prototype.request = async function (path, options) {
    var token = this.getAccessToken();
    if (!token) throw new Error("Chat authentication session is required");
    var response = await fetch(this.chatBaseUrl + path, Object.assign({}, options || {}, {
      headers: Object.assign({}, (options && options.headers) || {}, {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      })
    }));
    var payload = await response.json().catch(function () { return null; });
    if (!response.ok || !payload || payload.success === false) {
      var error = new Error(payload && payload.error && payload.error.message
        ? payload.error.message
        : "Notification request failed");
      error.code = payload && payload.error ? payload.error.code : "NOTIFICATION_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    return payload.data;
  };

  Client.prototype.loadSettings = async function () {
    this.settings = await this.request("/api/widget/notifications/settings");
    global.dispatchEvent(new CustomEvent("chatwidget:notification:settings", { detail: this.settings }));
    return this.settings;
  };

  Client.prototype.updateSettings = async function (settings) {
    this.settings = await this.request("/api/widget/notifications/settings", {
      method: "PATCH",
      body: JSON.stringify(settings || {})
    });
    global.dispatchEvent(new CustomEvent("chatwidget:notification:settings", { detail: this.settings }));
    return this.settings;
  };

  Client.prototype.loadSummary = async function () {
    var summary = await this.request("/api/widget/notifications/summary");
    this.updateBadge(summary.totalUnread || 0, summary.unreadByRoom || {});
    return summary;
  };

  Client.prototype.muteRoom = function (roomId, mutedUntil) {
    return this.request("/api/widget/notifications/mutes/" + encodeURIComponent(roomId), {
      method: "PUT",
      body: JSON.stringify({ mutedUntil: mutedUntil || null })
    }).then(() => this.loadSettings());
  };

  Client.prototype.unmuteRoom = function (roomId) {
    return this.request("/api/widget/notifications/mutes/" + encodeURIComponent(roomId), {
      method: "DELETE"
    }).then(() => this.loadSettings());
  };

  Client.prototype.setActiveRoom = function (roomId) {
    this.activeRoomId = roomId || null;
  };

  Client.prototype.setWidgetOpen = function (isOpen) {
    this.widgetOpen = Boolean(isOpen);
  };

  Client.prototype.updateBadge = function (totalUnread, unreadByRoom, roomId, roomUnread) {
    this.totalUnread = Math.max(0, Number(totalUnread) || 0);
    if (unreadByRoom) this.unreadByRoom = Object.assign({}, unreadByRoom);
    if (roomId && typeof roomUnread === "number") {
      this.unreadByRoom[roomId] = Math.max(0, roomUnread);
    }
    global.dispatchEvent(new CustomEvent("chatwidget:notification:badge-change", {
      detail: {
        totalUnread: this.totalUnread,
        unreadByRoom: Object.assign({}, this.unreadByRoom)
      }
    }));
  };

  Client.prototype.unlockSound = function () {
    try {
      var AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return false;
      if (!this.audioContext) this.audioContext = new AudioContext();
      if (this.audioContext.state === "suspended") this.audioContext.resume();
      return true;
    } catch {
      return false;
    }
  };

  Client.prototype.playSound = function () {
    try {
      if (!this.unlockSound() || !this.audioContext) return false;
      var oscillator = this.audioContext.createOscillator();
      var gain = this.audioContext.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, this.audioContext.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(this.audioContext.destination);
      oscillator.start();
      oscillator.stop(this.audioContext.currentTime + 0.2);
      return true;
    } catch {
      global.dispatchEvent(new CustomEvent("chatwidget:notification:sound-blocked"));
      return false;
    }
  };

  Client.prototype.requestBrowserPermission = async function () {
    if (!("Notification" in global)) return "unsupported";
    if (global.Notification.permission === "granted") return "granted";
    return global.Notification.requestPermission();
  };

  Client.prototype.claimCrossTabNotification = function (notificationId) {
    if (!notificationId || !global.localStorage) return true;
    var key = "central-chat:notified:" + notificationId;
    try {
      if (global.localStorage.getItem(key)) return false;
      global.localStorage.setItem(key, String(Date.now()));
      setTimeout(function () {
        try { global.localStorage.removeItem(key); } catch {}
      }, 60000);
      return true;
    } catch {
      return true;
    }
  };

  Client.prototype.showBrowserNotification = function (payload) {
    if (!("Notification" in global) || global.Notification.permission !== "granted") return false;
    var notification = new global.Notification(payload.notification.title, {
      body: payload.notification.body || "New message",
      tag: "central-chat:" + payload.notification.id,
      data: {
        roomId: payload.notification.roomId,
        messageId: payload.notification.messageId,
        metadata: payload.notification.metadata
      }
    });
    notification.onclick = function () {
      global.focus();
      global.dispatchEvent(new CustomEvent("chatwidget:notification:open", { detail: payload }));
      notification.close();
    };
    return true;
  };

  Client.prototype.handleNotification = function (event) {
    var payload = event && event.detail;
    if (!payload || !payload.notification) return;
    this.updateBadge(
      payload.totalUnread || 0,
      null,
      payload.notification.roomId,
      typeof payload.roomUnread === "number" ? payload.roomUnread : undefined
    );

    global.dispatchEvent(new CustomEvent("chatwidget:notification:received", { detail: payload }));

    var isActiveRoom = this.activeRoomId && payload.notification.roomId === this.activeRoomId;
    if (isActiveRoom || payload.muted) return;
    if (!this.claimCrossTabNotification(payload.notification.id)) return;

    if (payload.shouldPlaySound) this.playSound();
    var shouldShowBrowser = !global.document || global.document.hidden || !this.widgetOpen;
    if (payload.shouldShowBrowserNotification && shouldShowBrowser) {
      this.showBrowserNotification(payload);
    }
  };

  Client.prototype.handleBadge = function (event) {
    var payload = event && event.detail;
    this.updateBadge(
      payload && typeof payload.totalUnread === "number" ? payload.totalUnread : 0,
      null,
      payload && payload.roomId,
      payload && typeof payload.roomUnread === "number" ? payload.roomUnread : undefined
    );
  };

  Client.prototype.start = async function () {
    if (this.started) return this;
    this.started = true;
    global.addEventListener("chatwidget:notification:new", this.handleNotification);
    global.addEventListener("chatwidget:notification:badge", this.handleBadge);
    global.addEventListener("pointerdown", () => this.unlockSound(), { once: true, passive: true });
    await Promise.all([this.loadSettings(), this.loadSummary()]);
    return this;
  };

  Client.prototype.stop = function () {
    if (!this.started) return;
    this.started = false;
    global.removeEventListener("chatwidget:notification:new", this.handleNotification);
    global.removeEventListener("chatwidget:notification:badge", this.handleBadge);
  };

  global.ChatWidgetNotifications = {
    Client: Client,
    client: null,
    createClient: function (options) { return new Client(options); }
  };
})(window);
