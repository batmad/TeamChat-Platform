import type { GroupMessagePayload } from "@/lib/chat/group-chat";
import type { PrivateMessagePayload } from "@/lib/chat/private-chat";

export type PresenceStatusPayload = {
  userIdentityId: string;
  username: string;
  name: string | null;
  status: "ONLINE" | "OFFLINE";
  connectionCount: number;
  lastSeenAt: string;
};

export type PresenceReadyPayload = {
  socketId: string;
  applicationId: string;
  user: PresenceStatusPayload;
  heartbeatIntervalMs: number;
};

export type RealtimeAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type GroupJoinedPayload = {
  group: { id: string; code: string; name: string };
  room: { id: string; name: string | null };
  unreadCount: number;
};

export type GroupReadPayload = {
  groupId: string;
  roomId: string;
  reader: {
    userIdentityId: string;
    username: string;
    name: string | null;
  };
  readAt: string;
  upToMessageId: string | null;
  markedCount: number;
  unreadCount: number;
  totalNotificationUnread: number;
};

export type GroupTypingPayload = {
  groupId: string;
  roomId: string;
  user: {
    userIdentityId: string;
    username: string;
    name: string | null;
  };
  isTyping: boolean;
  at: string;
};


export type PrivateJoinedPayload = {
  roomId: string;
  participant: {
    userIdentityId: string;
    username: string;
    name: string | null;
  };
  sharedGroupIds: string[];
  canSend: boolean;
  historyAvailable: true;
  unreadCount: number;
};

export type PrivateReadPayload = {
  roomId: string;
  reader: {
    userIdentityId: string;
    username: string;
    name: string | null;
  };
  readAt: string;
  upToMessageId: string | null;
  markedCount: number;
  unreadCount: number;
  totalNotificationUnread: number;
};

export type PrivateTypingPayload = {
  roomId: string;
  user: {
    userIdentityId: string;
    username: string;
    name: string | null;
  };
  isTyping: boolean;
  at: string;
};


export type NotificationNewPayload = {
  recipientUserIdentityId: string;
  notification: {
    id: string;
    type: "MESSAGE";
    title: string;
    body: string | null;
    roomId: string | null;
    messageId: string | null;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  };
  totalUnread: number;
  roomUnread: number;
  shouldPlaySound: boolean;
  shouldShowBrowserNotification: boolean;
  muted: boolean;
};

export type NotificationBadgePayload = {
  totalUnread: number;
  roomId?: string;
  roomUnread?: number;
};

export type ServerToClientEvents = {
  "presence:ready": (payload: PresenceReadyPayload) => void;
  "presence:changed": (payload: PresenceStatusPayload) => void;
  "group:joined": (payload: GroupJoinedPayload) => void;
  "group:left": (payload: { groupId: string; roomId: string }) => void;
  "group:message:new": (payload: GroupMessagePayload) => void;
  "group:messages:read": (payload: GroupReadPayload) => void;
  "group:typing": (payload: GroupTypingPayload) => void;
  "private:joined": (payload: PrivateJoinedPayload) => void;
  "private:left": (payload: { roomId: string }) => void;
  "private:message:new": (payload: PrivateMessagePayload) => void;
  "private:messages:read": (payload: PrivateReadPayload) => void;
  "private:typing": (payload: PrivateTypingPayload) => void;
  "notification:new": (payload: NotificationNewPayload) => void;
  "notification:badge": (payload: NotificationBadgePayload) => void;
  "realtime:error": (payload: { code: string; message: string }) => void;
};

export type ClientToServerEvents = {
  "presence:heartbeat": (ack?: (payload: { serverTime: string }) => void) => void;
  "group:join": (
    payload: { groupId: string },
    ack?: (result: RealtimeAck<GroupJoinedPayload>) => void,
  ) => void;
  "group:leave": (
    payload: { groupId: string },
    ack?: (result: RealtimeAck<{ groupId: string; roomId: string }>) => void,
  ) => void;
  "group:message:send": (
    payload: {
      groupId: string;
      content: string;
      replyMessageId?: string | null;
      clientMessageId?: string | null;
    },
    ack?: (result: RealtimeAck<GroupMessagePayload>) => void,
  ) => void;
  "group:messages:read": (
    payload: { groupId: string; upToMessageId?: string | null },
    ack?: (result: RealtimeAck<GroupReadPayload>) => void,
  ) => void;
  "group:typing:start": (payload: { groupId: string }) => void;
  "group:typing:stop": (payload: { groupId: string }) => void;
  "private:open": (
    payload: { targetUserIdentityId: string },
    ack?: (result: RealtimeAck<PrivateJoinedPayload>) => void,
  ) => void;
  "private:join": (
    payload: { roomId: string },
    ack?: (result: RealtimeAck<PrivateJoinedPayload>) => void,
  ) => void;
  "private:leave": (
    payload: { roomId: string },
    ack?: (result: RealtimeAck<{ roomId: string }>) => void,
  ) => void;
  "private:message:send": (
    payload: {
      roomId: string;
      content: string;
      replyMessageId?: string | null;
      clientMessageId?: string | null;
    },
    ack?: (result: RealtimeAck<PrivateMessagePayload>) => void,
  ) => void;
  "private:messages:read": (
    payload: { roomId: string; upToMessageId?: string | null },
    ack?: (result: RealtimeAck<PrivateReadPayload>) => void,
  ) => void;
  "private:typing:start": (payload: { roomId: string }) => void;
  "private:typing:stop": (payload: { roomId: string }) => void;
};

export type InterServerEvents = Record<string, never>;

export type RealtimeSocketData = {
  userIdentityId: string;
  applicationId: string;
  applicationKey: string;
  username: string;
  displayName: string | null;
  effectiveRoleId: string | null;
  permissions: string[];
  groupIds: string[];
  sessionReference: string;
  lastHeartbeatWriteAt: number;
};
