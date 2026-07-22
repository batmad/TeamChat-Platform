import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/session";
import { resolveIdentityAuthorization, type EffectiveRole } from "@/lib/rbac/authorization";

export type CurrentSession = {
  userId: string;
  username: string;
  name: string;
  isRoot: boolean;
  applicationId: string | null;
  applicationKey: string | null;
  applicationName: string | null;
  userIdentityId: string | null;
  role: EffectiveRole | null;
  permissions: string[];
};

export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.internalUser.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      username: true,
      name: true,
      isProtectedRoot: true,
      isActive: true,
    },
  });

  if (!user?.isActive) return null;

  if (user.isProtectedRoot) {
    return {
      userId: user.id,
      username: user.username,
      name: user.name,
      isRoot: true,
      applicationId: null,
      applicationKey: null,
      applicationName: null,
      userIdentityId: null,
      role: null,
      permissions: ["*"],
    };
  }

  if (!payload.userIdentityId || !payload.applicationId) return null;

  const authorization = await resolveIdentityAuthorization(payload.userIdentityId);
  if (
    !authorization ||
    authorization.applicationId !== payload.applicationId ||
    authorization.isAccessDisabled
  ) {
    return null;
  }

  const identityOwner = await prisma.userIdentity.findUnique({
    where: { id: payload.userIdentityId },
    select: { internalUserId: true },
  });

  if (identityOwner?.internalUserId !== user.id) return null;

  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    isRoot: false,
    applicationId: authorization.applicationId,
    applicationKey: authorization.applicationKey,
    applicationName: authorization.applicationName,
    userIdentityId: authorization.userIdentityId,
    role: authorization.role,
    permissions: authorization.permissions,
  };
});

export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}
