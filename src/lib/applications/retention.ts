import "server-only";
import { prisma } from "@/lib/db/prisma";
import { APPLICATION_RETENTION_DEFINITIONS, applicationRetentionKey } from "@/lib/applications/constants";

export async function ensureApplicationRetentionPolicies(applicationId: string) {
  await prisma.$transaction(
    APPLICATION_RETENTION_DEFINITIONS.map((definition) =>
      prisma.retentionPolicy.upsert({
        where: { key: applicationRetentionKey(applicationId, definition.dataType, definition.category) },
        update: {},
        create: {
          key: applicationRetentionKey(applicationId, definition.dataType, definition.category),
          applicationId,
          dataType: definition.dataType,
          category: definition.category,
          retentionDays: definition.retentionDays,
          keepForever: definition.keepForever,
          isActive: true,
        },
      }),
    ),
  );
}
