import "server-only";

import { prisma } from "@/lib/db/prisma";

export type EffectiveAttachmentRetentionPolicy = {
  source: "APPLICATION" | "GLOBAL" | "DEFAULT";
  keepForever: boolean;
  retentionDays: number | null;
};

export async function resolveAttachmentRetentionPolicy(
  applicationId: string,
): Promise<EffectiveAttachmentRetentionPolicy> {
  const [applicationPolicy, globalPolicy] = await Promise.all([
    prisma.retentionPolicy.findFirst({
      where: { applicationId, dataType: "ATTACHMENT", category: "files", isActive: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.retentionPolicy.findFirst({
      where: { applicationId: null, dataType: "ATTACHMENT", category: "files", isActive: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const row = applicationPolicy ?? globalPolicy;
  if (!row) return { source: "DEFAULT", keepForever: false, retentionDays: 30 };
  if (row.keepForever) {
    return {
      source: applicationPolicy ? "APPLICATION" : "GLOBAL",
      keepForever: true,
      retentionDays: null,
    };
  }

  const retentionDays = row.retentionDays ?? 30;
  return {
    source: applicationPolicy ? "APPLICATION" : "GLOBAL",
    keepForever: false,
    retentionDays: Math.max(0, retentionDays),
  };
}

export function calculateAttachmentExpiresAt(
  startsAt: Date,
  policy: EffectiveAttachmentRetentionPolicy,
): Date | null {
  if (policy.keepForever || policy.retentionDays === null) return null;
  return new Date(startsAt.getTime() + policy.retentionDays * 24 * 60 * 60 * 1000);
}
