import { SignJWT } from "jose";

export const WIDGET_BOOTSTRAP_AUDIENCE = "chat-widget-bootstrap";

function signingKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function signWidgetBootstrapToken(input: {
  applicationKey: string;
  userIdentifier: string;
  keyId: string;
  secret: string;
  ttlSeconds?: number;
  now?: number;
}) {
  const ttlSeconds = input.ttlSeconds ?? 120;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Bootstrap token TTL must be a positive integer");
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ app: input.applicationKey })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: input.keyId })
    .setSubject(input.userIdentifier)
    .setIssuer(input.applicationKey)
    .setAudience(WIDGET_BOOTSTRAP_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(signingKey(input.secret));
}
