import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { createSessionToken } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/cookie";
import { prisma } from "@/lib/db/prisma";
import { resolveIdentityAuthorization } from "@/lib/rbac/authorization";
import { requireApiSession } from "@/lib/rbac/guards";

const schema = z.object({ applicationKey: z.string().trim().min(1).max(100) });

export const POST = withApiHandler(async (request) => {
  const current = await requireApiSession();
  if (current.isRoot) {
    throw new AppError(400, "ROOT_HAS_GLOBAL_CONTEXT", "ROOT does not require an application context");
  }

  const body = schema.parse(await request.json());
  const identity = await prisma.userIdentity.findFirst({
    where: {
      internalUserId: current.userId,
      source: "INTERNAL",
      isActive: true,
      application: { key: body.applicationKey, status: "ACTIVE" },
    },
    select: { id: true },
  });

  if (!identity) throw new AppError(403, "APPLICATION_ACCESS_DENIED", "Application access is not allowed");

  const authorization = await resolveIdentityAuthorization(identity.id);
  if (!authorization || authorization.isAccessDisabled) {
    throw new AppError(403, "ACCESS_DISABLED", "User access is disabled");
  }

  const token = await createSessionToken({
    sub: current.userId,
    username: current.username,
    name: current.name,
    isRoot: false,
    applicationId: authorization.applicationId,
    userIdentityId: authorization.userIdentityId,
  });
  await setSessionCookie(token);

  return NextResponse.json({
    success: true,
    data: {
      application: {
        id: authorization.applicationId,
        key: authorization.applicationKey,
        name: authorization.applicationName,
      },
      role: authorization.role,
      permissions: authorization.permissions,
    },
  });
});
