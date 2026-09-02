import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/api/app-error";
import { ClamAvAttachmentScanner } from "@/lib/attachments/scanner/clamav";
import type { AttachmentMalwareScanner } from "@/lib/attachments/scanner/types";

export type MalwareScannerConfigRecord = {
  id: string;
  applicationId: string | null;
  name: string;
  type: "CLAMAV" | "CUSTOM";
  config: unknown;
};

const clamAvConfigSchema = z
  .object({
    host: z.string().trim().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    socketPath: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().min(500).max(120_000).default(10_000),
    chunkSizeBytes: z.number().int().min(1024).max(1024 * 1024).default(64 * 1024),
  })
  .refine((value: { host?: string; port?: number; socketPath?: string }) => !(value.socketPath && (value.host || value.port)), {
    message: "Use either socketPath or host/port for ClamAV, not both",
  });

export function createAttachmentMalwareScanner(config: MalwareScannerConfigRecord): AttachmentMalwareScanner {
  if (config.type === "CLAMAV") {
    const parsed = clamAvConfigSchema.safeParse(config.config);
    if (!parsed.success) {
      throw new AppError(
        500,
        "ATTACHMENT_SCANNER_CONFIG_INVALID",
        "ClamAV attachment scanner configuration is invalid",
        parsed.error.flatten(),
      );
    }
    return new ClamAvAttachmentScanner(config.id, config.name, parsed.data);
  }

  throw new AppError(
    503,
    "ATTACHMENT_SCANNER_PROVIDER_NOT_IMPLEMENTED",
    `Attachment scanner provider ${config.type} is not implemented`,
  );
}
