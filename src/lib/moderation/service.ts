import { prisma } from "@/lib/db/prisma";
import { findForbiddenMatches } from "@/lib/moderation/rules";

export type MessageModerationInput = {
  applicationId: string;
  userIdentityId: string | null;
  username: string;
  userName: string | null;
  roomId: string;
  roomType: "GROUP" | "PRIVATE";
  groupId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
};

export type MessageModerationResult =
  | { allowed: true }
  | { allowed: false; code: "FORBIDDEN_CONTENT"; message: string; violationLogId: string };

export async function moderateOutgoingMessage(input: MessageModerationInput): Promise<MessageModerationResult> {
  const rules = await prisma.forbiddenWord.findMany({
    where: {
      isActive: true,
      OR: [
        { scope: "GLOBAL", applicationId: null, groupId: null },
        { scope: "APPLICATION", applicationId: input.applicationId, groupId: null },
        ...(input.roomType === "GROUP" && input.groupId
          ? [{ scope: "GROUP" as const, applicationId: input.applicationId, groupId: input.groupId }]
          : []),
      ],
    },
    select: { id: true, scope: true, pattern: true, normalizedPattern: true, matchMode: true },
  });

  const matches = findForbiddenMatches(input.content, rules);
  if (matches.length === 0) return { allowed: true };

  const primary = matches[0];
  const violation = await prisma.contentViolationLog.create({
    data: {
      applicationId: input.applicationId,
      userIdentityId: input.userIdentityId,
      username: input.username,
      userName: input.userName,
      roomId: input.roomId,
      roomType: input.roomType,
      groupId: input.roomType === "GROUP" ? input.groupId ?? null : null,
      forbiddenWordId: primary.id,
      matchedText: primary.matchedText,
      attemptedMessage: input.content,
      status: "BLOCKED",
      metadata: {
        ...(input.metadata ?? {}),
        matchedRuleCount: matches.length,
        matches: matches.map((match) => ({
          ruleId: match.id,
          scope: match.scope,
          matchMode: match.matchMode,
          matchedText: match.matchedText,
        })),
      },
    },
    select: { id: true },
  });

  return {
    allowed: false,
    code: "FORBIDDEN_CONTENT",
    message: "Pesan tidak dapat dikirim karena mengandung teks yang dibatasi.",
    violationLogId: violation.id,
  };
}
