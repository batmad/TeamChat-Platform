import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";

export const OPTIONS = async (request: Request) => widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request) => {
  const current = await requireChatSession(request);

  return NextResponse.json({
    success: true,
    data: {
      application: {
        id: current.authorization.applicationId,
        key: current.authorization.applicationKey,
        name: current.authorization.applicationName,
      },
      user: {
        identityId: current.authorization.userIdentityId,
        username: current.authorization.username,
        name: current.authorization.displayName,
        role: current.authorization.role,
        permissions: current.authorization.permissions,
        groups: current.groups,
        primaryGroup: current.groups.find((group) => group.isPrimary) ?? null,
      },
      sessionReference: current.token.sessionReference,
    },
  });
});

export const GET = async (request: Request) =>
  applyWidgetCors(await handledGet(request), request.headers.get("origin"));
