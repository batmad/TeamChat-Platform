(function (global) {
  "use strict";

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function requestError(payload, fallback, status) {
    var message =
      payload && payload.error && payload.error.message
        ? payload.error.message
        : fallback;
    var error = new Error(message);
    error.code =
      payload && payload.error && payload.error.code
        ? payload.error.code
        : "ATTACHMENT_REQUEST_FAILED";
    error.status = status;
    return error;
  }

  function Client(options) {
    options = options || {};
    this.chatBaseUrl = normalizeBaseUrl(
      options.chatBaseUrl || global.location.origin,
    );
    this.authClient =
      options.authClient ||
      (global.ChatWidgetAuth && global.ChatWidgetAuth.client);
    this.realtimeClient =
      options.realtimeClient ||
      (global.ChatWidgetRealtime && global.ChatWidgetRealtime.client);
    this.config = null;
  }

  Client.prototype.getAccessToken = function () {
    return this.authClient && this.authClient.getAccessToken
      ? this.authClient.getAccessToken()
      : null;
  };

  Client.prototype.authHeaders = function (headers) {
    var token = this.getAccessToken();
    if (!token) throw new Error("Chat authentication session is required");
    return Object.assign({}, headers || {}, {
      Authorization: "Bearer " + token,
    });
  };

  Client.prototype.requestJson = async function (path, options) {
    var response = await fetch(
      this.chatBaseUrl + path,
      Object.assign({}, options || {}, {
        headers: this.authHeaders((options && options.headers) || {}),
      }),
    );
    var payload = await response.json().catch(function () {
      return null;
    });
    if (!response.ok || !payload || payload.success === false) {
      throw requestError(payload, "Attachment request failed", response.status);
    }
    return payload.data;
  };

  Client.prototype.getConfig = async function (force) {
    if (this.config && force !== true) return this.config;
    this.config = await this.requestJson("/api/widget/attachments/config", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return this.config;
  };

  Client.prototype.upload = function (file, scope, onProgress) {
    var xhr = new XMLHttpRequest();

    var promise = new Promise((resolve, reject) => {
      var token;

      try {
        token = this.getAccessToken();

        if (!token) {
          throw new Error("Chat authentication session is required");
        }
      } catch (error) {
        reject(error);
        return;
      }

      var form = new FormData();
      form.append("scope", scope);
      form.append("files", file, file.name);

      xhr.open(
        "POST",
        this.chatBaseUrl + "/api/widget/attachments/upload",
        true,
      );

      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("Accept", "application/json");

      xhr.upload.onprogress = function (event) {
        if (!onProgress || !event.lengthComputable) return;

        onProgress(
          Math.max(
            0,
            Math.min(100, Math.round((event.loaded / event.total) * 100)),
          ),
        );
      };

      xhr.onerror = function () {
        reject(new Error("Attachment upload network error"));
      };

      xhr.onabort = function () {
        var error = new Error("Attachment upload cancelled");
        error.code = "ATTACHMENT_UPLOAD_ABORTED";
        reject(error);
      };

      xhr.onload = function () {
        var payload = safeJson(xhr.responseText);

        if (
          xhr.status < 200 ||
          xhr.status >= 300 ||
          !payload ||
          payload.success === false
        ) {
          reject(requestError(payload, "Attachment upload failed", xhr.status));
          return;
        }

        var attachments = payload.data && payload.data.attachments;

        if (!attachments || !attachments.length) {
          reject(new Error("Attachment upload returned no attachment"));
          return;
        }

        if (onProgress) {
          onProgress(100);
        }

        resolve(attachments[0]);
      };

      xhr.send(form);
    });

    return {
      promise: promise,

      abort: function () {
        if (xhr.readyState !== XMLHttpRequest.DONE) {
          xhr.abort();
        }
      },
    };
  };

  Client.prototype.discard = function (attachmentId) {
    return this.requestJson(
      "/api/widget/attachments/" +
        encodeURIComponent(attachmentId) +
        "/discard",
      { method: "DELETE", headers: { Accept: "application/json" } },
    );
  };

  Client.prototype.delete = function (attachmentId) {
    if (
      this.realtimeClient &&
      this.realtimeClient.socket &&
      this.realtimeClient.socket.connected &&
      typeof this.realtimeClient.deleteAttachment === "function"
    ) {
      return this.realtimeClient.deleteAttachment(attachmentId);
    }
    return this.requestJson(
      "/api/widget/attachments/" + encodeURIComponent(attachmentId),
      { method: "DELETE", headers: { Accept: "application/json" } },
    );
  };

  Client.prototype.resolveAccess = function (attachmentId, action) {
    return this.requestJson(
      "/api/widget/attachments/" +
        encodeURIComponent(attachmentId) +
        "/access?action=" +
        encodeURIComponent(action),
      { method: "GET", headers: { Accept: "application/json" } },
    );
  };

  Client.prototype.fetchProxyBlob = async function (attachmentId, action) {
    var response = await fetch(
      this.chatBaseUrl +
        "/api/widget/attachments/" +
        encodeURIComponent(attachmentId) +
        "/" +
        (action === "preview" ? "preview" : "download"),
      {
        method: "GET",
        headers: this.authHeaders({ Accept: "*/*" }),
      },
    );
    if (!response.ok) {
      var payload = await response.json().catch(function () {
        return null;
      });
      throw requestError(
        payload,
        "Attachment file request failed",
        response.status,
      );
    }
    return response.blob();
  };

  Client.prototype.getBrowserSource = async function (attachmentId, action) {
    var access = await this.resolveAccess(attachmentId, action);
    if (access.delivery === "SIGNED_URL" && access.url) {
      return {
        kind: "SIGNED_URL",
        url: access.url,
        originalName: access.originalName,
        mimeType: access.mimeType,
      };
    }
    var blob = await this.fetchProxyBlob(attachmentId, action);
    return {
      kind: "OBJECT_URL",
      url: URL.createObjectURL(blob),
      originalName: access.originalName,
      mimeType: access.mimeType || blob.type,
    };
  };

  Client.prototype.open = async function (attachmentId, action) {
    var previewWindow = null;
    if (action === "preview") {
      previewWindow = global.open("about:blank", "_blank");
      if (previewWindow) previewWindow.opener = null;
    }
    var source;
    try {
      source = await this.getBrowserSource(attachmentId, action);
    } catch (error) {
      if (previewWindow) previewWindow.close();
      throw error;
    }
    if (action === "download") {
      var anchor = document.createElement("a");
      anchor.href = source.url;
      anchor.rel = "noopener noreferrer";
      if (source.kind === "OBJECT_URL")
        anchor.download = source.originalName || "attachment";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      if (source.kind === "OBJECT_URL") {
        setTimeout(function () {
          URL.revokeObjectURL(source.url);
        }, 60000);
      }
      return source;
    }

    if (!previewWindow) {
      if (source.kind === "OBJECT_URL") URL.revokeObjectURL(source.url);
      throw new Error("Preview popup was blocked by the browser");
    }
    previewWindow.location.href = source.url;
    if (source.kind === "OBJECT_URL") {
      setTimeout(function () {
        URL.revokeObjectURL(source.url);
      }, 300000);
    }
    return source;
  };

  global.ChatWidgetAttachments = {
    Client: Client,
    client: null,
    createClient: function (options) {
      return new Client(options || {});
    },
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID)
      return global.crypto.randomUUID();
    return (
      "att-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2)
    );
  }

  function formatBytes(value) {
    var bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024)
      return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / 1024 / 1024).toFixed(bytes < 10485760 ? 1 : 0) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  }

  function fileExtension(name) {
    var value = String(name || "");
    var index = value.lastIndexOf(".");
    return index >= 0 ? value.slice(index + 1).toLowerCase() : "";
  }

  function attachmentState(widget) {
    if (!widget.__attachmentState) {
      widget.__attachmentState = {
        config: null,
        configLoading: false,
        configFailed: false,
        pending: [],
        draft: "",
        previewCache: {},
      };
    }
    return widget.__attachmentState;
  }

  function scopeName(widget) {
    return widget.activeRoom && widget.activeRoom.type === "PRIVATE"
      ? "PRIVATE"
      : "GROUP";
  }

  function scopeConfig(widget) {
    var state = attachmentState(widget);
    var config = state.config;
    if (!config || !config.scopes || !widget.activeRoom) return null;
    return config.scopes[scopeName(widget)] || null;
  }

  function canSendAttachments(widget) {
    var state = attachmentState(widget);
    var scope = scopeConfig(widget);
    return Boolean(
      widget.activeRoom &&
      widget.activeRoom.canSend !== false &&
      state.config &&
      state.config.enabled &&
      scope &&
      scope.enabled &&
      scope.canSend,
    );
  }

  function allowedFileType(widget, extension) {
    var state = attachmentState(widget);
    var types = (state.config && state.config.fileTypes) || [];
    return types.find(function (item) {
      return String(item.extension || "").toLowerCase() === extension;
    });
  }

  function canPreviewAttachment(widget, attachment) {
    var state = attachmentState(widget);
    var scope = scopeConfig(widget);
    if (!scope || !scope.canPreview || attachment.status !== "READY")
      return false;
    var type = allowedFileType(
      widget,
      String(attachment.extension || "").toLowerCase(),
    );
    if (!type || !type.isAllowed || !type.previewable) return false;
    if (attachment.previewKind === "IMAGE")
      return Boolean(state.config.preview && state.config.preview.image);
    if (attachment.previewKind === "PDF")
      return Boolean(state.config.preview && state.config.preview.pdf);
    return false;
  }

  function attachmentAccept(widget) {
    var state = attachmentState(widget);
    return ((state.config && state.config.fileTypes) || [])
      .filter(function (item) {
        return item.isAllowed;
      })
      .map(function (item) {
        return "." + item.extension;
      })
      .join(",");
  }

  function attachmentCss() {
    return `
      .cw-composer.cw-attachment-drop { outline: 2px dashed var(--cw-primary); outline-offset: -5px; background: color-mix(in srgb, var(--cw-primary) 5%, var(--cw-bg)); }
      .cw-attach-btn { width: 42px; height: 42px; flex: 0 0 42px; border: 1px solid var(--cw-border); border-radius: 12px; background: var(--cw-bg-soft); color: var(--cw-text); display: grid; place-items: center; font-size: 18px; }
      .cw-attach-btn:disabled { opacity: .45; cursor: default; }
      .cw-pending-attachments { display: grid; gap: 6px; margin-bottom: 8px; }
      .cw-pending-attachment { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; padding: 8px 9px; border: 1px solid var(--cw-border); border-radius: 11px; background: var(--cw-bg-soft); }
      .cw-pending-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 700; }
      .cw-pending-meta { margin-top: 2px; color: var(--cw-muted); font-size: 9px; }
      .cw-pending-actions { display: flex; align-items: center; gap: 4px; }
      .cw-attachment-mini-btn { border: 0; background: transparent; color: var(--cw-muted); padding: 4px 6px; border-radius: 7px; font-size: 10px; }
      .cw-attachment-mini-btn:hover { background: rgba(127,127,127,.12); }
      .cw-upload-track { height: 3px; overflow: hidden; margin-top: 6px; border-radius: 999px; background: var(--cw-border); }
      .cw-upload-bar { height: 100%; border-radius: inherit; background: var(--cw-primary); transition: width .12s linear; }
      .cw-attachments { display: grid; gap: 7px; margin-top: 7px; }
      .cw-attachment-card { min-width: 190px; max-width: 270px; overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 11px; background: rgba(127,127,127,.08); }
      .cw-attachment-thumb { display: block; width: 100%; max-height: 170px; object-fit: cover; background: rgba(127,127,127,.1); }
      .cw-attachment-body { display: flex; align-items: center; gap: 8px; padding: 8px; }
      .cw-attachment-icon { width: 30px; height: 30px; flex: 0 0 30px; display: grid; place-items: center; border-radius: 8px; background: rgba(127,127,127,.12); }
      .cw-attachment-main { min-width: 0; flex: 1; }
      .cw-attachment-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 750; }
      .cw-attachment-meta { margin-top: 2px; font-size: 8px; opacity: .72; }
      .cw-attachment-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px 8px; }
      .cw-attachment-action { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 7px; background: transparent; color: inherit; padding: 4px 7px; font-size: 8px; font-weight: 700; }
      .cw-attachment-status { padding: 8px; font-size: 9px; opacity: .74; }
    `;
  }

  function ensureAttachmentStyles(widget) {
    if (
      !widget.shadow ||
      widget.shadow.querySelector("style[data-cw-attachments]")
    )
      return;
    var style = document.createElement("style");
    style.setAttribute("data-cw-attachments", "true");
    style.textContent = attachmentCss();
    widget.shadow.appendChild(style);
  }

  function ensureClient(widget) {
    var state = attachmentState(widget);
    if (!widget.authClient || !widget.realtimeClient) return;
    if (!widget.attachmentClient) {
      widget.attachmentClient = new Client({
        chatBaseUrl: widget.chatBaseUrl,
        authClient: widget.authClient,
        realtimeClient: widget.realtimeClient,
      });
      global.ChatWidgetAttachments.client = widget.attachmentClient;
    }
    if (state.config || state.configLoading || state.configFailed) return;
    state.configLoading = true;
    widget.attachmentClient
      .getConfig()
      .then(function (config) {
        state.config = config;
        state.configLoading = false;
        if (widget.panel) widget.renderPanel();
      })
      .catch(function (error) {
        state.configLoading = false;
        state.configFailed = true;
        if (global.console && console.warn) {
          console.warn("[ChatWidget] Attachment config unavailable", error);
        }
      });
  }

  function validateSelection(widget, files) {
    var state = attachmentState(widget);
    var config = state.config;
    if (!canSendAttachments(widget))
      throw new Error("Attachments are not available for this conversation");
    var limits = config.limits || {};
    var pending = state.pending;
    if (
      pending.length + files.length >
      Number(limits.maxFilesPerMessage || 0)
    ) {
      throw new Error("Too many attachments for one message");
    }
    var total = pending.reduce(function (sum, item) {
      return sum + Number(item.file.size || 0);
    }, 0);
    files.forEach(function (file) {
      var extension = fileExtension(file.name);
      var type = allowedFileType(widget, extension);
      if (!extension || !type || !type.isAllowed) {
        throw new Error(
          "File type ." + (extension || "unknown") + " is not allowed",
        );
      }
      var maxFile = Number(limits.maxFileSizeBytes || 0);
      var typeMax = type.maxSizeBytes == null ? 0 : Number(type.maxSizeBytes);
      var effectiveMax = typeMax > 0 && typeMax < maxFile ? typeMax : maxFile;
      if (effectiveMax > 0 && file.size > effectiveMax) {
        throw new Error(file.name + " exceeds the allowed file size");
      }
      total += file.size;
    });
    var maxTotal = Number(limits.maxTotalSizeBytes || 0);
    if (maxTotal > 0 && total > maxTotal) {
      throw new Error("Total attachment size exceeds the configured maximum");
    }
  }

  function updateProgressDom(widget, item) {
    if (!widget.panel) return;
    var bar = widget.panel.querySelector(
      '[data-upload-bar="' + item.localId + '"]',
    );
    if (bar) bar.style.width = item.progress + "%";
    var label = widget.panel.querySelector(
      '[data-upload-label="' + item.localId + '"]',
    );
    if (label) label.textContent = "Uploading " + item.progress + "%";
  }

  function startUpload(widget, item) {
    if (!widget.attachmentClient || item.cancelled) return;
    item.status = "UPLOADING";
    item.progress = 0;
    item.error = null;
    var upload = widget.attachmentClient.upload(
      item.file,
      scopeName(widget),
      function (progress) {
        item.progress = progress;
        updateProgressDom(widget, item);
      },
    );
    item.upload = upload;
    upload.promise
      .then(function (attachment) {
        item.upload = null;
        if (
          item.cancelled ||
          attachmentState(widget).pending.indexOf(item) < 0
        ) {
          widget.attachmentClient.discard(attachment.id).catch(function () {});
          return;
        }
        item.attachment = attachment;
        item.status = "READY";
        item.progress = 100;
        widget.renderPanel();
      })
      .catch(function (error) {
        item.upload = null;
        if (
          item.cancelled ||
          (error && error.code === "ATTACHMENT_UPLOAD_ABORTED")
        )
          return;
        item.status = "FAILED";
        item.error = error && error.message ? error.message : "Upload failed";
        widget.renderPanel();
      });
  }

  function queueFiles(widget, fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    try {
      validateSelection(widget, files);
    } catch (error) {
      widget.toast(error.message || "Attachment selection is invalid");
      return;
    }
    var state = attachmentState(widget);
    var created = files.map(function (file) {
      return {
        localId: uid(),
        file: file,
        status: "UPLOADING",
        progress: 0,
        error: null,
        attachment: null,
        upload: null,
        cancelled: false,
      };
    });
    state.pending = state.pending.concat(created);
    widget.renderPanel();
    created.forEach(function (item) {
      startUpload(widget, item);
    });
  }

  function removePending(widget, localId) {
    var state = attachmentState(widget);
    var item = state.pending.find(function (candidate) {
      return candidate.localId === localId;
    });
    if (!item) return;
    if (item.status === "UPLOADING") {
      item.cancelled = true;
      if (item.upload && item.upload.abort) item.upload.abort();
      state.pending = state.pending.filter(function (candidate) {
        return candidate !== item;
      });
      widget.renderPanel();
      return;
    }
    if (
      (item.status === "READY" || item.status === "REMOVE_FAILED") &&
      item.attachment
    ) {
      item.status = "REMOVING";
      widget.renderPanel();
      widget.attachmentClient
        .discard(item.attachment.id)
        .then(function () {
          state.pending = state.pending.filter(function (candidate) {
            return candidate !== item;
          });
          widget.renderPanel();
        })
        .catch(function (error) {
          item.status = "REMOVE_FAILED";
          item.error = error.message || "Unable to remove attachment";
          widget.toast(item.error);
          widget.renderPanel();
        });
      return;
    }
    state.pending = state.pending.filter(function (candidate) {
      return candidate !== item;
    });
    widget.renderPanel();
  }

  function retryPending(widget, localId) {
    var item = attachmentState(widget).pending.find(function (candidate) {
      return candidate.localId === localId;
    });
    if (!item || item.status !== "FAILED") return;
    item.cancelled = false;
    widget.renderPanel();
    startUpload(widget, item);
  }

  function discardPending(widget) {
    var state = attachmentState(widget);
    var items = state.pending.slice();
    state.pending = [];
    items.forEach(function (item) {
      item.cancelled = true;
      if (item.upload && item.upload.abort) item.upload.abort();
      if (item.attachment && widget.attachmentClient) {
        widget.attachmentClient
          .discard(item.attachment.id)
          .catch(function () {});
      }
    });
  }

  function renderPending(widget) {
    var items = attachmentState(widget).pending;
    if (!items.length) return "";
    return (
      '<div class="cw-pending-attachments">' +
      items
        .map(function (item) {
          var status =
            item.status === "UPLOADING"
              ? "Uploading " + item.progress + "%"
              : item.status === "READY"
                ? "Ready"
                : item.status === "REMOVING"
                  ? "Removing…"
                  : item.status === "REMOVE_FAILED"
                    ? "Cleanup failed"
                    : "Failed";
          return (
            '<div class="cw-pending-attachment">' +
            '<div><div class="cw-pending-name">📎 ' +
            escapeHtml(item.file.name) +
            "</div>" +
            '<div class="cw-pending-meta"><span data-upload-label="' +
            item.localId +
            '">' +
            escapeHtml(status) +
            "</span> · " +
            formatBytes(item.file.size) +
            (item.error
              ? ' · <span style="color:#dc2626">' +
                escapeHtml(item.error) +
                "</span>"
              : "") +
            "</div>" +
            (item.status === "UPLOADING"
              ? '<div class="cw-upload-track"><div class="cw-upload-bar" data-upload-bar="' +
                item.localId +
                '" style="width:' +
                item.progress +
                '%"></div></div>'
              : "") +
            '</div><div class="cw-pending-actions">' +
            (item.status === "FAILED"
              ? '<button class="cw-attachment-mini-btn" type="button" data-attachment-retry="' +
                item.localId +
                '">Retry</button>'
              : "") +
            (item.status === "REMOVING"
              ? ""
              : '<button class="cw-attachment-mini-btn" type="button" data-attachment-remove="' +
                item.localId +
                '" aria-label="Remove attachment">×</button>') +
            "</div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function statusLabel(attachment) {
    if (attachment.status === "DELETED") return "Attachment deleted";
    if (attachment.status === "EXPIRED") return "File expired";
    if (attachment.status === "SCANNING") return "Scanning…";
    if (attachment.status === "REJECTED") return "Attachment unavailable";
    if (
      attachment.status === "DELETE_FAILED" ||
      attachment.status === "DELETING"
    )
      return "Deletion pending";
    if (attachment.status !== "READY")
      return String(attachment.status || "Unavailable").toLowerCase();
    return null;
  }

  function renderMessageAttachment(widget, attachment, own) {
    var scope = scopeConfig(widget) || {};
    var label = statusLabel(attachment);
    var extension = String(attachment.extension || "file").toUpperCase();
    if (label) {
      return (
        '<div class="cw-attachment-card"><div class="cw-attachment-status">📎 ' +
        escapeHtml(attachment.originalName || "Attachment") +
        "<br><strong>" +
        escapeHtml(label) +
        "</strong></div></div>"
      );
    }
    var preview = canPreviewAttachment(widget, attachment);
    var canDelete = own ? scope.canDelete : scope.canDeleteOthers;
    var image =
      preview && attachment.previewKind === "IMAGE"
        ? '<img class="cw-attachment-thumb" data-attachment-preview-image="' +
          escapeHtml(attachment.id) +
          '" alt="' +
          escapeHtml(attachment.originalName || "Attachment preview") +
          '" hidden>'
        : "";
    return (
      '<div class="cw-attachment-card" data-attachment-card="' +
      escapeHtml(attachment.id) +
      '">' +
      image +
      '<div class="cw-attachment-body"><div class="cw-attachment-icon">📎</div><div class="cw-attachment-main"><div class="cw-attachment-name">' +
      escapeHtml(attachment.originalName || "Attachment") +
      '</div><div class="cw-attachment-meta">' +
      escapeHtml(extension) +
      " · " +
      formatBytes(attachment.sizeBytes) +
      "</div></div></div>" +
      '<div class="cw-attachment-actions">' +
      (preview
        ? '<button class="cw-attachment-action" type="button" data-attachment-preview="' +
          escapeHtml(attachment.id) +
          '">Preview</button>'
        : "") +
      (scope.canDownload
        ? '<button class="cw-attachment-action" type="button" data-attachment-download="' +
          escapeHtml(attachment.id) +
          '">Download</button>'
        : "") +
      (canDelete
        ? '<button class="cw-attachment-action" type="button" data-attachment-delete="' +
          escapeHtml(attachment.id) +
          '">Delete</button>'
        : "") +
      "</div></div>"
    );
  }

  function enhanceMessages(widget) {
    if (!widget.activeRoom || !widget.panel) return;
    var ownIdentityId =
      widget.session && widget.session.user && widget.session.user.identityId;
    (widget.messages || []).forEach(function (message) {
      if (!message.attachments || !message.attachments.length) return;
      var node = widget.panel.querySelector(
        '[data-message-id="' + message.id + '"]',
      );
      var bubble = node && node.querySelector(".cw-bubble");
      if (!bubble || bubble.querySelector(".cw-attachments")) return;
      var own =
        message.sender && message.sender.userIdentityId === ownIdentityId;
      var html =
        '<div class="cw-attachments">' +
        message.attachments
          .map(function (attachment) {
            return renderMessageAttachment(widget, attachment, own);
          })
          .join("") +
        "</div>";
      bubble.insertAdjacentHTML("beforeend", html);
    });
  }

  function previewCacheValid(entry) {
    if (!entry) return false;
    if (entry.kind === "OBJECT_URL") return true;
    return Date.now() - entry.createdAt < 45000;
  }

  function hydratePreviews(widget) {
    if (!widget.panel || !widget.attachmentClient) return;
    var state = attachmentState(widget);
    widget.panel
      .querySelectorAll("[data-attachment-preview-image]")
      .forEach(function (image) {
        var attachmentId = image.getAttribute("data-attachment-preview-image");
        if (!attachmentId || image.getAttribute("data-loading") === "1") return;
        var cached = state.previewCache[attachmentId];
        if (previewCacheValid(cached)) {
          image.src = cached.url;
          image.hidden = false;
          return;
        }
        image.setAttribute("data-loading", "1");
        widget.attachmentClient
          .getBrowserSource(attachmentId, "preview")
          .then(function (source) {
            var previous = state.previewCache[attachmentId];
            if (previous && previous.kind === "OBJECT_URL")
              URL.revokeObjectURL(previous.url);
            state.previewCache[attachmentId] = {
              kind: source.kind,
              url: source.url,
              createdAt: Date.now(),
            };
            if (image.isConnected) {
              image.src = source.url;
              image.hidden = false;
            }
          })
          .catch(function () {})
          .finally(function () {
            if (image.isConnected) image.removeAttribute("data-loading");
          });
      });
  }

  function revokePreview(widget, attachmentId) {
    var cache = attachmentState(widget).previewCache;
    var entry = cache[attachmentId];
    if (entry && entry.kind === "OBJECT_URL") URL.revokeObjectURL(entry.url);
    delete cache[attachmentId];
  }

  function applyDeleted(widget, detail) {
    if (!detail || !detail.attachmentId) return;
    (widget.messages || []).forEach(function (message) {
      (message.attachments || []).forEach(function (attachment) {
        if (attachment.id !== detail.attachmentId) return;
        attachment.status = "DELETED";
        attachment.deletedAt = detail.deletedAt || new Date().toISOString();
        attachment.deleteReason = detail.deleteReason || "USER_DELETE";
      });
    });
    revokePreview(widget, detail.attachmentId);
    if (widget.panel) widget.renderPanel();
  }

  function bindAttachmentActions(widget) {
    if (!widget.panel || !widget.attachmentClient) return;
    widget.panel
      .querySelectorAll("[data-attachment-remove]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          removePending(widget, button.getAttribute("data-attachment-remove"));
        });
      });
    widget.panel
      .querySelectorAll("[data-attachment-retry]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          retryPending(widget, button.getAttribute("data-attachment-retry"));
        });
      });
    widget.panel
      .querySelectorAll("[data-attachment-preview]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          widget.attachmentClient
            .open(button.getAttribute("data-attachment-preview"), "preview")
            .catch(function (error) {
              widget.toast(error.message || "Unable to preview attachment");
            });
        });
      });
    widget.panel
      .querySelectorAll("[data-attachment-download]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          widget.attachmentClient
            .open(button.getAttribute("data-attachment-download"), "download")
            .catch(function (error) {
              widget.toast(error.message || "Unable to download attachment");
            });
        });
      });
    widget.panel
      .querySelectorAll("[data-attachment-delete]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          var attachmentId = button.getAttribute("data-attachment-delete");
          if (!attachmentId || !global.confirm("Delete this attachment?"))
            return;
          button.disabled = true;
          widget.attachmentClient
            .delete(attachmentId)
            .then(function (detail) {
              applyDeleted(widget, detail);
            })
            .catch(function (error) {
              button.disabled = false;
              widget.toast(error.message || "Unable to delete attachment");
            });
        });
      });
  }

  function enhanceComposer(widget) {
    if (!widget.activeRoom || !widget.panel || !canSendAttachments(widget))
      return;
    var state = attachmentState(widget);
    var composer = widget.panel.querySelector(".cw-composer");
    var row = composer && composer.querySelector(".cw-compose-row");
    var input = composer && composer.querySelector("[data-message-input]");
    if (!composer || !row || !input) return;

    if (state.draft && !input.value) input.value = state.draft;
    var pendingHtml = renderPending(widget);
    if (pendingHtml) composer.insertAdjacentHTML("afterbegin", pendingHtml);

    var attachButton = document.createElement("button");
    attachButton.type = "button";
    attachButton.className = "cw-attach-btn";
    attachButton.setAttribute("data-action", "attachment-pick");
    attachButton.setAttribute("aria-label", "Attach file");
    attachButton.textContent = "📎";
    row.insertBefore(attachButton, input);

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.setAttribute("data-attachment-file-input", "");
    var accept = attachmentAccept(widget);
    if (accept) fileInput.accept = accept;
    composer.appendChild(fileInput);

    attachButton.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      queueFiles(widget, fileInput.files);
      fileInput.value = "";
    });
    input.addEventListener("input", function () {
      state.draft = input.value;
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      composer.addEventListener(eventName, function (event) {
        if (
          !event.dataTransfer ||
          !event.dataTransfer.types ||
          Array.prototype.indexOf.call(event.dataTransfer.types, "Files") < 0
        )
          return;
        event.preventDefault();
        composer.classList.add("cw-attachment-drop");
      });
    });
    ["dragleave", "drop"].forEach(function (eventName) {
      composer.addEventListener(eventName, function (event) {
        composer.classList.remove("cw-attachment-drop");
        if (eventName === "drop") {
          event.preventDefault();
          if (event.dataTransfer && event.dataTransfer.files)
            queueFiles(widget, event.dataTransfer.files);
        }
      });
    });

    var uploading = state.pending.some(function (item) {
      return item.status === "UPLOADING" || item.status === "REMOVING";
    });
    var send = composer.querySelector('[data-action="send"]');
    if (send && uploading) send.disabled = true;
  }

  function installWidgetIntegration() {
    var Widget = global.ChatWidget && global.ChatWidget.Widget;
    if (!Widget || Widget.prototype.__attachmentIntegrationInstalled) return;
    var proto = Widget.prototype;
    proto.__attachmentIntegrationInstalled = true;

    [
      ["renderPrivateList", "conversations"],
      ["renderGroupList", "groups"],
    ].forEach(function (entry) {
      var method = entry[0];
      var collection = entry[1];
      var original = proto[method];
      if (typeof original !== "function") return;
      proto[method] = function () {
        (this[collection] || []).forEach(function (item) {
          if (
            item.lastMessage &&
            !item.lastMessage.content &&
            item.lastMessage.attachmentCount !== 0
          ) {
            item.lastMessage.content = "Sent an attachment";
          }
        });
        return original.apply(this, arguments);
      };
    });

    var originalRenderPanel = proto.renderPanel;
    proto.renderPanel = function () {
      var state = attachmentState(this);
      if (this.panel) {
        var oldInput = this.panel.querySelector("[data-message-input]");
        if (oldInput) state.draft = oldInput.value;
      }
      var result = originalRenderPanel.apply(this, arguments);
      ensureAttachmentStyles(this);
      ensureClient(this);
      enhanceMessages(this);
      enhanceComposer(this);
      bindAttachmentActions(this);
      hydratePreviews(this);
      return result;
    };

    var originalSend = proto.sendCurrentMessage;
    proto.sendCurrentMessage = async function () {
      var state = attachmentState(this);
      if (!state.pending.length) return originalSend.apply(this, arguments);
      if (!this.activeRoom || this.activeRoom.canSend === false) return;
      if (
        state.pending.some(function (item) {
          return item.status === "UPLOADING" || item.status === "REMOVING";
        })
      ) {
        this.toast("Wait until attachment upload is complete");
        return;
      }
      var ready = state.pending.filter(function (item) {
        return item.status === "READY" && item.attachment;
      });
      var failed = state.pending.some(function (item) {
        return item.status === "FAILED" || item.status === "REMOVE_FAILED";
      });
      if (failed) {
        this.toast("Retry or remove failed attachments before sending");
        return;
      }
      var input =
        this.panel && this.panel.querySelector("[data-message-input]");
      var content = input ? input.value.trim() : state.draft.trim();
      if (!content && !ready.length) return;
      if (input) input.value = "";
      state.draft = "";
      this.stopTyping();
      try {
        var options = {
          clientMessageId: uid(),
          replyMessageId: (this.replyTo && this.replyTo.id) || null,
          attachmentIds: ready.map(function (item) {
            return item.attachment.id;
          }),
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
        state.pending = [];
        this.replyTo = null;
        this.appendMessage(message);
        this.refreshLists();
      } catch (error) {
        state.draft = content;
        this.toast(error.message || "Unable to send message");
        this.renderPanel();
      }
    };

    var originalLeave = proto.leaveActiveRoom;
    proto.leaveActiveRoom = function () {
      discardPending(this);
      return originalLeave.apply(this, arguments);
    };

    var originalInstallEvents = proto.installEvents;
    proto.installEvents = function () {
      var result = originalInstallEvents.apply(this, arguments);
      if (this.__attachmentDeletedEventInstalled) return result;
      this.__attachmentDeletedEventInstalled = true;
      this.bind(global, "chatwidget:attachment:deleted", (event) => {
        applyDeleted(this, event.detail || {});
      });
      return result;
    };

    var originalDestroy = proto.destroy;
    proto.destroy = async function () {
      discardPending(this);
      var state = attachmentState(this);
      Object.keys(state.previewCache).forEach((attachmentId) =>
        revokePreview(this, attachmentId),
      );
      if (global.ChatWidgetAttachments.client === this.attachmentClient) {
        global.ChatWidgetAttachments.client = null;
      }
      var result = await originalDestroy.apply(this, arguments);
      this.attachmentClient = null;
      this.__attachmentState = null;
      return result;
    };
  }

  global.ChatWidgetAttachments.installWidgetIntegration =
    installWidgetIntegration;
  installWidgetIntegration();
})(window);
