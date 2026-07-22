import { SignJWT, jwtVerify } from "jose";
import { getServerEnv } from "@/lib/env/server";

export type SessionPayload = {
  sub: string;
  username: string;
  name: string;
  isRoot: boolean;
  applicationId?: string;
  userIdentityId?: string;
};

function getSecretKey() {
  return new TextEncoder().encode(getServerEnv().SESSION_SECRET);
}

export async function createSessionToken(payload: SessionPayload) {
  const { SESSION_TTL_SECONDS } = getServerEnv();

  return new SignJWT({
    username: payload.username,
    name: payload.name,
    isRoot: payload.isRoot,
    applicationId: payload.applicationId,
    userIdentityId: payload.userIdentityId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });

    if (
      !payload.sub ||
      typeof payload.username !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.isRoot !== "boolean"
    ) {
      return null;
    }

    if (payload.applicationId !== undefined && typeof payload.applicationId !== "string") {
      return null;
    }

    if (payload.userIdentityId !== undefined && typeof payload.userIdentityId !== "string") {
      return null;
    }

    return {
      sub: payload.sub,
      username: payload.username,
      name: payload.name,
      isRoot: payload.isRoot,
      applicationId: payload.applicationId,
      userIdentityId: payload.userIdentityId,
    };
  } catch {
    return null;
  }
}
