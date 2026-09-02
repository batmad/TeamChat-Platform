import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { prisma } from "@/lib/db/prisma";
import {
  applyWidgetCors,
  widgetPreflightResponse,
} from "@/lib/widget-auth/cors";
import { assertWidgetOriginAllowed } from "@/lib/widget-auth/origin";
import { getRequestOrigin } from "@//lib/widget-auth/request-origin";

type Context = { params: Promise<{ applicationKey: string }> };

type WidgetJsonConfig = {
  theme?: "light" | "dark" | "auto";
};

function readTheme(value: unknown): "light" | "dark" | "auto" {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "light";
  const theme = (value as WidgetJsonConfig).theme;
  return theme === "dark" || theme === "auto" ? theme : "light";
}

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "GET, OPTIONS");

const handledGet = withApiHandler(async (request, context: Context) => {
  const { applicationKey } = await context.params;
  const application = await prisma.application.findUnique({
    where: { key: applicationKey },
    select: {
      id: true,
      key: true,
      name: true,
      status: true,
      allowedOrigins: true,
      widgetConfig: {
        select: {
          position: true,
          bubbleIconUrl: true,
          bubbleSize: true,
          primaryColor: true,
          windowWidth: true,
          windowHeight: true,
          soundEnabledByDefault: true,
          browserNotificationEnabledByDefault: true,
          config: true,
        },
      },
    },
  });

  if (!application || application.status !== "ACTIVE") {
    throw new AppError(
      404,
      "WIDGET_APPLICATION_NOT_FOUND",
      "Widget application is unavailable",
    );
  }

  const requestOrigin = getRequestOrigin(request);
  assertWidgetOriginAllowed(application.allowedOrigins, requestOrigin);

  const config = application.widgetConfig;
  return NextResponse.json({
    success: true,
    data: {
      application: {
        id: application.id,
        key: application.key,
        name: application.name,
      },
      widget: {
        position: config?.position ?? "right-bottom",
        bubbleIconUrl: config?.bubbleIconUrl ?? null,
        bubbleSize: config?.bubbleSize ?? 60,
        primaryColor: config?.primaryColor ?? "#2563EB",
        windowWidth: config?.windowWidth ?? 380,
        windowHeight: config?.windowHeight ?? 600,
        theme: readTheme(config?.config),
        soundEnabledByDefault: config?.soundEnabledByDefault ?? true,
        browserNotificationEnabledByDefault:
          config?.browserNotificationEnabledByDefault ?? true,
      },
    },
  });
});

export const GET = async (request: Request, context: Context) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledGet(request, context), requestOrigin);
};
