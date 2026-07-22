(function (global) {
  "use strict";

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

    if (socketPath) {
      resolvedPath = normalizeSocketPath(socketPath);
    } else if (urlPath && urlPath !== "/") {
      resolvedPath = /\/socket\.io$/i.test(urlPath)
        ? normalizeSocketPath(urlPath)
        : normalizeSocketPath(urlPath + "/socket.io");
    } else {
      resolvedPath = "/socket.io";
    }

    return {
      realtimeUrl: parsed.origin,
      path: resolvedPath,
    };
  }

  function Client(options) {
    if (!options || !options.realtimeUrl)
      throw new Error("realtimeUrl is required");
    if (!global.io)
      throw new Error(
        "Socket.IO browser client is required before chat-widget-realtime.js",
      );
    var endpoint = resolveRealtimeEndpoint(options.realtimeUrl, options.path);

    this.realtimeUrl = endpoint.realtimeUrl;
    this.path = endpoint.path;
    this.authClient =
      options.authClient ||
      (global.ChatWidgetAuth && global.ChatWidgetAuth.client);
    this.socket = null;
    this.heartbeatTimer = null;
  }

  Client.prototype.stopHeartbeat = function () {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  };

  Client.prototype.getAccessToken = function () {
    return this.authClient && this.authClient.getAccessToken
      ? this.authClient.getAccessToken()
      : null;
  };

  Client.prototype.connect = function () {
    var token = this.getAccessToken();
    if (!token)
      throw new Error(
        "Chat authentication session is required before realtime connection",
      );

    if (this.socket) {
      this.socket.auth = Object.assign({}, this.socket.auth || {}, {
        token: token,
      });
      if (!this.socket.connected) this.socket.connect();
      return this.socket;
    }

    var socket = global.io(this.realtimeUrl, {
      path: this.path,
      auth: { token: token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 20000,
    });

    socket.on("presence:ready", (payload) => {
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(function () {
        if (socket.connected) socket.emit("presence:heartbeat");
      }, payload.heartbeatIntervalMs || 25000);
      global.dispatchEvent(
        new CustomEvent("chatwidget:realtime:ready", { detail: payload }),
      );
    });

    socket.on("presence:changed", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:presence:changed", { detail: payload }),
      );
    });

    socket.on("group:joined", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:group:joined", { detail: payload }),
      );
    });

    socket.on("group:left", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:group:left", { detail: payload }),
      );
    });

    socket.on("group:message:new", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:group:message:new", { detail: payload }),
      );
    });

    socket.on("group:messages:read", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:group:messages:read", { detail: payload }),
      );
    });

    socket.on("group:typing", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:group:typing", { detail: payload }),
      );
    });

    socket.on("private:joined", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:private:joined", { detail: payload }),
      );
    });

    socket.on("private:left", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:private:left", { detail: payload }),
      );
    });

    socket.on("private:message:new", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:private:message:new", { detail: payload }),
      );
    });

    socket.on("private:messages:read", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:private:messages:read", {
          detail: payload,
        }),
      );
    });

    socket.on("private:typing", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:private:typing", { detail: payload }),
      );
    });

    socket.on("notification:new", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:notification:new", { detail: payload }),
      );
    });

    socket.on("notification:badge", function (payload) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:notification:badge", { detail: payload }),
      );
    });

    socket.on("connect", function () {
      global.dispatchEvent(
        new CustomEvent("chatwidget:realtime:connected", {
          detail: { socketId: socket.id },
        }),
      );
    });

    socket.on("disconnect", (reason) => {
      this.stopHeartbeat();
      global.dispatchEvent(
        new CustomEvent("chatwidget:realtime:disconnected", {
          detail: { reason: reason },
        }),
      );
    });

    socket.on("connect_error", function (error) {
      global.dispatchEvent(
        new CustomEvent("chatwidget:realtime:error", { detail: error }),
      );
    });

    this.socket = socket;
    return socket;
  };

  Client.prototype.disconnect = function () {
    this.stopHeartbeat();
    if (this.socket) this.socket.disconnect();
  };

  Client.prototype.refreshToken = function () {
    var token = this.getAccessToken();
    if (this.socket && token)
      this.socket.auth = Object.assign({}, this.socket.auth || {}, {
        token: token,
      });
  };

  Client.prototype.joinGroup = function (groupId) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    return new Promise((resolve, reject) => {
      this.socket.emit("group:join", { groupId: groupId }, function (result) {
        if (result && result.ok) resolve(result.data);
        else
          reject(
            new Error(
              result && result.error
                ? result.error.message
                : "Unable to join group",
            ),
          );
      });
    });
  };

  Client.prototype.leaveGroup = function (groupId) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    return new Promise((resolve, reject) => {
      this.socket.emit("group:leave", { groupId: groupId }, function (result) {
        if (result && result.ok) resolve(result.data);
        else
          reject(
            new Error(
              result && result.error
                ? result.error.message
                : "Unable to leave group",
            ),
          );
      });
    });
  };

  Client.prototype.sendGroupMessage = function (payload) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    var request = Object.assign({}, payload || {});
    if (!request.clientMessageId && global.crypto && global.crypto.randomUUID) {
      request.clientMessageId = global.crypto.randomUUID();
    }
    return new Promise((resolve, reject) => {
      this.socket.emit("group:message:send", request, function (result) {
        if (result && result.ok) resolve(result.data);
        else
          reject(
            new Error(
              result && result.error
                ? result.error.message
                : "Unable to send group message",
            ),
          );
      });
    });
  };

  Client.prototype.markGroupRead = function (groupId, upToMessageId) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    return new Promise((resolve, reject) => {
      this.socket.emit(
        "group:messages:read",
        { groupId: groupId, upToMessageId: upToMessageId || null },
        function (result) {
          if (result && result.ok) resolve(result.data);
          else
            reject(
              new Error(
                result && result.error
                  ? result.error.message
                  : "Unable to mark group messages read",
              ),
            );
        },
      );
    });
  };

  Client.prototype.startGroupTyping = function (groupId) {
    if (this.socket)
      this.socket.emit("group:typing:start", { groupId: groupId });
  };

  Client.prototype.stopGroupTyping = function (groupId) {
    if (this.socket)
      this.socket.emit("group:typing:stop", { groupId: groupId });
  };

  Client.prototype.openPrivateConversation = function (targetUserIdentityId) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    return new Promise((resolve, reject) => {
      this.socket.emit(
        "private:open",
        { targetUserIdentityId: targetUserIdentityId },
        function (result) {
          if (result && result.ok) resolve(result.data);
          else
            reject(
              new Error(
                result && result.error
                  ? result.error.message
                  : "Unable to open private conversation",
              ),
            );
        },
      );
    });
  };

  Client.prototype.joinPrivateConversation = function (roomId) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    return new Promise((resolve, reject) => {
      this.socket.emit("private:join", { roomId: roomId }, function (result) {
        if (result && result.ok) resolve(result.data);
        else
          reject(
            new Error(
              result && result.error
                ? result.error.message
                : "Unable to join private conversation",
            ),
          );
      });
    });
  };

  Client.prototype.leavePrivateConversation = function (roomId) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    return new Promise((resolve, reject) => {
      this.socket.emit("private:leave", { roomId: roomId }, function (result) {
        if (result && result.ok) resolve(result.data);
        else
          reject(
            new Error(
              result && result.error
                ? result.error.message
                : "Unable to leave private conversation",
            ),
          );
      });
    });
  };

  Client.prototype.sendPrivateMessage = function (payload) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    var request = Object.assign({}, payload || {});
    if (!request.clientMessageId && global.crypto && global.crypto.randomUUID) {
      request.clientMessageId = global.crypto.randomUUID();
    }
    return new Promise((resolve, reject) => {
      this.socket.emit("private:message:send", request, function (result) {
        if (result && result.ok) resolve(result.data);
        else
          reject(
            new Error(
              result && result.error
                ? result.error.message
                : "Unable to send private message",
            ),
          );
      });
    });
  };

  Client.prototype.markPrivateRead = function (roomId, upToMessageId) {
    if (!this.socket) throw new Error("Realtime client is not connected");
    return new Promise((resolve, reject) => {
      this.socket.emit(
        "private:messages:read",
        { roomId: roomId, upToMessageId: upToMessageId || null },
        function (result) {
          if (result && result.ok) resolve(result.data);
          else
            reject(
              new Error(
                result && result.error
                  ? result.error.message
                  : "Unable to mark private messages read",
              ),
            );
        },
      );
    });
  };

  Client.prototype.startPrivateTyping = function (roomId) {
    if (this.socket)
      this.socket.emit("private:typing:start", { roomId: roomId });
  };

  Client.prototype.stopPrivateTyping = function (roomId) {
    if (this.socket)
      this.socket.emit("private:typing:stop", { roomId: roomId });
  };

  global.ChatWidgetRealtime = {
    Client: Client,
    client: null,
    createClient: function (options) {
      return new Client(options);
    },
  };

  var currentScript = document.currentScript;
  if (currentScript && currentScript.hasAttribute("data-auto-connect")) {
    var realtimeUrl = currentScript.getAttribute("data-realtime-url");
    var path = currentScript.getAttribute("data-socket-path") || "/socket.io";
    if (realtimeUrl) {
      var realtimeClient = new Client({ realtimeUrl: realtimeUrl, path: path });
      global.ChatWidgetRealtime.client = realtimeClient;

      var connect = function () {
        try {
          realtimeClient.connect();
        } catch (error) {
          global.dispatchEvent(
            new CustomEvent("chatwidget:realtime:error", { detail: error }),
          );
        }
      };

      if (
        global.ChatWidgetAuth &&
        global.ChatWidgetAuth.client &&
        global.ChatWidgetAuth.client.getAccessToken()
      ) {
        connect();
      }
      global.addEventListener("chatwidget:auth:success", connect);
    }
  }
})(window);
