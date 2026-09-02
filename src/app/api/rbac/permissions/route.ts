import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";

export const GET = withApiHandler(async () => {
  await requireApiPermission("roles.view");

  const permissions = await prisma.permission.findMany({
    where: { isActive: true },
    orderBy: [{ module: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      module: true,
    },
  });

  return NextResponse.json({ success: true, data: { permissions } });
});
