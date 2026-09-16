import { prisma } from "@/lib/db/prisma";
import { writeSystemLogSafe } from "@/lib/logs/system-log";

const CATEGORY_TO_SYSTEM_TYPE: Record<string, string | null> = {
  integration: "INTEGRATION",
  api: "API",
  authentication: "AUTHENTICATION",
  error: "ERROR",
  system: "SYSTEM",
  user_activity: "USER_ACTIVITY",
  chat_activity: "CHAT_ACTIVITY",
  report: "REPORT",
  content_violation: null,
  audit: null,
};

type RetentionPolicyShape = {
  applicationId: string | null;
  category: string;
  retentionDays: number | null;
  keepForever: boolean;
  isActive: boolean;
};

type CleanupResult = {
  applicationId: string | null;
  category: string;
  retentionDays: number;
  deleted: number;
};

function effectivePolicy(
  category: string,
  applicationId: string | null,
  policies: RetentionPolicyShape[],
): RetentionPolicyShape | null {
  if (applicationId) {
    const applicationPolicy = policies.find(
      (policy) => policy.applicationId === applicationId && policy.category === category && policy.isActive,
    );
    if (applicationPolicy) return applicationPolicy;
  }
  return policies.find(
    (policy) => policy.applicationId === null && policy.category === category && policy.isActive,
  ) ?? null;
}

async function cleanupCategory(input: {
  applicationId: string | null;
  category: string;
  policy: RetentionPolicyShape;
  now: Date;
}): Promise<CleanupResult | null> {
  if (input.policy.keepForever || !input.policy.retentionDays) return null;
  const cutoff = new Date(input.now.getTime() - input.policy.retentionDays * 86_400_000);
  let deleted = 0;

  if (input.category === "content_violation") {
    if (!input.applicationId) return null;
    const result = await prisma.contentViolationLog.deleteMany({
      where: {
        applicationId: input.applicationId,
        attemptedAt: { lt: cutoff },
      },
    });
    deleted = result.count;
  } else if (input.category === "audit") {
    const result = await prisma.auditLog.deleteMany({
      where: {
        applicationId: input.applicationId,
        createdAt: { lt: cutoff },
      },
    });
    deleted = result.count;
  } else {
    const type = CATEGORY_TO_SYSTEM_TYPE[input.category];
    if (!type) return null;
    const result = await prisma.systemLog.deleteMany({
      where: {
        applicationId: input.applicationId,
        type: type as never,
        createdAt: { lt: cutoff },
      },
    });
    deleted = result.count;
  }

  return {
    applicationId: input.applicationId,
    category: input.category,
    retentionDays: input.policy.retentionDays,
    deleted,
  };
}

export async function runLogRetentionCleanup(now = new Date()) {
  const [policies, applications] = await Promise.all([
    prisma.retentionPolicy.findMany({
      where: { dataType: "LOG", isActive: true },
      select: {
        applicationId: true,
        category: true,
        retentionDays: true,
        keepForever: true,
        isActive: true,
      },
    }),
    prisma.application.findMany({ select: { id: true } }),
  ]);

  const categories = Object.keys(CATEGORY_TO_SYSTEM_TYPE);
  const scopes: Array<string | null> = [null, ...applications.map((application: { id: string }) => application.id)];
  const results: CleanupResult[] = [];

  for (const applicationId of scopes) {
    for (const category of categories) {
      const policy = effectivePolicy(category, applicationId, policies);
      if (!policy) continue;
      const result = await cleanupCategory({ applicationId, category, policy, now });
      if (result) results.push(result);
    }
  }

  const deleted = results.reduce((sum, result) => sum + result.deleted, 0);
  await writeSystemLogSafe({
    type: "SYSTEM",
    level: "INFO",
    action: "LOG_RETENTION_CLEANUP_COMPLETED",
    message: `Log retention cleanup completed; ${deleted} records deleted`,
    metadata: { deleted, results },
  });

  return { deleted, results };
}
