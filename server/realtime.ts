import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { getServerEnv } from "../src/lib/env/server";
import { logger } from "../src/lib/logger/logger";
import { writeSystemLogSafe } from "../src/lib/logs/system-log";
import {
  cleanupExpiredOfflinePresence,
  decrementPresenceConnection,
  markPresenceConnected,
  markPresenceOfflineIfDisconnected,
  resetOnlinePresenceOnRealtimeStartup,
  touchPresence,
} from "../src/lib/presence/service";
import {
  DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_MS,
  DEFAULT_PRESENCE_OFFLINE_GRACE_MS,
} from "../src/lib/presence/rules";
import { authenticateRealtimeSocket } from "../src/lib/realtime/auth";
import { SlidingWindowRateLimiter } from "../src/lib/security/sliding-window-rate-limiter";
import {
  groupMessagePayloadSchema,
  groupReadPayloadSchema,
  groupReferencePayloadSchema,
  parseRealtimePayload,
  privateMessagePayloadSchema,
  privateReadPayloadSchema,
  privateRoomPayloadSchema,
  privateTargetPayloadSchema,
  RealtimePayloadError,
} from "../src/lib/realtime/validation";
import {
  ensureGroupRoom,
  joinGroupChat,
  markGroupMessagesRead,
  realtimeRoomName,
  sendGroupMessage,
} from "../src/lib/chat/group-chat";
import {
  GroupChatAccessError,
  requireGroupAccess,
  requireGroupChatActor,
} from "../src/lib/chat/group-access";
import { PrivateChatAccessError } from "../src/lib/chat/private-access";
import {
  getPrivateTypingContext,
  joinPrivateConversation,
  markPrivateMessagesRead,
  openPrivateConversation,
  privateRealtimeRoomName,
  sendPrivateMessage,
} from "../src/lib/chat/private-chat";
import type {
  ClientToServerEvents,
  InterServerEvents,
  RealtimeSocketData,
  ServerToClientEvents,
} from "../src/lib/realtime/events";
import {
  createGroupMessageNotifications,
  createPrivateMessageNotifications,
  getNotificationSummary,
} from "../src/lib/notifications/service";

const env = getServerEnv();
const port = env.REALTIME_PORT;
const host = env.REALTIME_HOST;
const path = env.REALTIME_PATH;
const heartbeatIntervalMs =
  env.REALTIME_HEARTBEAT_INTERVAL_MS ?? DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_MS;
const offlineGraceMs =
  env.REALTIME_OFFLINE_GRACE_MS ?? DEFAULT_PRESENCE_OFFLINE_GRACE_MS;
const cleanupIntervalMs = env.PRESENCE_CLEANUP_INTERVAL_MS;
const messageRateLimiter = new SlidingWindowRateLimiter({
  windowMs: env.REALTIME_MESSAGE_RATE_LIMIT_WINDOW_MS,
  maxEvents: env.REALTIME_MESSAGE_RATE_LIMIT_MAX,
});

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "realtime",
        time: new Date().toISOString(),
      }),
    );
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, code: "NOT_FOUND" }));
});

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  RealtimeSocketData
>(httpServer, {
  path,
  cors: {
    origin: (_origin, callback) => callback(null, true),
    methods: ["GET", "POST"],
    credentials: false,
  },
  pingInterval: env.REALTIME_PING_INTERVAL_MS,
  pingTimeout: env.REALTIME_PING_TIMEOUT_MS,
  connectionStateRecovery: {
    maxDisconnectionDuration: env.REALTIME_CONNECTION_RECOVERY_MS,
    skipMiddlewares: false,
  },
});

const offlineTimers = new Map<string, NodeJS.Timeout>();

function applicationRoom(applicationId: string) {
  return `application:${applicationId}`;
}

function userRoom(userIdentityId: string) {
  return `user:${userIdentityId}`;
}

