import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
const username = process.env.ROOT_USERNAME;
const name = process.env.ROOT_NAME ?? "System Root";
const password = process.env.ROOT_PASSWORD;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!username) throw new Error("ROOT_USERNAME is required");
if (!password || password.length < 12) {
  throw new Error("ROOT_PASSWORD is required and must be at least 12 characters");
}

const rootUsername = username;
const rootPassword = password;
const rootName = name;

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const permissions = [
  ["dashboard.view", "View dashboard", "dashboard"],
  ["applications.view", "View applications", "applications"],
  ["applications.manage", "Manage applications", "applications"],
  ["integrations.view", "View integrations", "integrations"],
  ["integrations.manage", "Manage integrations", "integrations"],
  ["integrations.test", "Test integration connections", "integrations"],
  ["users.view", "View users", "users"],
  ["users.manage", "Manage internal users", "users"],
  ["users.override", "Manage user role and permission overrides", "users"],
  ["groups.view", "View groups", "groups"],
  ["groups.manage", "Manage groups and memberships", "groups"],
  ["chat.private.view", "View private chat", "chat"],
  ["chat.private.send", "Send private chat messages", "chat"],
  ["chat.private.all", "Private chat across groups", "chat"],
  ["chat.private.attachment.send", "Send attachments in private chat", "chat"],
  ["chat.private.attachment.download", "Download attachments in private chat", "chat"],
  ["chat.private.attachment.preview", "Preview attachments in private chat", "chat"],
  ["chat.private.attachment.delete", "Delete own attachments in private chat", "chat"],
  ["chat.private.attachment.delete_others", "Delete other users' attachments in private chat", "chat"],
  ["chat.group.view", "View assigned group chats", "chat"],
  ["chat.group.send", "Send group chat messages", "chat"],
  ["chat.group.view_all", "View all application group chats", "chat"],
  ["chat.group.attachment.send", "Send attachments in group chat", "chat"],
  ["chat.group.attachment.download", "Download attachments in group chat", "chat"],
  ["chat.group.attachment.preview", "Preview attachments in group chat", "chat"],
  ["chat.group.attachment.delete", "Delete own attachments in group chat", "chat"],
  ["chat.group.attachment.delete_others", "Delete other users' attachments in group chat", "chat"],
  ["moderation.view", "View content moderation", "moderation"],
  ["moderation.manage", "Manage forbidden words", "moderation"],
  ["reports.chat_logs.view", "View chat logs report", "reports"],
  ["reports.chat_logs.export", "Export chat logs report", "reports"],
  ["reports.chat_logs.scope.manage", "Manage chat logs report data scopes", "reports"],
  ["logs.view", "View log module", "logs"],
  ["logs.integration.view", "View integration logs", "logs"],
  ["logs.authentication.view", "View authentication logs", "logs"],
  ["logs.error.view", "View error logs", "logs"],
  ["logs.activity.view", "View activity logs", "logs"],
  ["logs.violation.view", "View content violation logs", "logs"],
  ["logs.audit.view", "View audit trail", "logs"],
  ["roles.view", "View roles and permissions", "roles"],
  ["roles.manage", "Manage roles and permissions", "roles"],
  ["settings.view", "View settings", "settings"],
  ["settings.manage", "Manage settings", "settings"],
  ["notifications.manage_self", "Manage own notification settings", "notifications"],
] as const;

const defaultRetentionPolicies = [
  ["GLOBAL:log.integration", "LOG", "integration", 90, false],
  ["GLOBAL:log.api", "LOG", "api", 90, false],
  ["GLOBAL:log.authentication", "LOG", "authentication", 180, false],
  ["GLOBAL:log.error", "LOG", "error", 365, false],
  ["GLOBAL:log.system", "LOG", "system", 180, false],
  ["GLOBAL:log.user_activity", "LOG", "user_activity", 90, false],
  ["GLOBAL:log.chat_activity", "LOG", "chat_activity", 90, false],
  ["GLOBAL:log.content_violation", "LOG", "content_violation", 365, false],
  ["GLOBAL:log.report", "LOG", "report", 365, false],
  ["GLOBAL:log.audit", "LOG", "audit", null, true],
  ["GLOBAL:chat.messages", "CHAT", "messages", null, true],
  ["GLOBAL:attachment.files", "ATTACHMENT", "files", 30, false],
] as const;

