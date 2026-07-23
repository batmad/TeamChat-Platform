import { jwtVerify, SignJWT } from "jose";
import { getServerEnv } from "@/lib/env/server";

export const CHAT_SESSION_AUDIENCE = "chat-widget-session";

export type ChatSessionPayload = {
  sub: string;
  applicationId: string;
  applicationKey: string;
  username: string;
  sessionReference: string;
};

function chatSessionKey() {
  const env = getServerEnv();
  return new TextEncoder().encode(
    env.CHAT_SESSION_SECRET ?? env.SESSION_SECRET,
  );
}

export async function createChatSessionToken(payload: ChatSessionPayload) {
  const env = getServerEnv();
  return new SignJWT({
    applicationId: payload.applicationId,
    applicationKey: payload.applicationKey,
    username: payload.username,
    sessionReference: payload.sessionReference,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuer("central-syscca-teamchat-platform")
    .setAudience(CHAT_SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.CHAT_SESSION_TTL_SECONDS}s`)
    .sign(chatSessionKey());
}

export async function verifyChatSessionToken(
  token: string,
): Promise<ChatSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, chatSessionKey(), {
      algorithms: ["HS256"],
      issuer: "central-syscca-teamchat-platform",
      audience: CHAT_SESSION_AUDIENCE,
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.applicationId !== "string" ||
      typeof payload.applicationKey !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.sessionReference !== "string"
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      applicationId: payload.applicationId,
      applicationKey: payload.applicationKey,
      username: payload.username,
      sessionReference: payload.sessionReference,
    };
  } catch {
    return null;
  }
}

export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}
