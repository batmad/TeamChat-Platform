import "server-only";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { resolveEffectiveUser } from "@/lib/users/effective-user";
import { getBearerToken, verifyChatSessionToken } from "@/lib/widget-auth/chat-session";
import { assertWidgetOriginAllowed } from "@/lib/widget-auth/origin";

export async function requireChatSession(request: Request) {
  const token = getBearerToken(request);
  if (!token) throw new AppError(401, "CHAT_SESSION_REQUIRED", "Chat session token is required");

  const payload = await verifyChatSessionToken(token);
  if (!payload) throw new AppError(401, "CHAT_SESSION_INVALID", "Chat session token is invalid or expired");

  const effectiveUser = await resolveEffectiveUser(payload.sub);
  const authorization = effectiveUser;
  if (
    !authorization ||
    authorization.isAccessDisabled ||
    authorization.applicationId !== payload.applicationId ||
    authorization.applicationKey !== payload.applicationKey ||
    authorization.username !== payload.username
  ) {
    throw new AppError(401, "CHAT_SESSION_REVOKED", "Chat session is no longer authorized");
  }

  const application = await prisma.application.findUnique({
    where: { id: authorization.applicationId },
    select: { allowedOrigins: true },
  });
  if (!application) throw new AppError(401, "CHAT_APPLICATION_INVALID", "Chat application is unavailable");
  assertWidgetOriginAllowed(application.allowedOrigins, request.headers.get("origin"));

  const groups = effectiveUser.groups;

  return {
    token: payload,
    authorization,
    groups,
  };
}