const defaultAttachmentFileTypes = [
  { extension: "jpg", category: "IMAGE", mimeTypes: ["image/jpeg"], previewable: true, isAllowed: true },
  { extension: "jpeg", category: "IMAGE", mimeTypes: ["image/jpeg"], previewable: true, isAllowed: true },
  { extension: "png", category: "IMAGE", mimeTypes: ["image/png"], previewable: true, isAllowed: true },
  { extension: "webp", category: "IMAGE", mimeTypes: ["image/webp"], previewable: true, isAllowed: true },
  { extension: "pdf", category: "DOCUMENT", mimeTypes: ["application/pdf"], previewable: true, isAllowed: true },
  { extension: "doc", category: "DOCUMENT", mimeTypes: ["application/msword"], previewable: false, isAllowed: true },
  {
    extension: "docx",
    category: "DOCUMENT",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    previewable: false,
    isAllowed: true,
  },
  { extension: "xls", category: "SPREADSHEET", mimeTypes: ["application/vnd.ms-excel"], previewable: false, isAllowed: true },
  {
    extension: "xlsx",
    category: "SPREADSHEET",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    previewable: false,
    isAllowed: true,
  },
  { extension: "csv", category: "SPREADSHEET", mimeTypes: ["text/csv", "application/csv"], previewable: false, isAllowed: true },
  { extension: "txt", category: "TEXT", mimeTypes: ["text/plain"], previewable: false, isAllowed: true },
  { extension: "zip", category: "ARCHIVE", mimeTypes: ["application/zip", "application/x-zip-compressed"], previewable: false, isAllowed: false },
  { extension: "rar", category: "ARCHIVE", mimeTypes: ["application/vnd.rar", "application/x-rar-compressed"], previewable: false, isAllowed: false },
  { extension: "7z", category: "ARCHIVE", mimeTypes: ["application/x-7z-compressed"], previewable: false, isAllowed: false },
  { extension: "mp3", category: "AUDIO", mimeTypes: ["audio/mpeg"], previewable: false, isAllowed: false },
  { extension: "wav", category: "AUDIO", mimeTypes: ["audio/wav", "audio/x-wav"], previewable: false, isAllowed: false },
  { extension: "mp4", category: "VIDEO", mimeTypes: ["video/mp4"], previewable: false, isAllowed: false },
  { extension: "webm", category: "VIDEO", mimeTypes: ["video/webm"], previewable: false, isAllowed: false },
] as const;

