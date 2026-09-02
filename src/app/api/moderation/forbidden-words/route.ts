import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { normalizeForbiddenPattern, validateForbiddenWordScope } from "@/lib/moderation/rules";
import { requireApiPermission, requireApiRoot } from "@/lib/rbac/guards";

const createSchema = z.object({
  scope: z.enum(["GLOBAL", "APPLICATION", "GROUP"]),
  applicationId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  pattern: z.string().trim().min(1).max(500),
  matchMode: z.enum(["EXACT_WORD", "CONTAINS"]),
});

async function requireScopePermission(scope: "GLOBAL" | "APPLICATION" | "GROUP", applicationId: string | null | undefined) {
  if (scope === "GLOBAL") return requireApiRoot();
  if (!applicationId) throw new AppError(400, "APPLICATION_REQUIRED", "Application is required");
  return requireApiPermission("moderation.manage", applicationId);
}

async function validateScopeReferences(input: { scope: "GLOBAL" | "APPLICATION" | "GROUP"; applicationId?: string | null; groupId?: string | null }) {
  if (!validateForbiddenWordScope(input)) throw new AppError(400, "MODERATION_SCOPE_INVALID", "Forbidden word scope configuration is invalid");
  if (input.scope === "GLOBAL") return;
  const application = await prisma.application.findUnique({ where: { id: input.applicationId! }, select: { id: true, status: true } });
  if (!application || application.status !== "ACTIVE") throw new AppError(404, "APPLICATION_NOT_FOUND", "Active application was not found");
  if (input.scope === "GROUP") {
    const group = await prisma.group.findFirst({ where: { id: input.groupId!, applicationId: input.applicationId!, isActive: true }, select: { id: true } });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Active group was not found");
  }
}

export const GET = withApiHandler(async (request) => {
  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId");
  if (applicationId) await requireApiPermission("moderation.view", applicationId);
  else await requireApiRoot();
  const rules = await prisma.forbiddenWord.findMany({
    where: applicationId ? { OR: [{ scope: "GLOBAL", applicationId: null, groupId: null }, { applicationId }] } : undefined,
    orderBy: [{ scope: "asc" }, { pattern: "asc" }],
    select: {
      id: true, applicationId: true, groupId: true, scope: true, pattern: true, normalizedPattern: true,
      matchMode: true, isActive: true, createdByUsername: true, createdAt: true, updatedAt: true,
      application: { select: { id: true, key: true, name: true } },
      group: { select: { id: true, code: true, name: true } },
      _count: { select: { violationLogs: true } },
    },
  });
  return NextResponse.json({ success: true, data: { rules } });
});

export const POST = withApiHandler(async (request) => {
  const body = createSchema.parse(await request.json());
  const applicationId = body.applicationId ?? null;
  const groupId = body.groupId ?? null;
  const session = await requireScopePermission(body.scope, applicationId);
  await validateScopeReferences({ scope: body.scope, applicationId, groupId });
  const normalizedPattern = normalizeForbiddenPattern(body.pattern);
  if (!normalizedPattern) throw new AppError(400, "FORBIDDEN_PATTERN_EMPTY", "Forbidden word pattern cannot be empty");
  const duplicate = await prisma.forbiddenWord.findFirst({
    where: { scope: body.scope, applicationId, groupId, normalizedPattern, matchMode: body.matchMode }, select: { id: true },
  });
  if (duplicate) throw new AppError(409, "FORBIDDEN_WORD_EXISTS", "The same moderation rule already exists");
  const rule = await prisma.forbiddenWord.create({
    data: { scope: body.scope, applicationId, groupId, pattern: body.pattern.trim(), normalizedPattern, matchMode: body.matchMode, isActive: true, createdByUsername: session.username },
    select: { id: true, applicationId: true, groupId: true, scope: true, pattern: true, normalizedPattern: true, matchMode: true, isActive: true },
  });
  await writeAuditLog({ session, applicationId, action: "FORBIDDEN_WORD_CREATED", entityType: "ForbiddenWord", entityId: rule.id, afterData: rule });
  return NextResponse.json({ success: true, data: { rule } }, { status: 201 });
});
