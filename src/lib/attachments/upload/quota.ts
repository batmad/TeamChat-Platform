import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/app-error";

export async function assertAttachmentQuotaReservation(input: {
  tx: Prisma.TransactionClient;
  applicationId: string;
  incomingBytes: bigint;
  quotaBytes: bigint | null;
}) {
  const lockKey = `attachment-quota:${input.applicationId}`;
  await input.tx
    .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (input.quotaBytes === null) return;

  const usage = await input.tx.messageAttachment.aggregate({
    where: {
      applicationId: input.applicationId,
      deletedAt: null,
      storageKey: { not: null },
      status: { notIn: ["DELETED", "EXPIRED"] },
    },
    _sum: { sizeBytes: true },
  });

  const usedAndReservedBytes = usage._sum.sizeBytes ?? BigInt(0);
  if (usedAndReservedBytes + input.incomingBytes > input.quotaBytes) {
    throw new AppError(
      413,
      "ATTACHMENT_STORAGE_QUOTA_EXCEEDED",
      "Application attachment storage quota would be exceeded",
      {
        usedAndReservedBytes: usedAndReservedBytes.toString(),
        incomingBytes: input.incomingBytes.toString(),
        quotaBytes: input.quotaBytes.toString(),
      },
    );
  }
}

/** Compatibility wrapper for callers outside Package D. */
export async function assertAttachmentQuotaPreflight() {
  // Package D reserves quota atomically when attachment rows are created.
}
