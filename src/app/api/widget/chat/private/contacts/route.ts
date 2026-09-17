import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { toChatAppError } from "@/lib/chat/http";
import { listPrivateContacts } from "@/lib/chat/private-chat";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";

const querySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const OPTIONS = async (request: Request) => widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request) => {
  const current = await requireChatSession(request);
  const url = new URL(request.url);
  const query = querySchema.parse({
    search: url.searchParams.get("search") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });

  try {
    const contacts = await listPrivateContacts({
      userIdentityId: current.authorization.userIdentityId,
      search: query.search,
      limit: query.limit,
    });
    return NextResponse.json({ success: true, data: { contacts } });
  } catch (error) {
    return toChatAppError(error);
  }
});

export const GET = async (request: Request) =>
  applyWidgetCors(await handledGet(request), request.headers.get("origin"));
