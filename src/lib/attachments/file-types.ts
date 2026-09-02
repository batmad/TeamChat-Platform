import "server-only";

import { prisma } from "@/lib/db/prisma";
import { normalizeAttachmentExtension } from "@/lib/attachments/constants";

export type EffectiveAttachmentFileType = {
  id: string;
  key: string;
  applicationId: string | null;
  category: "IMAGE" | "DOCUMENT" | "SPREADSHEET" | "ARCHIVE" | "AUDIO" | "VIDEO" | "TEXT" | "OTHER";
  extension: string;
  mimeTypes: string[];
  maxSizeBytes: bigint | null;
  previewable: boolean;
  isAllowed: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function resolveAttachmentFileType(
  applicationId: string,
  extension: string,
): Promise<EffectiveAttachmentFileType | null> {
  const normalizedExtension = normalizeAttachmentExtension(extension);

  const [applicationPolicy, globalPolicy] = await Promise.all([
    prisma.attachmentFileType.findFirst({
      where: {
        applicationId,
        extension: normalizedExtension,
        isActive: true,
      },
    }),
    prisma.attachmentFileType.findFirst({
      where: {
        applicationId: null,
        extension: normalizedExtension,
        isActive: true,
      },
    }),
  ]);

  return (applicationPolicy ?? globalPolicy) as EffectiveAttachmentFileType | null;
}

export async function listEffectiveAttachmentFileTypes(
  applicationId: string,
): Promise<EffectiveAttachmentFileType[]> {
  const [globalRows, applicationRows] = await Promise.all([
    prisma.attachmentFileType.findMany({
      where: { applicationId: null, isActive: true },
      orderBy: [{ category: "asc" }, { extension: "asc" }],
    }),
    prisma.attachmentFileType.findMany({
      where: { applicationId, isActive: true },
      orderBy: [{ category: "asc" }, { extension: "asc" }],
    }),
  ]);

  const globalPolicies = globalRows as EffectiveAttachmentFileType[];
  const applicationPolicies = applicationRows as EffectiveAttachmentFileType[];
  const effective = new Map<string, EffectiveAttachmentFileType>(
    globalPolicies.map((policy) => [policy.extension, policy]),
  );

  for (const policy of applicationPolicies) {
    effective.set(policy.extension, policy);
  }

  return [...effective.values()].sort((a, b) => {
    const categoryCompare = a.category.localeCompare(b.category);
    return categoryCompare !== 0 ? categoryCompare : a.extension.localeCompare(b.extension);
  });
}

export async function listAllowedAttachmentFileTypes(applicationId: string) {
  const policies = await listEffectiveAttachmentFileTypes(applicationId);
  return policies.filter((policy) => policy.isAllowed);
}
