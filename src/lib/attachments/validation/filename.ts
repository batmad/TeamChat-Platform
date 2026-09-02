import { AppError } from "@/lib/api/app-error";
import { normalizeAttachmentExtension } from "@/lib/attachments/constants";

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
const DANGEROUS_FILENAME_CHARS = /[<>:"|?*]/g;
const MAX_FILENAME_LENGTH = 180;

export function sanitizeAttachmentFilename(input: string) {
  const pathNeutral = input.replace(/\\/g, "/");
  const basename = pathNeutral.split("/").pop()?.trim() ?? "";
  const sanitized = basename
    .replace(CONTROL_CHARACTERS, "")
    .replace(DANGEROUS_FILENAME_CHARS, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();

  if (!sanitized) {
    throw new AppError(400, "ATTACHMENT_FILENAME_INVALID", "Attachment filename is invalid");
  }

  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const extensionIndex = sanitized.lastIndexOf(".");
    const extension = extensionIndex > 0 ? sanitized.slice(extensionIndex) : "";
    const available = Math.max(1, MAX_FILENAME_LENGTH - extension.length);
    return `${sanitized.slice(0, available)}${extension}`;
  }

  return sanitized;
}

export function getAttachmentExtension(filename: string) {
  const sanitized = sanitizeAttachmentFilename(filename);
  const index = sanitized.lastIndexOf(".");
  if (index <= 0 || index === sanitized.length - 1) {
    throw new AppError(
      400,
      "ATTACHMENT_EXTENSION_REQUIRED",
      "Attachment file extension is required",
    );
  }
  return normalizeAttachmentExtension(sanitized.slice(index + 1));
}