function groupError(error: unknown) {
  if (error instanceof RealtimePayloadError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof GroupChatAccessError) {
    return { code: error.code, message: error.message };
  }
  logger.error({ error }, "Unhandled realtime group chat error");
  return {
    code: "GROUP_CHAT_INTERNAL_ERROR",
    message: "Unable to process group chat request",
  };
}

function privateError(error: unknown) {
  if (error instanceof RealtimePayloadError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof PrivateChatAccessError) {
    return { code: error.code, message: error.message };
  }
  logger.error({ error }, "Unhandled realtime private chat error");
  return {
    code: "PRIVATE_CHAT_INTERNAL_ERROR",
    message: "Unable to process private chat request",
  };
}

function enforceMessageRateLimit(userIdentityId: string) {
  const result = messageRateLimiter.consume(userIdentityId);
  if (result.allowed) return null;
  return {
    code: "RATE_LIMITED",
    message: `Too many messages. Retry in ${Math.ceil(result.retryAfterMs / 1000)} second(s).`,
  };
}

function clearOfflineTimer(userIdentityId: string) {
  const timer = offlineTimers.get(userIdentityId);
  if (timer) clearTimeout(timer);
  offlineTimers.delete(userIdentityId);
}

function scheduleOffline(user: RealtimeSocketData) {
  clearOfflineTimer(user.userIdentityId);
  const timer = setTimeout(async () => {
    offlineTimers.delete(user.userIdentityId);
    try {
      const presence = await markPresenceOfflineIfDisconnected(
        user.userIdentityId,
      );
      if (!presence) return;

      io.to(applicationRoom(user.applicationId)).emit("presence:changed", {
        userIdentityId: user.userIdentityId,
        username: user.username,
        name: user.displayName,
        status: "OFFLINE",
        connectionCount: 0,
        lastSeenAt: (presence.lastSeenAt ?? new Date()).toISOString(),
      });
      void writeSystemLogSafe({
        applicationId: user.applicationId,
        type: "USER_ACTIVITY",
        level: "INFO",
        username: user.username,
        action: "REALTIME_DISCONNECTED",
        message: "Realtime user became offline",
        metadata: { userIdentityId: user.userIdentityId },
      });
    } catch (error) {
      logger.error(
        { error, userIdentityId: user.userIdentityId },
        "Failed to mark disconnected user offline",
      );
    }
  }, offlineGraceMs);
  timer.unref();
  offlineTimers.set(user.userIdentityId, timer);
}

io.use(async (socket, next) => {
  try {
    socket.data = await authenticateRealtimeSocket(socket);
    next();
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "REALTIME_AUTH_FAILED";
    logger.warn(
      { code, socketId: socket.id, origin: socket.handshake.headers.origin },
      "Realtime socket authentication rejected",
    );
    void writeSystemLogSafe({
      type: "AUTHENTICATION",
      level: "WARN",
      action: "REALTIME_AUTH_FAILED",
      message: "Realtime socket authentication rejected",
      metadata: {
        code,
        socketId: socket.id,
        origin: socket.handshake.headers.origin ?? null,
      },
    });
    next(new Error(code));
  }
});

