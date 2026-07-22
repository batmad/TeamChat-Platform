import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { getCurrentSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";

export const GET = withApiHandler(async () => {
  const session = await getCurrentSession();
  if (!session) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  }

  const applications = session.isRoot
    ? []
    : await prisma.userIdentity.findMany({
        where: {
          internalUserId: session.userId,
          source: "INTERNAL",
          isActive: true,
          application: { status: "ACTIVE" },
        },
        select: {
          application: {
            select: { id: true, key: true, name: true },
          },
        },
        orderBy: { application: { name: "asc" } },
      });

  return NextResponse.json({
    success: true,
    data: {
      user: session,
      applications: applications.map(({ application }: { application: { id: string; key: string; name: string } }) => application),
    },
  });
});
