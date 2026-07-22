import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission } from "@/lib/rbac/guards";

type Context = { params: Promise<{ applicationId: string }> };

const widgetSchema = z.object({
  position: z.enum(["right-bottom", "left-bottom"]),
  bubbleIconUrl: z.string().trim().url().nullable().or(z.literal("")).optional(),
  bubbleSize: z.number().int().min(40).max(96),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  windowWidth: z.number().int().min(300).max(720),
  windowHeight: z.number().int().min(400).max(900),
  soundEnabledByDefault: z.boolean(),
  browserNotificationEnabledByDefault: z.boolean(),
  theme: z.enum(["light", "dark", "auto"]).default("light"),
});

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId } = await context.params;
  await requireApiPermission("applications.view", applicationId);
  const widgetConfig = await prisma.widgetConfig.findUnique({ where: { applicationId } });
  if (!widgetConfig) throw new AppError(404, "WIDGET_CONFIG_NOT_FOUND", "Widget configuration was not found");
  return NextResponse.json({ success: true, data: { widgetConfig } });
});

export const PUT = withApiHandler(async (request, context: Context) => {
  const { applicationId } = await context.params;
  const session = await requireApiPermission("applications.manage", applicationId);
  const body = widgetSchema.parse(await request.json());

  const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true } });
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application was not found");

  const before = await prisma.widgetConfig.findUnique({ where: { applicationId } });
  const existingConfig = before?.config && typeof before.config === "object" && !Array.isArray(before.config)
    ? before.config as Record<string, unknown>
    : {};
  const { theme, ...widgetFields } = body;
  const widgetConfig = await prisma.widgetConfig.upsert({
    where: { applicationId },
    update: {
      ...widgetFields,
      bubbleIconUrl: body.bubbleIconUrl || null,
      config: { ...existingConfig, theme },
    },
    create: {
      applicationId,
      ...widgetFields,
      bubbleIconUrl: body.bubbleIconUrl || null,
      config: { theme },
    },
  });

  await writeAuditLog({
    session,
    applicationId,
    action: "WIDGET_CONFIG_UPDATED",
    entityType: "WidgetConfig",
    entityId: widgetConfig.id,
    beforeData: before,
    afterData: widgetConfig,
  });

  return NextResponse.json({ success: true, data: { widgetConfig } });
});
