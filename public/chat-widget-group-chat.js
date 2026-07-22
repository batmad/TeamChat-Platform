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
        : "Group chat request failed";
      var error = new Error(message);
      error.code = payload && payload.error ? payload.error.code : "GROUP_CHAT_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    return payload.data;
  };

  Client.prototype.listGroups = function () {
    return this.request("/api/widget/chat/groups");
  };

  Client.prototype.getHistory = function (groupId, options) {
    options = options || {};
    var query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit) query.set("limit", String(options.limit));
    var suffix = query.toString() ? "?" + query.toString() : "";
    return this.request("/api/widget/chat/groups/" + encodeURIComponent(groupId) + "/messages" + suffix);
  };

  Client.prototype.markReadHttp = function (groupId, upToMessageId) {
    return this.request("/api/widget/chat/groups/" + encodeURIComponent(groupId) + "/read", {
      method: "POST",
      body: JSON.stringify({ upToMessageId: upToMessageId || null })
    });
  };

  Client.prototype.requireRealtime = function () {
    if (!this.realtimeClient) throw new Error("ChatWidgetRealtime client is required for realtime group chat");
    return this.realtimeClient;
  };

  Client.prototype.join = function (groupId) {
    return this.requireRealtime().joinGroup(groupId);
  };

  Client.prototype.leave = function (groupId) {
    return this.requireRealtime().leaveGroup(groupId);
  };

  Client.prototype.send = function (groupId, content, options) {
    options = options || {};
    return this.requireRealtime().sendGroupMessage({
      groupId: groupId,
      content: content,
      replyMessageId: options.replyMessageId || null,
      clientMessageId: options.clientMessageId || null
    });
  };

  Client.prototype.markRead = function (groupId, upToMessageId) {
    var action = this.realtimeClient && this.realtimeClient.socket && this.realtimeClient.socket.connected
      ? this.realtimeClient.markGroupRead(groupId, upToMessageId)
      : this.markReadHttp(groupId, upToMessageId);
    return Promise.resolve(action).then(function (result) {
      if (result && typeof result.totalNotificationUnread === "number") {
        global.dispatchEvent(new CustomEvent("chatwidget:notification:badge", {
          detail: { totalUnread: result.totalNotificationUnread, roomId: result.room && result.room.id, roomUnread: result.unreadCount }
        }));
      }
      return result;
    });
  };

  Client.prototype.startTyping = function (groupId) {
    return this.requireRealtime().startGroupTyping(groupId);
  };

  Client.prototype.stopTyping = function (groupId) {
    return this.requireRealtime().stopGroupTyping(groupId);
  };

  global.ChatWidgetGroupChat = {
    Client: Client,
    client: null,
    createClient: function (options) { return new Client(options); }
  };
})(window);
