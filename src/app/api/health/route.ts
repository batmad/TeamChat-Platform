import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApiHandler } from "@/lib/api/with-api-handler";

export const GET = withApiHandler(async () => {
  await prisma.$queryRaw`SELECT 1`;

  return NextResponse.json({
    success: true,
    data: {
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    },
  });
});
