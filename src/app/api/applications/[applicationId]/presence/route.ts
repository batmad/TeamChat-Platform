import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string }> };

const querySchema = z.object({
  status: z.enum(["ONLINE", "OFFLINE"]).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("users.view", applicationId);

  const url = new URL(request.url);
  const query = querySchema.parse({
    status: url.searchParams.get("status") || undefined,
    search: url.searchParams.get("search") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });

  const rows = await prisma.userPresence.findMany({
    where: {
      userIdentity: {
        applicationId,
        ...(query.search
          ? {
              OR: [
                { username: { contains: query.search, mode: "insensitive" } },
                { displayNameSnapshot: { contains: query.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      ...(query.status ? { status: query.status } : {}),
    },
    select: {
      id: true,
      status: true,
      connectionCount: true,
      loginAt: true,
      lastSeenAt: true,
      offlineAt: true,
      updatedAt: true,
      userIdentity: {
        select: {
          id: true,
          username: true,
          displayNameSnapshot: true,
        },
      },
      effectiveRole: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
    take: query.limit,
  });

  return NextResponse.json({ success: true, data: { presence: rows } });
});
