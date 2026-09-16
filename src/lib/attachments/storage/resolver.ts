import "server-only";

import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import type { StorageProviderConfigRecord } from "@/lib/attachments/storage/factory";

const storageProviderSelect = {
  id: true,
  applicationId: true,
  type: true,
  config: true,
  credentialEncrypted: true,
  isActive: true,
} as const;

export async function resolveAttachmentStorageConfig(input: {
  applicationId: string;
  preferredStorageProviderId?: string | null;
}): Promise<StorageProviderConfigRecord> {
  if (input.preferredStorageProviderId) {
    const preferred = await prisma.storageProviderConfig.findUnique({
      where: { id: input.preferredStorageProviderId },
      select: storageProviderSelect,
    });

    if (
      preferred &&
      preferred.isActive &&
      (preferred.applicationId === null ||
        preferred.applicationId === input.applicationId)
    ) {
      return preferred as StorageProviderConfigRecord;
    }

    throw new AppError(
      503,
      "ATTACHMENT_STORAGE_PROVIDER_UNAVAILABLE",
      "Configured attachment storage provider is unavailable for this application",
    );
  }

  const [applicationDefault, globalDefault] = await Promise.all([
    prisma.storageProviderConfig.findFirst({
      where: {
        applicationId: input.applicationId,
        isActive: true,
        isDefault: true,
      },
      select: storageProviderSelect,
      orderBy: { createdAt: "asc" },
    }),
    prisma.storageProviderConfig.findFirst({
      where: {
        applicationId: null,
        isActive: true,
        isDefault: true,
      },
      select: storageProviderSelect,
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const resolved = applicationDefault ?? globalDefault;
  if (!resolved) {
    throw new AppError(
      503,
      "ATTACHMENT_STORAGE_PROVIDER_MISSING",
      "No active attachment storage provider is configured",
    );
  }

  return resolved as StorageProviderConfigRecord;
}

export async function getAttachmentStorageConfigById(providerId: string) {
  const provider = await prisma.storageProviderConfig.findUnique({
    where: { id: providerId },
    select: {
      ...storageProviderSelect,
      key: true,
      name: true,
      isDefault: true,
      lastHealthCheckAt: true,
      lastHealthStatus: true,
      lastHealthError: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!provider) {
    throw new AppError(
      404,
      "ATTACHMENT_STORAGE_PROVIDER_NOT_FOUND",
      "Attachment storage provider was not found",
    );
  }
  return provider;
}
