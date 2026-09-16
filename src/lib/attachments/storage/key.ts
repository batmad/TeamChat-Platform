import { AppError } from "@/lib/api/app-error";

function safeSegment(value: string, field: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new AppError(
      500,
      "ATTACHMENT_STORAGE_KEY_INVALID",
      `Invalid ${field} while building attachment storage key`,
    );
  }
  return normalized;
}

export function buildAttachmentStorageKey(input: {
  applicationId: string;
  attachmentId: string;
  createdAt?: Date;
}) {
  const createdAt = input.createdAt ?? new Date();
  const year = String(createdAt.getUTCFullYear());
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, "0");
  const applicationId = safeSegment(input.applicationId, "application id");
  const attachmentId = safeSegment(input.attachmentId, "attachment id");

  return `${applicationId}/${year}/${month}/${attachmentId}/${attachmentId}.bin`;
}
