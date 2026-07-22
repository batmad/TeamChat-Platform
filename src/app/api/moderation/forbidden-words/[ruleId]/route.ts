import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { writeAuditLog } from "@/lib/audit/audit";
import { prisma } from "@/lib/db/prisma";
import { normalizeForbiddenPattern } from "@/lib/moderation/rules";
import { requireApiPermission, requireApiRoot } from "@/lib/rbac/guards";

type Context = { params: Promise<{ ruleId: string }> };
const updateSchema = z.object({ pattern: z.string().trim().min(1).max(500).optional(), matchMode: z.enum(["EXACT_WORD", "CONTAINS"]).optional(), isActive: z.boolean().optional() });

async function getRule(ruleId: string) {
  return prisma.forbiddenWord.findUnique({ where: { id: ruleId }, select: { id: true, applicationId: true, groupId: true, scope: true, pattern: true, normalizedPattern: true, matchMode: true, isActive: true, _count: { select: { violationLogs: true } } } });
}
async function authorizeRule(rule: Awaited<ReturnType<typeof getRule>>) {
  if (!rule) throw new AppError(404, "FORBIDDEN_WORD_NOT_FOUND", "Moderation rule was not found");
  if (rule.scope === "GLOBAL") return requireApiRoot();
  return requireApiPermission("moderation.manage", rule.applicationId ?? undefined);
}

export const PATCH = withApiHandler(async (request, context: Context) => {
  const { ruleId } = await context.params;
  const current = await getRule(ruleId);
  const session = await authorizeRule(current);
  const body = updateSchema.parse(await request.json());
  const normalizedPattern = body.pattern !== undefined ? normalizeForbiddenPattern(body.pattern) : current!.normalizedPattern;
  const matchMode = body.matchMode ?? current!.matchMode;
  const duplicate = await prisma.forbiddenWord.findFirst({ where: { id: { not: ruleId }, scope: current!.scope, applicationId: current!.applicationId, groupId: current!.groupId, normalizedPattern, matchMode }, select: { id: true } });
  if (duplicate) throw new AppError(409, "FORBIDDEN_WORD_EXISTS", "The same moderation rule already exists");
  const updated = await prisma.forbiddenWord.update({
    where: { id: ruleId },
    data: { ...(body.pattern !== undefined ? { pattern: body.pattern.trim(), normalizedPattern } : {}), ...(body.matchMode !== undefined ? { matchMode: body.matchMode } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) },
    select: { id: true, applicationId: true, groupId: true, scope: true, pattern: true, normalizedPattern: true, matchMode: true, isActive: true },
  });
  await writeAuditLog({ session, applicationId: current!.applicationId, action: "FORBIDDEN_WORD_UPDATED", entityType: "ForbiddenWord", entityId: ruleId, beforeData: current, afterData: updated });
  return NextResponse.json({ success: true, data: { rule: updated } });
});

export const DELETE = withApiHandler(async (_request, context: Context) => {
  const { ruleId } = await context.params;
  const current = await getRule(ruleId);
  const session = await authorizeRule(current);
  if (current!._count.violationLogs > 0) {
    const updated = await prisma.forbiddenWord.update({ where: { id: ruleId }, data: { isActive: false }, select: { id: true, isActive: true } });
    await writeAuditLog({ session, applicationId: current!.applicationId, action: "FORBIDDEN_WORD_DEACTIVATED", entityType: "ForbiddenWord", entityId: ruleId, beforeData: current, afterData: updated });
    return NextResponse.json({ success: true, data: { deactivated: true } });
  }
  await prisma.forbiddenWord.delete({ where: { id: ruleId } });
  await writeAuditLog({ session, applicationId: current!.applicationId, action: "FORBIDDEN_WORD_DELETED", entityType: "ForbiddenWord", entityId: ruleId, beforeData: current });
  return NextResponse.json({ success: true, data: { deleted: true } });
});