io.on("connection", async (socket) => {
  const user = socket.data;
  clearOfflineTimer(user.userIdentityId);

  try {
    const presence = await markPresenceConnected({
      userIdentityId: user.userIdentityId,
      effectiveRoleId: user.effectiveRoleId,
      sessionReference: user.sessionReference,
      metadata: {
        authMethod: "CHAT_SESSION",
        realtimeSocketId: socket.id,
      },
    });

    await socket.join(applicationRoom(user.applicationId));
    await socket.join(userRoom(user.userIdentityId));

    const payload = {
      userIdentityId: user.userIdentityId,
      username: user.username,
      name: user.displayName,
      status: "ONLINE" as const,
      connectionCount: presence.connectionCount,
      lastSeenAt: (presence.lastSeenAt ?? new Date()).toISOString(),
    };

    socket.emit("presence:ready", {
      socketId: socket.id,
      applicationId: user.applicationId,
      user: payload,
      heartbeatIntervalMs,
    });
    const notificationSummary = await getNotificationSummary(
      user.userIdentityId,
    );
    socket.emit("notification:badge", {
      totalUnread: notificationSummary.totalUnread,
    });
    io.to(applicationRoom(user.applicationId)).emit(
      "presence:changed",
      payload,
    );

    logger.info(
      {
        socketId: socket.id,
        userIdentityId: user.userIdentityId,
        applicationId: user.applicationId,
        connectionCount: presence.connectionCount,
        recovered: socket.recovered,
      },
      "Realtime client connected",
    );
    void writeSystemLogSafe({
      applicationId: user.applicationId,
      type: "USER_ACTIVITY",
      level: "INFO",
      username: user.username,
      action: "REALTIME_CONNECTED",
      message: "Realtime client connected",
      metadata: {
        userIdentityId: user.userIdentityId,
        socketId: socket.id,
        connectionCount: presence.connectionCount,
        recovered: socket.recovered,
      },
    });
  } catch (error) {
    logger.error(
      { error, socketId: socket.id, userIdentityId: user.userIdentityId },
      "Failed to initialize realtime presence",
    );
    void writeSystemLogSafe({
      applicationId: user.applicationId,
      type: "ERROR",
      level: "ERROR",
      username: user.username,
      action: "REALTIME_PRESENCE_CONNECT_FAILED",
      message: "Failed to initialize realtime presence",
      metadata: {
        error,
        socketId: socket.id,
        userIdentityId: user.userIdentityId,
      },
    });
    socket.emit("realtime:error", {
      code: "PRESENCE_CONNECT_FAILED",
      message: "Unable to initialize realtime session",
    });
    socket.disconnect(true);
    return;
  }

  socket.on("presence:heartbeat", async (ack) => {
    const now = Date.now();
    if (
      now - socket.data.lastHeartbeatWriteAt >=
      Math.max(5_000, heartbeatIntervalMs - 5_000)
    ) {
      socket.data.lastHeartbeatWriteAt = now;
      try {
        await touchPresence(socket.data.userIdentityId);
      } catch (error) {
        logger.warn(
          { error, userIdentityId: socket.data.userIdentityId },
          "Failed to persist realtime heartbeat",
        );
      }
    }
    ack?.({ serverTime: new Date().toISOString() });
  });

  socket.on("group:join", async (rawPayload, ack) => {
    try {
      const { groupId } = parseRealtimePayload(
        groupReferencePayloadSchema,
        rawPayload,
      );
      const joined = await joinGroupChat(socket.data.userIdentityId, groupId);
      const roomName = realtimeRoomName(joined.room.id);
      await socket.join(roomName);
      const payload = {
        group: {
          id: joined.group.id,
          code: joined.group.code,
          name: joined.group.name,
        },
        room: { id: joined.room.id, name: joined.room.name },
        unreadCount: joined.unreadCount,
      };
      socket.emit("group:joined", payload);
      ack?.({ ok: true, data: payload });
    } catch (error) {
      const normalized = groupError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  socket.on("group:leave", async (rawPayload, ack) => {
    try {
      const { groupId } = parseRealtimePayload(
        groupReferencePayloadSchema,
        rawPayload,
      );
      const actor = await requireGroupChatActor(socket.data.userIdentityId);
      const group = await requireGroupAccess(actor, groupId);
      const room = await ensureGroupRoom(actor.applicationId, group);
      await socket.leave(realtimeRoomName(room.id));
      const payload = { groupId: group.id, roomId: room.id };
      socket.emit("group:left", payload);
      ack?.({ ok: true, data: payload });
    } catch (error) {
      const normalized = groupError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  socket.on("group:message:send", async (rawPayload, ack) => {
    try {
      const payload = parseRealtimePayload(
        groupMessagePayloadSchema,
        rawPayload,
      );
      const rateLimitError = enforceMessageRateLimit(
        socket.data.userIdentityId,
      );
      if (rateLimitError) {
        ack?.({ ok: false, error: rateLimitError });
        socket.emit("realtime:error", rateLimitError);
        return;
      }
      const message = await sendGroupMessage({
        userIdentityId: socket.data.userIdentityId,
        groupId: payload.groupId,
        content: payload.content,
        replyMessageId: payload.replyMessageId,
        clientMessageId: payload.clientMessageId,
      });
      const roomName = realtimeRoomName(message.roomId);
      await socket.join(roomName);
      const broadcastMessage = { ...message, isReadByCurrentUser: undefined };
      socket.to(roomName).emit("group:message:new", broadcastMessage);
      try {
        const notifications = await createGroupMessageNotifications({
          applicationId: message.applicationId,
          groupId: message.groupId,
          roomId: message.roomId,
          messageId: message.id,
          senderUserIdentityId: socket.data.userIdentityId,
          senderUsername: message.sender.username,
          senderName: message.sender.name,
          content: message.content,
        });
        for (const notification of notifications) {
          io.to(userRoom(notification.recipientUserIdentityId)).emit(
            "notification:new",
            notification,
          );
        }
      } catch (notificationError) {
        logger.error(
          { notificationError, messageId: message.id },
          "Failed to dispatch group message notifications",
        );
      }
      ack?.({ ok: true, data: message });
    } catch (error) {
      const normalized = groupError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  socket.on("group:messages:read", async (rawPayload, ack) => {
    try {
      const payload = parseRealtimePayload(groupReadPayloadSchema, rawPayload);
      const result = await markGroupMessagesRead({
        userIdentityId: socket.data.userIdentityId,
        groupId: payload.groupId,
        upToMessageId: payload.upToMessageId,
      });
      const event = {
        groupId: result.group.id,
        roomId: result.room.id,
        reader: result.reader,
        readAt: result.readAt,
        upToMessageId: result.upToMessageId,
        markedCount: result.markedCount,
        unreadCount: result.unreadCount,
        totalNotificationUnread: result.totalNotificationUnread,
      };
      io.to(realtimeRoomName(result.room.id)).emit(
        "group:messages:read",
        event,
      );
      io.to(userRoom(socket.data.userIdentityId)).emit("notification:badge", {
        totalUnread: result.totalNotificationUnread,
        roomId: result.room.id,
        roomUnread: result.unreadCount,
      });
      ack?.({ ok: true, data: event });
    } catch (error) {
      const normalized = groupError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  async function broadcastTyping(groupId: string, isTyping: boolean) {
    try {
      const actor = await requireGroupChatActor(socket.data.userIdentityId);
      const group = await requireGroupAccess(actor, groupId);
      const room = await ensureGroupRoom(actor.applicationId, group);
      const roomName = realtimeRoomName(room.id);
      if (!socket.rooms.has(roomName)) return;
      socket.to(roomName).emit("group:typing", {
        groupId: group.id,
        roomId: room.id,
        user: {
          userIdentityId: actor.userIdentityId,
          username: actor.username,
          name: actor.displayName,
        },
        isTyping,
        at: new Date().toISOString(),
      });
    } catch (error) {
      socket.emit("realtime:error", groupError(error));
    }
  }

  socket.on("group:typing:start", (rawPayload) => {
    try {
      const { groupId } = parseRealtimePayload(
        groupReferencePayloadSchema,
        rawPayload,
      );
      void broadcastTyping(groupId, true);
    } catch (error) {
      socket.emit("realtime:error", groupError(error));
    }
  });
  socket.on("group:typing:stop", (rawPayload) => {
    try {
      const { groupId } = parseRealtimePayload(
        groupReferencePayloadSchema,
        rawPayload,
      );
      void broadcastTyping(groupId, false);
    } catch (error) {
      socket.emit("realtime:error", groupError(error));
    }
  });

  function privateJoinedPayload(
    joined: Awaited<ReturnType<typeof joinPrivateConversation>>,
  ) {
    return {
      roomId: joined.room.id,
      participant: joined.participant,
      sharedGroupIds: joined.access.sharedGroupIds,
      canSend: joined.access.canSend,
      historyAvailable: true as const,
      unreadCount: joined.unreadCount,
    };
  }

  socket.on("private:open", async (rawPayload, ack) => {
    try {
      const { targetUserIdentityId } = parseRealtimePayload(
        privateTargetPayloadSchema,
        rawPayload,
      );
      const opened = await openPrivateConversation({
        userIdentityId: socket.data.userIdentityId,
        targetUserIdentityId,
      });
      const joined = await joinPrivateConversation(
        socket.data.userIdentityId,
        opened.room.id,
      );
      await socket.join(privateRealtimeRoomName(opened.room.id));
      const payload = privateJoinedPayload(joined);
      socket.emit("private:joined", payload);
      ack?.({ ok: true, data: payload });
    } catch (error) {
      const normalized = privateError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  socket.on("private:join", async (rawPayload, ack) => {
    try {
      const { roomId } = parseRealtimePayload(
        privateRoomPayloadSchema,
        rawPayload,
      );
      const joined = await joinPrivateConversation(
        socket.data.userIdentityId,
        roomId,
      );
      await socket.join(privateRealtimeRoomName(joined.room.id));
      const payload = privateJoinedPayload(joined);
      socket.emit("private:joined", payload);
      ack?.({ ok: true, data: payload });
    } catch (error) {
      const normalized = privateError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  socket.on("private:leave", async (rawPayload, ack) => {
    try {
      const { roomId } = parseRealtimePayload(
        privateRoomPayloadSchema,
        rawPayload,
      );
      const joined = await joinPrivateConversation(
        socket.data.userIdentityId,
        roomId,
      );
      await socket.leave(privateRealtimeRoomName(joined.room.id));
      const payload = { roomId: joined.room.id };
      socket.emit("private:left", payload);
      ack?.({ ok: true, data: payload });
    } catch (error) {
      const normalized = privateError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  socket.on("private:message:send", async (rawPayload, ack) => {
    try {
      const payload = parseRealtimePayload(
        privateMessagePayloadSchema,
        rawPayload,
      );
      const rateLimitError = enforceMessageRateLimit(
        socket.data.userIdentityId,
      );
      if (rateLimitError) {
        ack?.({ ok: false, error: rateLimitError });
        socket.emit("realtime:error", rateLimitError);
        return;
      }
      const joined = await joinPrivateConversation(
        socket.data.userIdentityId,
        payload.roomId,
      );
      const message = await sendPrivateMessage({
        userIdentityId: socket.data.userIdentityId,
        roomId: payload.roomId,
        content: payload.content,
        replyMessageId: payload.replyMessageId,
        clientMessageId: payload.clientMessageId,
      });
      await socket.join(privateRealtimeRoomName(message.roomId));
      const broadcastMessage = { ...message, isReadByCurrentUser: undefined };
      io.to(userRoom(joined.participant.userIdentityId)).emit(
        "private:message:new",
        broadcastMessage,
      );
      socket
        .to(userRoom(socket.data.userIdentityId))
        .emit("private:message:new", broadcastMessage);
      try {
        const notifications = await createPrivateMessageNotifications({
          applicationId: message.applicationId,
          roomId: message.roomId,
          messageId: message.id,
          senderUserIdentityId: socket.data.userIdentityId,
          senderUsername: message.sender.username,
          senderName: message.sender.name,
          content: message.content,
        });
        for (const notification of notifications) {
          io.to(userRoom(notification.recipientUserIdentityId)).emit(
            "notification:new",
            notification,
          );
        }
      } catch (notificationError) {
        logger.error(
          { notificationError, messageId: message.id },
          "Failed to dispatch private message notifications",
        );
      }
      ack?.({ ok: true, data: message });
    } catch (error) {
      const normalized = privateError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  socket.on("private:messages:read", async (rawPayload, ack) => {
    try {
      const payload = parseRealtimePayload(
        privateReadPayloadSchema,
        rawPayload,
      );
      const joined = await joinPrivateConversation(
        socket.data.userIdentityId,
        payload.roomId,
      );
      const result = await markPrivateMessagesRead({
        userIdentityId: socket.data.userIdentityId,
        roomId: payload.roomId,
        upToMessageId: payload.upToMessageId,
      });
      const event = result;
      io.to(userRoom(joined.participant.userIdentityId)).emit(
        "private:messages:read",
        event,
      );
      socket
        .to(userRoom(socket.data.userIdentityId))
        .emit("private:messages:read", event);
      io.to(userRoom(socket.data.userIdentityId)).emit("notification:badge", {
        totalUnread: result.totalNotificationUnread,
        roomId: result.roomId,
        roomUnread: result.unreadCount,
      });
      ack?.({ ok: true, data: event });
    } catch (error) {
      const normalized = privateError(error);
      ack?.({ ok: false, error: normalized });
      socket.emit("realtime:error", normalized);
    }
  });

  async function broadcastPrivateTyping(roomId: string, isTyping: boolean) {
    try {
      const context = await getPrivateTypingContext(
        socket.data.userIdentityId,
        roomId,
      );
      const roomName = privateRealtimeRoomName(context.room.id);
      if (!socket.rooms.has(roomName)) return;
      socket.to(roomName).emit("private:typing", {
        roomId: context.room.id,
        user: {
          userIdentityId: context.actor.userIdentityId,
          username: context.actor.username,
          name: context.actor.displayName,
        },
        isTyping,
        at: new Date().toISOString(),
      });
    } catch (error) {
      socket.emit("realtime:error", privateError(error));
    }
  }

  socket.on("private:typing:start", (rawPayload) => {
    try {
      const { roomId } = parseRealtimePayload(
        privateRoomPayloadSchema,
        rawPayload,
      );
      void broadcastPrivateTyping(roomId, true);
    } catch (error) {
      socket.emit("realtime:error", privateError(error));
    }
  });
  socket.on("private:typing:stop", (rawPayload) => {
    try {
      const { roomId } = parseRealtimePayload(
        privateRoomPayloadSchema,
        rawPayload,
      );
      void broadcastPrivateTyping(roomId, false);
    } catch (error) {
      socket.emit("realtime:error", privateError(error));
    }
  });

  socket.on("disconnect", async (reason) => {
    try {
      const presence = await decrementPresenceConnection(
        socket.data.userIdentityId,
      );
      logger.info(
        {
          socketId: socket.id,
          userIdentityId: socket.data.userIdentityId,
          applicationId: socket.data.applicationId,
          reason,
          connectionCount: presence?.connectionCount ?? 0,
        },
        "Realtime client disconnected",
      );

      if (!presence || presence.connectionCount <= 0)
        scheduleOffline(socket.data);
    } catch (error) {
      logger.error(
        {
          error,
          socketId: socket.id,
          userIdentityId: socket.data.userIdentityId,
        },
        "Failed to update presence after disconnect",
      );
      scheduleOffline(socket.data);
    }
  });
});

async function runCleanup() {
  try {
    messageRateLimiter.prune();
    await cleanupExpiredOfflinePresence();
  } catch (error) {
    logger.error({ error }, "Presence cleanup job failed");
  }
}

async function bootstrap() {
  await resetOnlinePresenceOnRealtimeStartup();
  await runCleanup();

  const cleanupTimer = setInterval(runCleanup, cleanupIntervalMs);
  cleanupTimer.unref();

  httpServer.listen(port, host, () => {
    logger.info({ host, port, path }, "Realtime Socket.IO server started");
  });
}

async function shutdown(signal: string) {
  logger.info({ signal }, "Realtime server shutting down");
  for (const timer of offlineTimers.values()) clearTimeout(timer);
  offlineTimers.clear();
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

bootstrap().catch((error) => {
  logger.fatal({ error }, "Unable to start realtime server");
  process.exit(1);
});
