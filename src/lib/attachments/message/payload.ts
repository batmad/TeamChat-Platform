export const messageAttachmentSelect = {
  id: true,
  originalName: true,
  extension: true,
  mimeType: true,
  detectedMimeType: true,
  sizeBytes: true,
  checksum: true,
  status: true,
  scanStatus: true,
  expiresAt: true,
  deletedAt: true,
  deleteReason: true,
  createdAt: true,
} as const;

export type MessageAttachmentRow = {
  id: string;
  originalName: string;
  extension: string;
  mimeType: string;
  detectedMimeType: string | null;
  sizeBytes: bigint;
  checksum: string | null;
  status:
    | "TEMPORARY"
    | "UPLOADING"
    | "SCANNING"
    | "READY"
    | "FAILED"
    | "REJECTED"
    | "EXPIRED"
    | "DELETING"
    | "DELETED"
    | "DELETE_FAILED";
  scanStatus:
    | "NOT_REQUIRED"
    | "PENDING"
    | "SCANNING"
    | "CLEAN"
    | "INFECTED"
    | "FAILED";
  expiresAt: Date | null;
  deletedAt: Date | null;
  deleteReason: string | null;
  createdAt: Date;
};

export type MessageAttachmentPayload = {
  id: string;
  originalName: string;
  extension: string;
  mimeType: string;
  detectedMimeType: string | null;
  sizeBytes: number;
  checksum: string | null;
  status: MessageAttachmentRow["status"];
  scanStatus: MessageAttachmentRow["scanStatus"];
  previewKind: "IMAGE" | "PDF" | null;
  expiresAt: string | null;
  deletedAt: string | null;
  deleteReason: string | null;
  createdAt: string;
};

function resolvePreviewKind(row: MessageAttachmentRow): "IMAGE" | "PDF" | null {
  const mime = (row.detectedMimeType || row.mimeType).toLowerCase();
  if (mime.startsWith("image/")) return "IMAGE";
  if (row.extension.toLowerCase() === "pdf" || mime === "application/pdf") return "PDF";
  return null;
}

function effectiveAttachmentStatus(row: MessageAttachmentRow): MessageAttachmentRow["status"] {
  if (row.status === "EXPIRED") return "EXPIRED";
  if (row.status === "READY" && row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return "EXPIRED";
  }
  if (row.deletedAt) return "DELETED";
  return row.status;
}

export function serializeMessageAttachment(row: MessageAttachmentRow): MessageAttachmentPayload {
  return {
    id: row.id,
    originalName: row.originalName,
    extension: row.extension,
    mimeType: row.mimeType,
    detectedMimeType: row.detectedMimeType,
    sizeBytes: Number(row.sizeBytes),
    checksum: row.checksum,
    status: effectiveAttachmentStatus(row),
    scanStatus: row.scanStatus,
    previewKind: resolvePreviewKind(row),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deleteReason: row.deleteReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeMessageAttachments(rows: MessageAttachmentRow[]) {
  return rows.map(serializeMessageAttachment);
}
