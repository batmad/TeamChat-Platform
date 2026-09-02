import argon2 from "argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { getRequestId } from "@/lib/api/request-id";
import { writeSystemLogSafe } from "@/lib/logs/system-log";
import { createSessionToken } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/cookie";
import { prisma } from "@/lib/db/prisma";
import { resolveIdentityAuthorization } from "@/lib/rbac/authorization";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(512),
  applicationKey: z.string().trim().min(1).max(100).optional(),
});

export const POST = withApiHandler(async (request) => {
  const requestId = getRequestId(request);
  const body = loginSchema.parse(await request.json());

  const user = await prisma.internalUser.findUnique({
    where: { username: body.username },
    include: {
      identities: {
        where: {
          isActive: true,
          source: "INTERNAL",
          application: { status: "ACTIVE" },
        },
        select: {
          id: true,
          applicationId: true,
          application: {
            select: { key: true, name: true },
          },
        },
      },
    },
  });

  const validPassword = user
    ? await argon2.verify(user.passwordHash, body.password).catch(() => false)
    : false;

  if (!user || !user.isActive || !validPassword) {
    await writeSystemLogSafe({
      type: "AUTHENTICATION",
      level: "WARN",
      requestId,
      username: body.username,
      action: "INTERNAL_LOGIN_FAILED",
      message: "Internal login failed",
      metadata: { applicationKey: body.applicationKey ?? null, reason: "INVALID_CREDENTIALS" },
    });
    throw new AppError(401, "INVALID_CREDENTIALS", "Username or password is invalid");
  }

  if (user.isProtectedRoot) {
    const token = await createSessionToken({
      sub: user.id,
      username: user.username,
      name: user.name,
      isRoot: true,
    });

    await prisma.internalUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await setSessionCookie(token);
    await writeSystemLogSafe({
      type: "AUTHENTICATION",
      level: "INFO",
      requestId,
      username: user.username,
      action: "INTERNAL_LOGIN_SUCCESS",
      message: "Protected ROOT login succeeded",
      metadata: { isRoot: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        user: {
          username: user.username,
          name: user.name,
          isRoot: true,
          application: null,
          role: null,
          permissions: ["*"],
        },
      },
    });
  }

  const selectedIdentity = body.applicationKey
    ? user.identities.find((identity: { id: string; applicationId: string; application: { key: string; name: string } }) => identity.application.key === body.applicationKey)
    : user.identities.length === 1
      ? user.identities[0]
      : null;

  if (!selectedIdentity) {
    if (!body.applicationKey && user.identities.length > 1) {
      throw new AppError(409, "APPLICATION_REQUIRED", "Select an application to continue", {
        applications: user.identities.map((identity: { id: string; applicationId: string; application: { key: string; name: string } }) => ({
          key: identity.application.key,
          name: identity.application.name,
        })),
      });
    }

    throw new AppError(403, "APPLICATION_ACCESS_DENIED", "No active application access is available");
  }

  const authorization = await resolveIdentityAuthorization(selectedIdentity.id);
  if (!authorization || authorization.isAccessDisabled) {
    throw new AppError(403, "ACCESS_DISABLED", "User access is disabled");
  }

  const token = await createSessionToken({
    sub: user.id,
    username: user.username,
    name: user.name,
    isRoot: false,
    applicationId: authorization.applicationId,
    userIdentityId: authorization.userIdentityId,
  });

  await prisma.internalUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await setSessionCookie(token);
  await writeSystemLogSafe({
    applicationId: authorization.applicationId,
    type: "AUTHENTICATION",
    level: "INFO",
    requestId,
    username: user.username,
    action: "INTERNAL_LOGIN_SUCCESS",
    message: "Internal application login succeeded",
    metadata: { applicationKey: authorization.applicationKey, roleId: authorization.role?.id ?? null },
  });

  return NextResponse.json({
    success: true,
    data: {
      user: {
        username: user.username,
        name: user.name,
        isRoot: false,
        application: {
          id: authorization.applicationId,
          key: authorization.applicationKey,
          name: authorization.applicationName,
        },
        role: authorization.role,
        permissions: authorization.permissions,
      },
    },
  });
});
