(function (global) {
  "use strict";

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function AuthError(message, code, status, requestId, details) {
    this.name = "ChatWidgetAuthError";
    this.message = message || "Chat widget authentication failed";
    this.code = code || "CHAT_WIDGET_AUTH_ERROR";
    this.status = status || 0;
    this.requestId = requestId;
    this.details = details;
    if (Error.captureStackTrace) Error.captureStackTrace(this, AuthError);
  }
  AuthError.prototype = Object.create(Error.prototype);
  AuthError.prototype.constructor = AuthError;

  function Client(options) {
    if (!options || !options.chatBaseUrl || !options.applicationKey) {
      throw new Error("chatBaseUrl and applicationKey are required");
    }
    this.chatBaseUrl = normalizeBaseUrl(options.chatBaseUrl);
    this.applicationKey = options.applicationKey;
    this.storage = options.storage || "session";
    this.memorySession = null;
  }

  Client.prototype.storageKey = function () {
    return "central-chat:session:" + this.applicationKey;
  };

  Client.prototype.clear = function () {
    this.memorySession = null;
    if (this.storage === "session" && global.sessionStorage) {
      global.sessionStorage.removeItem(this.storageKey());
    }
  };

  Client.prototype.getSession = function () {
    if (this.memorySession) return this.memorySession;
    if (this.storage !== "session" || !global.sessionStorage) return null;
    var raw = global.sessionStorage.getItem(this.storageKey());
    if (!raw) return null;
    try {
      var session = JSON.parse(raw);
      if (!session.accessToken || !session.application || session.application.key !== this.applicationKey || session.expiresAt <= Date.now()) {
        this.clear();
        return null;
      }
      this.memorySession = session;
      return session;
    } catch {
      this.clear();
      return null;
    }
  };

  Client.prototype.saveSession = function (session) {
    this.memorySession = session;
    if (this.storage === "session" && global.sessionStorage) {
      global.sessionStorage.setItem(this.storageKey(), JSON.stringify(session));
    }
  };

  Client.prototype.request = async function (url, options) {
    var response = await fetch(url, options);
    var body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok || !body || !body.success || !body.data) {
      throw new AuthError(
        body && body.error && body.error.message ? body.error.message : "Chat authentication request failed with HTTP " + response.status,
        body && body.error && body.error.code ? body.error.code : "CHAT_WIDGET_AUTH_REQUEST_FAILED",
        response.status,
        body && body.requestId ? body.requestId : response.headers.get("x-request-id") || undefined,
        body && body.error ? body.error.details : undefined
      );
    }
    return body.data;
  };

  Client.prototype.authenticate = async function (bootstrapToken) {
    var exchanged = await this.request(this.chatBaseUrl + "/api/widget/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: bootstrapToken })
    });
    if (!exchanged.application || exchanged.application.key !== this.applicationKey) {
      throw new AuthError("Authenticated application does not match widget application key", "CHAT_WIDGET_APPLICATION_MISMATCH", 401);
    }
    var session = Object.assign({}, exchanged, { expiresAt: Date.now() + exchanged.expiresIn * 1000 });
    this.saveSession(session);
    return session;
  };

  Client.prototype.me = async function () {
    var session = this.getSession();
    if (!session) throw new AuthError("Chat session is not available", "CHAT_SESSION_REQUIRED", 401);
    return this.request(this.chatBaseUrl + "/api/widget/auth/me", {
      method: "GET",
      headers: { authorization: "Bearer " + session.accessToken }
    });
  };

  Client.prototype.restore = async function () {
    var session = this.getSession();
    if (!session) return null;
    try {
      var current = await this.me();
      var refreshed = Object.assign({}, session, {
        application: current.application,
        user: current.user,
        sessionReference: current.sessionReference
      });
      this.saveSession(refreshed);
      return refreshed;
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        this.clear();
        return null;
      }
      throw error;
    }
  };

  Client.prototype.ensureAuthenticated = async function (bootstrapToken) {
    var restored = await this.restore();
    if (restored) return restored;
    if (!bootstrapToken) throw new AuthError("A new signed bootstrap token is required", "WIDGET_BOOTSTRAP_TOKEN_REQUIRED", 401);
    return this.authenticate(bootstrapToken);
  };

  Client.prototype.getAccessToken = function () {
    var session = this.getSession();
    return session ? session.accessToken : null;
  };

  async function autoBootstrap(script) {
    var chatBaseUrl = script.getAttribute("data-chat-base-url");
    var applicationKey = script.getAttribute("data-application-key");
    var bootstrapToken = script.getAttribute("data-bootstrap-token");
    var storage = script.getAttribute("data-storage") || "session";
    if (!chatBaseUrl || !applicationKey) return;

    var client = new Client({ chatBaseUrl: chatBaseUrl, applicationKey: applicationKey, storage: storage });
    global.ChatWidgetAuth.client = client;

    try {
      var session = await client.ensureAuthenticated(bootstrapToken);
      global.dispatchEvent(new CustomEvent("chatwidget:auth:success", { detail: session }));
    } catch (error) {
      global.dispatchEvent(new CustomEvent("chatwidget:auth:error", { detail: error }));
      if (global.console && console.error) console.error("[ChatWidgetAuth]", error);
    }
  }

  global.ChatWidgetAuth = {
    Client: Client,
    AuthError: AuthError,
    client: null,
    createClient: function (options) { return new Client(options); }
  };

  var currentScript = document.currentScript;
  if (currentScript && currentScript.hasAttribute("data-auto-bootstrap")) {
    autoBootstrap(currentScript);
  }
})(window);
