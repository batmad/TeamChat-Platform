import { AppError } from "@/lib/api/app-error";

const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export function normalizeMimeType(value: string | null | undefined) {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function assertAttachmentMimeAllowed(input: {
  declaredMimeType: string | null | undefined;
  allowedMimeTypes: readonly string[];
  validationEnabled: boolean;
}) {
  const declared = normalizeMimeType(input.declaredMimeType);
  if (!input.validationEnabled || GENERIC_MIME_TYPES.has(declared)) return declared;

  const allowed = input.allowedMimeTypes.map(normalizeMimeType);
  if (!allowed.includes(declared)) {
    throw new AppError(
      400,
      "ATTACHMENT_MIME_NOT_ALLOWED",
      "Attachment MIME type does not match the configured file-type policy",
      { declaredMimeType: declared },
    );
  }

  return declared;
}
