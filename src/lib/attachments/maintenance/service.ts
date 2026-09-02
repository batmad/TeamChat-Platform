import "server-only";

import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { resolveAttachmentStorageConfig } from "@/lib/attachments/storage/resolver";
import { resolveAttachmentPolicy } from "@/lib/attachments/config";
import { resolveAttachmentRetentionPolicy } from "@/lib/attachments/retention/policy";
import { attachmentDeleteFinalStatus, attachmentDeleteRetryDelayMs } from "@/lib/attachments/maintenance/retry";
import { writeAttachmentAuditSafe } from "@/lib/attachments/audit";
import { prisma } from "@/lib/db/prisma";

const DEFAULT_BATCH_SIZE = 200;

type AttachmentDeleteCandidate = {
  id: string;
  applicationId: string;
  storageProviderId: string | null;
  storageKey: string | null;
  status: string;
  sizeBytes: bigint;
  deleteReason: string | null;
  deleteRetryCount: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : "Unknown storage deletion error";
}

function cleanupAuditAction(reason: string, finalStatus: "DELETED" | "EXPIRED") {
  if (finalStatus === "EXPIRED") return "ATTACHMENT_EXPIRED";
  if (reason === "MESSAGE_DELETED") return "ATTACHMENT_MESSAGE_DELETE_CLEANUP";
  if (["TEMPORARY_EXPIRED", "FAILED_CLEANUP", "REJECTED_CLEANUP"].includes(reason)) {
    return "ATTACHMENT_ORPHAN_CLEANUP";
  }
  return "ATTACHMENT_CLEANUP_DELETED";
}

async function auditCleanupSuccess(row: AttachmentDeleteCandidate, reason: string, finalStatus: "DELETED" | "EXPIRED") {
  await writeAttachmentAuditSafe({
    applicationId: row.applicationId,
    action: cleanupAuditAction(reason, finalStatus),
    attachmentId: row.id,
    metadata: { reason, finalStatus, sizeBytes: row.sizeBytes },
  });
}

async function finalizeWithoutObject(row: AttachmentDeleteCandidate, reason: string, finalStatus: "DELETED" | "EXPIRED") {
  const deletedAt = new Date();
  await prisma.messageAttachment.update({
    where: { id: row.id },
    data: {
      status: finalStatus,
      deletedAt,
      deleteReason: reason,
      storageKey: null,
      deleteLastError: null,
      deleteLastAttemptAt: deletedAt,
    },
  });
  await auditCleanupSuccess(row, reason, finalStatus);
}

async function deletePhysicalAttachment(
  row: AttachmentDeleteCandidate,
  reason: string,
  finalStatus: "DELETED" | "EXPIRED",
) {
  const attemptedAt = new Date();
  if (!row.storageKey || !row.storageProviderId) {
    await finalizeWithoutObject(row, reason, finalStatus);
    return true;
  }

  try {
    const storageConfig = await resolveAttachmentStorageConfig({
      applicationId: row.applicationId,
      preferredStorageProviderId: row.storageProviderId,
    });
    const provider = createAttachmentStorageProvider(storageConfig);
    await provider.delete(row.storageKey);
    await prisma.messageAttachment.update({
      where: { id: row.id },
      data: {
        status: finalStatus,
        deletedAt: attemptedAt,
        deleteReason: reason,
        storageKey: null,
        deleteLastAttemptAt: attemptedAt,
        deleteLastError: null,
      },
    });
    await auditCleanupSuccess(row, reason, finalStatus);
    return true;
  } catch (error) {
    await prisma.messageAttachment.update({
      where: { id: row.id },
      data: {
        status: "DELETE_FAILED",
        deleteReason: reason,
        deleteRetryCount: { increment: 1 },
        deleteLastAttemptAt: attemptedAt,
        deleteLastError: errorMessage(error),
      },
    });
    await writeAttachmentAuditSafe({
      applicationId: row.applicationId,
      action: "ATTACHMENT_STORAGE_DELETE_FAILED",
      attachmentId: row.id,
      level: "ERROR",
      metadata: { reason, error: errorMessage(error) },
    });
    return false;
  }
}

