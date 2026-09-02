"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/lib/realtime/events";

export type RealtimeClientOptions = {
  realtimeUrl: string;
  accessToken: string;
  path?: string;
  autoConnect?: boolean;
};

export type RealtimeClient = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const socket = io(options.realtimeUrl, {
    path: options.path ?? "/socket.io",
    auth: { token: options.accessToken },
    autoConnect: options.autoConnect ?? true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
    timeout: 20_000,
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  socket.on("presence:ready", ({ heartbeatIntervalMs }) => {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (socket.connected) socket.emit("presence:heartbeat");
    }, heartbeatIntervalMs);
  });
  socket.on("disconnect", stopHeartbeat);

  return socket;
}

export function updateRealtimeAccessToken(socket: RealtimeClient, accessToken: string) {
  socket.auth = { ...(socket.auth as Record<string, unknown>), token: accessToken };
}