async function main() {
  const passwordHash = await argon2.hash(rootPassword, { type: argon2.argon2id });

  await prisma.$transaction(async (tx) => {
    await tx.internalUser.upsert({
      where: { username: rootUsername },
      update: {
        name: rootName,
        passwordHash,
        isActive: true,
        isProtectedRoot: true,
      },
      create: {
        username: rootUsername,
        name: rootName,
        passwordHash,
        isProtectedRoot: true,
        isActive: true,
      },
    });

    for (const [code, permissionName, module] of permissions) {
      await tx.permission.upsert({
        where: { code },
        update: {
          name: permissionName,
          module,
          isActive: true,
        },
        create: {
          code,
          name: permissionName,
          module,
          isActive: true,
        },
      });
    }

    await tx.reportDefinition.upsert({
      where: { code: "chat_logs" },
      update: {
        name: "Chat Logs Report",
        description: "Report histori private dan group chat dengan permission dan data scope.",
        isSystem: true,
        isActive: true,
      },
      create: {
        code: "chat_logs",
        name: "Chat Logs Report",
        description: "Report histori private dan group chat dengan permission dan data scope.",
        isSystem: true,
        isActive: true,
      },
    });

    for (const [key, dataType, category, retentionDays, keepForever] of defaultRetentionPolicies) {
      await tx.retentionPolicy.upsert({
        where: { key },
        update: {
          dataType,
          category,
          retentionDays,
          keepForever,
          isActive: true,
        },
        create: {
          key,
          dataType,
          category,
          retentionDays,
          keepForever,
          isActive: true,
        },
      });
    }

    const existingApplications = await tx.application.findMany({ select: { id: true } });
    for (const application of existingApplications) {
      const key = `APP:${application.id}:attachment:files`;
      await tx.retentionPolicy.upsert({
        where: { key },
        update: {},
        create: {
          key,
          applicationId: application.id,
          dataType: "ATTACHMENT",
          category: "files",
          retentionDays: 30,
          keepForever: false,
          isActive: true,
        },
      });
    }

    const localStorageProvider = await tx.storageProviderConfig.upsert({
      where: { key: "GLOBAL:local-primary" },
      update: {
        name: "Local Primary",
        type: "LOCAL",
        isActive: true,
        isDefault: true,
        config: { basePath: "storage/attachments" },
      },
      create: {
        key: "GLOBAL:local-primary",
        name: "Local Primary",
        type: "LOCAL",
        isActive: true,
        isDefault: true,
        config: { basePath: "storage/attachments" },
      },
    });

    const malwareScannerProvider = await tx.malwareScannerConfig.upsert({
      where: { key: "GLOBAL:clamav-primary" },
      update: {
        name: "ClamAV Primary",
        type: "CLAMAV",
        isActive: true,
        isDefault: true,
        config: { host: "127.0.0.1", port: 3310, timeoutMs: 10000, chunkSizeBytes: 65536 },
      },
      create: {
        key: "GLOBAL:clamav-primary",
        name: "ClamAV Primary",
        type: "CLAMAV",
        isActive: true,
        isDefault: true,
        config: { host: "127.0.0.1", port: 3310, timeoutMs: 10000, chunkSizeBytes: 65536 },
      },
    });

    await tx.attachmentPolicy.upsert({
      where: { key: "GLOBAL" },
      update: {
        inheritGlobal: false,
        enabled: true,
        privateEnabled: true,
        groupEnabled: true,
        maxFileSizeBytes: BigInt(25 * 1024 * 1024),
        maxFilesPerMessage: 5,
        maxTotalSizeBytes: BigInt(50 * 1024 * 1024),
        storageQuotaBytes: BigInt(50 * 1024 * 1024 * 1024),
        imagePreviewEnabled: true,
        pdfPreviewEnabled: true,
        malwareScanEnabled: false,
        malwareScannerProviderId: malwareScannerProvider.id,
        validateMime: true,
        validateSignature: true,
        temporaryTtlMinutes: 60,
        failedCleanupHours: 24,
        uploadRateLimitEnabled: true,
        uploadRateLimitWindowMs: 60_000,
        uploadRateLimitMaxRequests: 10,
        uploadRateLimitMaxBytes: BigInt(100 * 1024 * 1024),
        deleteRetryMaxAttempts: 8,
        deleteRetryBaseMinutes: 5,
        auditDownloadEnabled: true,
        auditPreviewEnabled: true,
        storageProviderId: localStorageProvider.id,
      },
      create: {
        key: "GLOBAL",
        inheritGlobal: false,
        enabled: true,
        privateEnabled: true,
        groupEnabled: true,
        maxFileSizeBytes: BigInt(25 * 1024 * 1024),
        maxFilesPerMessage: 5,
        maxTotalSizeBytes: BigInt(50 * 1024 * 1024),
        storageQuotaBytes: BigInt(50 * 1024 * 1024 * 1024),
        imagePreviewEnabled: true,
        pdfPreviewEnabled: true,
        malwareScanEnabled: false,
        malwareScannerProviderId: malwareScannerProvider.id,
        validateMime: true,
        validateSignature: true,
        temporaryTtlMinutes: 60,
        failedCleanupHours: 24,
        uploadRateLimitEnabled: true,
        uploadRateLimitWindowMs: 60_000,
        uploadRateLimitMaxRequests: 10,
        uploadRateLimitMaxBytes: BigInt(100 * 1024 * 1024),
        deleteRetryMaxAttempts: 8,
        deleteRetryBaseMinutes: 5,
        auditDownloadEnabled: true,
        auditPreviewEnabled: true,
        storageProviderId: localStorageProvider.id,
      },
    });

    for (const fileType of defaultAttachmentFileTypes) {
      const key = `GLOBAL:${fileType.extension}`;
      await tx.attachmentFileType.upsert({
        where: { key },
        update: {
          category: fileType.category,
          extension: fileType.extension,
          mimeTypes: [...fileType.mimeTypes],
          previewable: fileType.previewable,
          isAllowed: fileType.isAllowed,
          isActive: true,
        },
        create: {
          key,
          category: fileType.category,
          extension: fileType.extension,
          mimeTypes: [...fileType.mimeTypes],
          previewable: fileType.previewable,
          isAllowed: fileType.isAllowed,
          isActive: true,
        },
      });
    }

    await tx.systemSetting.upsert({
      where: { key: "presence.cleanup_offline_after_hours" },
      update: {
        value: 8,
        description: "Hapus record presence user yang offline lebih lama dari nilai jam ini.",
      },
      create: {
        key: "presence.cleanup_offline_after_hours",
        value: 8,
        description: "Hapus record presence user yang offline lebih lama dari nilai jam ini.",
      },
    });
  });

  console.log(`Protected ROOT account '${rootUsername}' is ready.`);
  console.log(`${permissions.length} base permissions are ready.`);
  console.log(`${defaultAttachmentFileTypes.length} attachment file-type policies are ready.`);
  console.log("System report, retention, and attachment foundation configuration are ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