async function claimAndDelete(row: AttachmentDeleteCandidate, reason: string, finalStatus: "DELETED" | "EXPIRED") {
  const claimed = await prisma.messageAttachment.updateMany({
    where: {
      id: row.id,
      status: { notIn: ["DELETED", "EXPIRED", "DELETING"] },
    },
    data: { status: "DELETING", deleteReason: reason },
  });
  if (claimed.count !== 1 && row.status !== "DELETE_FAILED" && row.status !== "DELETING") return false;
  return deletePhysicalAttachment(row, reason, finalStatus);
}

async function cleanupMessageDeletedAttachments(batchSize: number) {
  const rows = await prisma.messageAttachment.findMany({
    where: {
      deletedAt: null,
      messageId: { not: null },
      status: { notIn: ["DELETED", "EXPIRED", "DELETE_FAILED"] },
      message: { is: { deletedAt: { not: null } } },
    },
    select: {
      id: true,
      applicationId: true,
      storageProviderId: true,
      storageKey: true,
      status: true,
      sizeBytes: true,
      deleteReason: true,
      deleteRetryCount: true,
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  let deleted = 0;
  for (const row of rows) {
    if (await claimAndDelete(row, "MESSAGE_DELETED", "DELETED")) deleted += 1;
  }
  return { candidates: rows.length, deleted };
}

async function cleanupRetention(batchSize: number, now: Date) {
  const applicationIds = await prisma.messageAttachment.findMany({
    where: { messageId: { not: null }, deletedAt: null, status: "READY" },
    distinct: ["applicationId"],
    select: { applicationId: true },
  });

  let candidates = 0;
  let expired = 0;
  for (const { applicationId } of applicationIds) {
    if (candidates >= batchSize) break;
    const retention = await resolveAttachmentRetentionPolicy(applicationId);
    if (retention.keepForever || retention.retentionDays === null) continue;
    const cutoff = new Date(now.getTime() - retention.retentionDays * 24 * 60 * 60 * 1000);
    const rows = await prisma.messageAttachment.findMany({
      where: {
        applicationId,
        messageId: { not: null },
        deletedAt: null,
        status: "READY",
        OR: [
          { expiresAt: { lte: now } },
          { expiresAt: null, createdAt: { lte: cutoff } },
        ],
      },
      select: {
        id: true,
        applicationId: true,
        storageProviderId: true,
        storageKey: true,
        status: true,
        sizeBytes: true,
        deleteReason: true,
        deleteRetryCount: true,
      },
      take: batchSize - candidates,
      orderBy: { createdAt: "asc" },
    });
    candidates += rows.length;
    for (const row of rows) {
      if (await claimAndDelete(row, "RETENTION_EXPIRED", "EXPIRED")) expired += 1;
    }
  }
  return { candidates, expired };
}

async function cleanupUnboundAttachments(batchSize: number, now: Date) {
  const rows = await prisma.messageAttachment.findMany({
    where: {
      messageId: null,
      deletedAt: null,
      status: { in: ["TEMPORARY", "UPLOADING", "SCANNING", "READY", "FAILED", "REJECTED"] },
    },
    select: {
      id: true,
      applicationId: true,
      storageProviderId: true,
      storageKey: true,
      status: true,
      sizeBytes: true,
      deleteReason: true,
      deleteRetryCount: true,
      createdAt: true,
    },
    take: Math.min(batchSize * 5, 5000),
    orderBy: { createdAt: "asc" },
  });

  let cleaned = 0;
  for (const row of rows) {
    if (cleaned >= batchSize) break;
    const policy = await resolveAttachmentPolicy(row.applicationId);
    const ttlMs =
      row.status === "FAILED" || row.status === "REJECTED"
        ? policy.failedCleanupHours * 60 * 60 * 1000
        : policy.temporaryTtlMinutes * 60 * 1000;
    if (row.createdAt.getTime() + ttlMs > now.getTime()) continue;

    if ((row.status === "FAILED" || row.status === "REJECTED") && !row.storageKey) {
      const reason = row.status === "REJECTED" ? "REJECTED_CLEANUP" : "FAILED_CLEANUP";
      await prisma.messageAttachment.update({
        where: { id: row.id },
        data: { deletedAt: now, deleteReason: reason },
      });
      await auditCleanupSuccess(row, reason, "DELETED");
      cleaned += 1;
      continue;
    }

    if (await claimAndDelete(row, row.status === "FAILED" ? "FAILED_CLEANUP" : "TEMPORARY_EXPIRED", "DELETED")) {
      cleaned += 1;
    }
  }
  return { candidates: rows.length, cleaned };
}

async function retryFailedDeletes(batchSize: number, now: Date) {
  const rows = await prisma.messageAttachment.findMany({
    where: { status: "DELETE_FAILED", deletedAt: null },
    select: {
      id: true,
      applicationId: true,
      storageProviderId: true,
      storageKey: true,
      status: true,
      sizeBytes: true,
      deleteReason: true,
      deleteRetryCount: true,
      deleteLastAttemptAt: true,
    },
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  let retried = 0;
  let recovered = 0;
  let exhausted = 0;
  for (const row of rows) {
    const policy = await resolveAttachmentPolicy(row.applicationId);
    if (row.deleteRetryCount >= policy.deleteRetryMaxAttempts) {
      exhausted += 1;
      const marker = "RETRY_EXHAUSTED:";
      const current = await prisma.messageAttachment.findUnique({
        where: { id: row.id },
        select: { deleteLastError: true },
      });
      if (!current?.deleteLastError?.startsWith(marker)) {
        await prisma.messageAttachment.update({
          where: { id: row.id },
          data: { deleteLastError: `${marker} ${current?.deleteLastError ?? "Storage deletion failed"}` },
        });
        await writeAttachmentAuditSafe({
          applicationId: row.applicationId,
          action: "ATTACHMENT_DELETE_RETRY_EXHAUSTED",
          attachmentId: row.id,
          level: "ERROR",
          metadata: { retryCount: row.deleteRetryCount, deleteReason: row.deleteReason },
        });
      }
      continue;
    }
    const waitMs = attachmentDeleteRetryDelayMs(row.deleteRetryCount, policy.deleteRetryBaseMinutes);
    if (row.deleteLastAttemptAt && row.deleteLastAttemptAt.getTime() + waitMs > now.getTime()) continue;

    retried += 1;
    const finalStatus = attachmentDeleteFinalStatus(row.deleteReason);
    if (await deletePhysicalAttachment(row, row.deleteReason ?? "DELETE_RETRY", finalStatus)) recovered += 1;
  }
  return { candidates: rows.length, retried, recovered, exhausted };
}

async function cleanupRateBuckets(now: Date) {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.attachmentUploadRateBucket.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return result.count;
}

export async function runAttachmentMaintenance(input?: { batchSize?: number; now?: Date }) {
  const batchSize = Math.max(1, Math.min(input?.batchSize ?? DEFAULT_BATCH_SIZE, 2000));
  const now = input?.now ?? new Date();

  const messageDelete = await cleanupMessageDeletedAttachments(batchSize);
  const retention = await cleanupRetention(batchSize, now);
  const unbound = await cleanupUnboundAttachments(batchSize, now);
  const retry = await retryFailedDeletes(batchSize, now);
  const rateBucketsDeleted = await cleanupRateBuckets(now);

  return {
    ranAt: now.toISOString(),
    batchSize,
    messageDelete,
    retention,
    unbound,
    retry,
    rateBucketsDeleted,
  };
}
