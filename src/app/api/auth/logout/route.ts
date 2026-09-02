import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/cookie";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { getRequestId } from "@/lib/api/request-id";
import { getCurrentSession } from "@/lib/auth/dal";
import { writeSystemLogSafe } from "@/lib/logs/system-log";

export const POST = withApiHandler(async (request) => {
  const session = await getCurrentSession();
  await clearSessionCookie();
  if (session) {
    await writeSystemLogSafe({
      applicationId: session.applicationId,
      type: "AUTHENTICATION",
      level: "INFO",
      requestId: getRequestId(request),
      username: session.username,
      action: "INTERNAL_LOGOUT",
      message: "Internal user logged out",
      metadata: { isRoot: session.isRoot },
    });
  }
  return NextResponse.json({ success: true });
});
