import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/app-error";
import type { EffectiveAttachmentPolicy } from "@/lib/attachments/policy";
import { prisma } from "@/lib/db/prisma";

export function attachmentRateWindowStart(nowMs: number, windowMs: number) {
  return Math.floor(nowMs / windowMs) * windowMs;
}

export async function consumeAttachmentUploadRateLimit(input: {
  applicationId: string;
  userIdentityId: string;
  incomingBytes: bigint;
  policy: EffectiveAttachmentPolicy;
  now?: Date;
}) {
  if (!input.policy.uploadRateLimitEnabled) return;

  const now = input.now ?? new Date();
  const windowMs = input.policy.uploadRateLimitWindowMs;
  const windowStartMs = attachmentRateWindowStart(now.getTime(), windowMs);
  const windowStart = new Date(windowStartMs);
  const lockKey = `attachment-rate:${input.applicationId}:${input.userIdentityId}:${windowStartMs}:${windowMs}`;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const bucket = await tx.attachmentUploadRateBucket.findFirst({
      where: {
        applicationId: input.applicationId,
        userIdentityId: input.userIdentityId,
        windowStart,
        windowMs,
      },
    });

    const nextRequests = (bucket?.requestCount ?? 0) + 1;
    const nextBytes = (bucket?.byteCount ?? BigInt(0)) + input.incomingBytes;
    if (
      nextRequests > input.policy.uploadRateLimitMaxRequests ||
      nextBytes > input.policy.uploadRateLimitMaxBytes
    ) {
      throw new AppError(
        429,
        "ATTACHMENT_UPLOAD_RATE_LIMITED",
        "Attachment upload rate limit exceeded",
        {
          retryAfterMs: Math.max(1, windowStartMs + windowMs - now.getTime()),
          maxRequests: input.policy.uploadRateLimitMaxRequests,
          maxBytes: input.policy.uploadRateLimitMaxBytes.toString(),
        },
      );
    }

    if (bucket) {
      await tx.attachmentUploadRateBucket.update({
        where: { id: bucket.id },
        data: { requestCount: nextRequests, byteCount: nextBytes },
      });
    } else {
      await tx.attachmentUploadRateBucket.create({
        data: {
          applicationId: input.applicationId,
          userIdentityId: input.userIdentityId,
          windowStart,
          windowMs,
          requestCount: 1,
          byteCount: input.incomingBytes,
        },
      });
    }
  });
}
