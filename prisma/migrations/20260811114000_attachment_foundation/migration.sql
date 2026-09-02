-- Extend retention types for independent attachment retention.
ALTER TYPE "RetentionDataType" ADD VALUE 'ATTACHMENT';

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM (
  'TEMPORARY',
  'UPLOADING',
  'SCANNING',
  'READY',
  'FAILED',
  'REJECTED',
  'EXPIRED',
  'DELETING',
  'DELETED',
  'DELETE_FAILED'
);

-- CreateEnum
CREATE TYPE "AttachmentScanStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'SCANNING',
  'CLEAN',
  'INFECTED',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "StorageProviderType" AS ENUM ('LOCAL', 'S3', 'MINIO', 'AZURE_BLOB', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AttachmentFileCategory" AS ENUM (
  'IMAGE',
  'DOCUMENT',
  'SPREADSHEET',
  'ARCHIVE',
  'AUDIO',
  'VIDEO',
  'TEXT',
  'OTHER'
);

-- CreateTable
CREATE TABLE "storage_provider_configs" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "applicationId" TEXT,
  "name" TEXT NOT NULL,
  "type" "StorageProviderType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL,
  "credentialEncrypted" TEXT,
  "lastHealthCheckAt" TIMESTAMP(3),
  "lastHealthStatus" TEXT,
  "lastHealthError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "storage_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment_policies" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "applicationId" TEXT,
  "inheritGlobal" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN,
  "privateEnabled" BOOLEAN,
  "groupEnabled" BOOLEAN,
  "maxFileSizeBytes" BIGINT,
  "maxFilesPerMessage" INTEGER,
  "maxTotalSizeBytes" BIGINT,
  "storageQuotaBytes" BIGINT,
  "imagePreviewEnabled" BOOLEAN,
  "pdfPreviewEnabled" BOOLEAN,
  "malwareScanEnabled" BOOLEAN,
  "validateMime" BOOLEAN,
  "validateSignature" BOOLEAN,
  "temporaryTtlMinutes" INTEGER,
  "failedCleanupHours" INTEGER,
  "storageProviderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attachment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment_file_types" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "applicationId" TEXT,
  "category" "AttachmentFileCategory" NOT NULL,
  "extension" TEXT NOT NULL,
  "mimeTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "maxSizeBytes" BIGINT,
  "previewable" BOOLEAN NOT NULL DEFAULT false,
  "isAllowed" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attachment_file_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "messageId" TEXT,
  "uploadedByUserIdentityId" TEXT,
  "uploadedByUsername" TEXT NOT NULL,
  "uploadedByName" TEXT,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "detectedMimeType" TEXT,
  "sizeBytes" BIGINT NOT NULL,
  "checksum" TEXT,
  "checksumAlgorithm" TEXT DEFAULT 'SHA256',
  "storageProviderId" TEXT,
  "storageKey" TEXT,
  "status" "AttachmentStatus" NOT NULL DEFAULT 'TEMPORARY',
  "scanStatus" "AttachmentScanStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "scanProvider" TEXT,
  "scanResult" JSONB,
  "scannedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "deletedByUserIdentityId" TEXT,
  "deleteReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_provider_configs_key_key" ON "storage_provider_configs"("key");
CREATE INDEX "storage_provider_configs_applicationId_isActive_idx" ON "storage_provider_configs"("applicationId", "isActive");
CREATE INDEX "storage_provider_configs_type_isActive_idx" ON "storage_provider_configs"("type", "isActive");

CREATE UNIQUE INDEX "attachment_policies_key_key" ON "attachment_policies"("key");
CREATE UNIQUE INDEX "attachment_policies_applicationId_key" ON "attachment_policies"("applicationId");
CREATE INDEX "attachment_policies_applicationId_idx" ON "attachment_policies"("applicationId");
CREATE INDEX "attachment_policies_storageProviderId_idx" ON "attachment_policies"("storageProviderId");

CREATE UNIQUE INDEX "attachment_file_types_key_key" ON "attachment_file_types"("key");
CREATE UNIQUE INDEX "attachment_file_types_applicationId_extension_key" ON "attachment_file_types"("applicationId", "extension");
CREATE INDEX "attachment_file_types_applicationId_extension_isActive_idx" ON "attachment_file_types"("applicationId", "extension", "isActive");
CREATE INDEX "attachment_file_types_category_isAllowed_isActive_idx" ON "attachment_file_types"("category", "isAllowed", "isActive");

CREATE INDEX "message_attachments_applicationId_messageId_createdAt_idx" ON "message_attachments"("applicationId", "messageId", "createdAt");
CREATE INDEX "message_attachments_applicationId_status_createdAt_idx" ON "message_attachments"("applicationId", "status", "createdAt");
CREATE INDEX "message_attachments_uploadedByUserIdentityId_createdAt_idx" ON "message_attachments"("uploadedByUserIdentityId", "createdAt");
CREATE INDEX "message_attachments_expiresAt_status_idx" ON "message_attachments"("expiresAt", "status");
CREATE INDEX "message_attachments_storageProviderId_status_idx" ON "message_attachments"("storageProviderId", "status");

-- AddForeignKey
ALTER TABLE "storage_provider_configs"
  ADD CONSTRAINT "storage_provider_configs_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attachment_policies"
  ADD CONSTRAINT "attachment_policies_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attachment_policies"
  ADD CONSTRAINT "attachment_policies_storageProviderId_fkey"
  FOREIGN KEY ("storageProviderId") REFERENCES "storage_provider_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attachment_file_types"
  ADD CONSTRAINT "attachment_file_types_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_attachments"
  ADD CONSTRAINT "message_attachments_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_attachments"
  ADD CONSTRAINT "message_attachments_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_attachments"
  ADD CONSTRAINT "message_attachments_uploadedByUserIdentityId_fkey"
  FOREIGN KEY ("uploadedByUserIdentityId") REFERENCES "user_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_attachments"
  ADD CONSTRAINT "message_attachments_deletedByUserIdentityId_fkey"
  FOREIGN KEY ("deletedByUserIdentityId") REFERENCES "user_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_attachments"
  ADD CONSTRAINT "message_attachments_storageProviderId_fkey"
  FOREIGN KEY ("storageProviderId") REFERENCES "storage_provider_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
