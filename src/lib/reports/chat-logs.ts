import "server-only";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import type { ChatLogsScope } from "@/lib/reports/chat-logs-scope";
import { ensureRequestedGroupInScope } from "@/lib/reports/chat-logs-scope";

export type ChatLogsChatType = "ALL" | "PRIVATE" | "GROUP";

export type ChatLogsFilters = {
  applicationId: string;
  from?: Date;
  to?: Date;
  groupId?: string | null;
  username?: string | null;
  chatType?: ChatLogsChatType;
};

export type ChatLogsReportRow = {
  id: string;
  timestamp: string;
  chatType: "PRIVATE" | "GROUP";
  roomId: string;
  roomName: string | null;
  groupContexts: Array<{ id: string; code: string; name: string }>;
  senderUsername: string;
  senderName: string | null;
  participants: Array<{ userIdentityId: string; username: string; name: string | null }>;
  message: string;
  replyTo: { id: string; senderUsername: string; senderName: string | null; content: string } | null;
};


type RawReportMessage = {
  id: string;
  createdAt: Date;
  senderUsername: string;
  senderName: string | null;
  content: string;
  room: {
    id: string;
    type: "PRIVATE" | "GROUP";
    name: string | null;
    group: { id: string; code: string; name: string } | null;
    members: Array<{ userIdentityId: string; usernameSnapshot: string; displayNameSnapshot: string | null }>;
  };
  groupContexts: Array<{ group: { id: string; code: string; name: string } }>;
  replyTo: { id: string; senderUsername: string; senderName: string | null; content: string } | null;
};

const rowSelect = {
  id: true,
  createdAt: true,
  senderUsername: true,
  senderName: true,
  content: true,
  room: {
    select: {
      id: true,
      type: true,
      name: true,
      group: { select: { id: true, code: true, name: true } },
      members: {
        where: { isActive: true },
        select: {
          userIdentityId: true,
          usernameSnapshot: true,
          displayNameSnapshot: true,
        },
      },
    },
  },
  groupContexts: {
    select: { group: { select: { id: true, code: true, name: true } } },
    orderBy: { group: { name: "asc" as const } },
  },
  replyTo: {
    select: {
      id: true,
      senderUsername: true,
      senderName: true,
      content: true,
    },
  },
} as const;

function buildWhere(filters: ChatLogsFilters, scope: ChatLogsScope) {
  ensureRequestedGroupInScope(scope, filters.groupId);
  const allowedGroupIds = scope.allowedGroups.map((group) => group.id);

  const scopeCondition = scope.unrestricted
    ? {}
    : {
        OR: [
          { room: { type: "GROUP" as const, groupId: { in: allowedGroupIds.length ? allowedGroupIds : ["__none__"] } } },
          { room: { type: "PRIVATE" as const }, groupContexts: { some: { groupId: { in: allowedGroupIds.length ? allowedGroupIds : ["__none__"] } } } },
        ],
      };

  const groupCondition = filters.groupId
    ? {
        OR: [
          { room: { type: "GROUP" as const, groupId: filters.groupId } },
          { room: { type: "PRIVATE" as const }, groupContexts: { some: { groupId: filters.groupId } } },
        ],
      }
    : {};

  const scopeAndGroupConditions = [
    ...(scope.unrestricted ? [] : [scopeCondition]),
    ...(filters.groupId ? [groupCondition] : []),
  ];

  return {
    applicationId: filters.applicationId,
    deletedAt: null,
    ...(filters.chatType && filters.chatType !== "ALL" ? { room: { type: filters.chatType } } : {}),
    ...(filters.username ? { senderUsername: { equals: filters.username, mode: "insensitive" as const } } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
    ...(scopeAndGroupConditions.length ? { AND: scopeAndGroupConditions } : {}),
  };
}

function mapRow(message: RawReportMessage): ChatLogsReportRow {
  const contexts = message.groupContexts.map((entry) => entry.group);
  if (message.room.type === "GROUP" && message.room.group && !contexts.some((group) => group.id === message.room.group?.id)) {
    contexts.unshift(message.room.group);
  }
  return {
    id: message.id,
    timestamp: message.createdAt.toISOString(),
    chatType: message.room.type,
    roomId: message.room.id,
    roomName: message.room.name,
    groupContexts: contexts,
    senderUsername: message.senderUsername,
    senderName: message.senderName,
    participants: message.room.members.map((member) => ({
      userIdentityId: member.userIdentityId,
      username: member.usernameSnapshot,
      name: member.displayNameSnapshot,
    })),
    message: message.content,
    replyTo: message.replyTo,
  };
}

export async function queryChatLogsReport(input: {
  filters: ChatLogsFilters;
  scope: ChatLogsScope;
  cursor?: string | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const where = buildWhere(input.filters, input.scope);
  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: rowSelect,
    }),
    prisma.message.count({ where }),
  ]);
  const hasMore = messages.length > limit;
  const page = messages.slice(0, limit);
  return {
    rows: page.map(mapRow),
    total,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function collectChatLogsReport(input: {
  filters: ChatLogsFilters;
  scope: ChatLogsScope;
  maxRows?: number;
}) {
  const maxRows = input.maxRows ?? 50000;
  const where = buildWhere(input.filters, input.scope);
  const messages = await prisma.message.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: maxRows + 1,
    select: rowSelect,
  });
  if (messages.length > maxRows) {
    throw new AppError(413, "REPORT_EXPORT_LIMIT_EXCEEDED", `Report export is limited to ${maxRows} rows`);
  }
  return messages.map(mapRow);
}
