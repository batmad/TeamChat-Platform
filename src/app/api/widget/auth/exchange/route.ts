import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { getRequestId } from "@/lib/api/request-id";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { exchangeExternalWidgetToken } from "@/lib/widget-auth/external-auth";
import { writeAuthenticationLog } from "@/lib/widget-auth/logging";
import { applyWidgetCors, widgetPreflightResponse } from "@/lib/widget-auth/cors";

const schema = z.object({ token: z.string().min(20).max(10_000) });

export const OPTIONS = async (request: Request) => widgetPreflightResponse(request, "POST, OPTIONS");

const handledPost = withApiHandler(async (request) => {
  const requestId = getRequestId(request);
  const origin = request.headers.get("origin");
  const body = schema.parse(await request.json());

  try {
    const result = await exchangeExternalWidgetToken({
      bootstrapToken: body.token,
      origin,
    });

    await writeAuthenticationLog({
      applicationId: result.application.id,
      requestId,
      username: result.user.username,
      level: "INFO",
      action: "WIDGET_AUTH_SUCCESS",
      message: "External widget authentication succeeded",
      metadata: {
        integrationId: result.integration.id,
        integrationType: result.integration.type,
        sessionReference: result.sessionReference,
      },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    await writeAuthenticationLog({
      requestId,
      level: error instanceof AppError && error.statusCode < 500 ? "WARN" : "ERROR",
      action: "WIDGET_AUTH_FAILED",
      message: error instanceof Error ? error.message : "External widget authentication failed",
      metadata: {
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        origin,
      },
    }).catch(() => undefined);
    throw error;
  }
});

export const POST = async (request: Request) =>
  applyWidgetCors(await handledPost(request), request.headers.get("origin"));
