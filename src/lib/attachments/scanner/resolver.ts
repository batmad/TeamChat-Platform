import "server-only";

import { AppError } from "@/lib/api/app-error";
import type { MalwareScannerConfigRecord } from "@/lib/attachments/scanner/factory";
import { prisma } from "@/lib/db/prisma";

const scannerSelect = {
  id: true,
  applicationId: true,
  name: true,
  type: true,
  config: true,
  isActive: true,
} as const;

export async function resolveAttachmentMalwareScannerConfig(input: {
  applicationId: string;
  preferredScannerProviderId?: string | null;
}): Promise<MalwareScannerConfigRecord> {
  if (input.preferredScannerProviderId) {
    const preferred = await prisma.malwareScannerConfig.findUnique({
      where: { id: input.preferredScannerProviderId },
      select: scannerSelect,
    });
    if (
      preferred?.isActive &&
      (preferred.applicationId === null || preferred.applicationId === input.applicationId)
    ) {
      return preferred as MalwareScannerConfigRecord;
    }
    throw new AppError(503, "ATTACHMENT_SCANNER_UNAVAILABLE", "Configured malware scanner is unavailable");
  }

  const [applicationDefault, globalDefault] = await Promise.all([
    prisma.malwareScannerConfig.findFirst({
      where: { applicationId: input.applicationId, isActive: true, isDefault: true },
      select: scannerSelect,
      orderBy: { createdAt: "asc" },
    }),
    prisma.malwareScannerConfig.findFirst({
      where: { applicationId: null, isActive: true, isDefault: true },
      select: scannerSelect,
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const resolved = applicationDefault ?? globalDefault;
  if (!resolved) {
    throw new AppError(503, "ATTACHMENT_SCANNER_MISSING", "No active malware scanner is configured");
  }
  return resolved as MalwareScannerConfigRecord;
}
