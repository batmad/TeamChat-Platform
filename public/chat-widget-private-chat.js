(function (global) {
  "use strict";

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function Client(options) {
    options = options || {};
    this.chatBaseUrl = normalizeBaseUrl(options.chatBaseUrl || global.location.origin);
    this.authClient = options.authClient || (global.ChatWidgetAuth && global.ChatWidgetAuth.client);
    this.realtimeClient = options.realtimeClient || (global.ChatWidgetRealtime && global.ChatWidgetRealtime.client);
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
      var message = payload && payload.error && payload.error.message
        ? payload.error.message
        : "Private chat request failed";
      var error = new Error(message);
      error.code = payload && payload.error ? payload.error.code : "PRIVATE_CHAT_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    return payload.data;
  };

  Client.prototype.listConversations = function () {
    return this.request("/api/widget/chat/private/conversations");
  };

  Client.prototype.listContacts = function (options) {
    options = options || {};
    var query = new URLSearchParams();
    if (options.search) query.set("search", options.search);
    if (options.limit) query.set("limit", String(options.limit));
    var suffix = query.toString() ? "?" + query.toString() : "";
    return this.request("/api/widget/chat/private/contacts" + suffix);
  };

  Client.prototype.openHttp = function (targetUserIdentityId) {
    return this.request("/api/widget/chat/private/conversations", {
      method: "POST",
      body: JSON.stringify({ targetUserIdentityId: targetUserIdentityId })
    });
  };

  Client.prototype.getHistory = function (roomId, options) {
    options = options || {};
    var query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit) query.set("limit", String(options.limit));
    var suffix = query.toString() ? "?" + query.toString() : "";
    return this.request("/api/widget/chat/private/conversations/" + encodeURIComponent(roomId) + "/messages" + suffix);
  };

  Client.prototype.markReadHttp = function (roomId, upToMessageId) {
    return this.request("/api/widget/chat/private/conversations/" + encodeURIComponent(roomId) + "/read", {
      method: "POST",
      body: JSON.stringify({ upToMessageId: upToMessageId || null })
    });
  };

  Client.prototype.requireRealtime = function () {
    if (!this.realtimeClient) throw new Error("ChatWidgetRealtime client is required for realtime private chat");
    return this.realtimeClient;
  };

  Client.prototype.open = function (targetUserIdentityId) {
    if (this.realtimeClient && this.realtimeClient.socket && this.realtimeClient.socket.connected) {
      return this.realtimeClient.openPrivateConversation(targetUserIdentityId);
    }
    return this.openHttp(targetUserIdentityId);
  };

  Client.prototype.join = function (roomId) {
    return this.requireRealtime().joinPrivateConversation(roomId);
  };

  Client.prototype.leave = function (roomId) {
    return this.requireRealtime().leavePrivateConversation(roomId);
  };

  Client.prototype.send = function (roomId, content, options) {
    options = options || {};
    return this.requireRealtime().sendPrivateMessage({
      roomId: roomId,
      content: content,
      replyMessageId: options.replyMessageId || null,
      clientMessageId: options.clientMessageId || null
    });
  };

  Client.prototype.markRead = function (roomId, upToMessageId) {
    var action = this.realtimeClient && this.realtimeClient.socket && this.realtimeClient.socket.connected
      ? this.realtimeClient.markPrivateRead(roomId, upToMessageId)
      : this.markReadHttp(roomId, upToMessageId);
    return Promise.resolve(action).then(function (result) {
      if (result && typeof result.totalNotificationUnread === "number") {
        global.dispatchEvent(new CustomEvent("chatwidget:notification:badge", {
          detail: { totalUnread: result.totalNotificationUnread, roomId: result.roomId, roomUnread: result.unreadCount }
        }));
      }
      return result;
    });
  };

  Client.prototype.startTyping = function (roomId) {
    return this.requireRealtime().startPrivateTyping(roomId);
  };

  Client.prototype.stopTyping = function (roomId) {
    return this.requireRealtime().stopPrivateTyping(roomId);
  };

  global.ChatWidgetPrivateChat = {
    Client: Client,
    client: null,
    createClient: function (options) { return new Client(options); }
  };
})(window);
