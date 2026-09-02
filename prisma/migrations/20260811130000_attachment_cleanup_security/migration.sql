-- Package D: attachment cleanup, malware scanning, distributed upload rate limiting,
-- and retry metadata. This migration assumes Package A has already been applied.

CREATE TYPE "MalwareScannerProviderType" AS ENUM ('CLAMAV', 'CUSTOM');

ALTER TABLE "attachment_policies"
  ADD COLUMN "malwareScannerProviderId" TEXT,
  ADD COLUMN "uploadRateLimitEnabled" BOOLEAN,
  ADD COLUMN "uploadRateLimitWindowMs" INTEGER,
  ADD COLUMN "uploadRateLimitMaxRequests" INTEGER,
  ADD COLUMN "uploadRateLimitMaxBytes" BIGINT,
  ADD COLUMN "deleteRetryMaxAttempts" INTEGER,
  ADD COLUMN "deleteRetryBaseMinutes" INTEGER,
  ADD COLUMN "auditDownloadEnabled" BOOLEAN,
  ADD COLUMN "auditPreviewEnabled" BOOLEAN;

ALTER TABLE "message_attachments"
  ADD COLUMN "scanAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scanLastError" TEXT,
  ADD COLUMN "deleteRetryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deleteLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deleteLastError" TEXT;

CREATE TABLE "malware_scanner_configs" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "applicationId" TEXT,
  "name" TEXT NOT NULL,
  "type" "MalwareScannerProviderType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL,
  "credentialEncrypted" TEXT,
  "lastHealthCheckAt" TIMESTAMP(3),
  "lastHealthStatus" TEXT,
  "lastHealthError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "malware_scanner_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attachment_upload_rate_buckets" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "userIdentityId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowMs" INTEGER NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "byteCount" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attachment_upload_rate_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "malware_scanner_configs_key_key" ON "malware_scanner_configs"("key");
CREATE INDEX "malware_scanner_configs_applicationId_isActive_idx" ON "malware_scanner_configs"("applicationId", "isActive");
CREATE INDEX "malware_scanner_configs_type_isActive_idx" ON "malware_scanner_configs"("type", "isActive");

CREATE UNIQUE INDEX "attachment_upload_rate_buckets_applicationId_userIdentityId_windowStart_windowMs_key"
  ON "attachment_upload_rate_buckets"("applicationId", "userIdentityId", "windowStart", "windowMs");
CREATE INDEX "attachment_upload_rate_buckets_windowStart_idx" ON "attachment_upload_rate_buckets"("windowStart");
CREATE INDEX "attachment_upload_rate_buckets_applicationId_userIdentityId_idx" ON "attachment_upload_rate_buckets"("applicationId", "userIdentityId");
CREATE INDEX "attachment_policies_malwareScannerProviderId_idx" ON "attachment_policies"("malwareScannerProviderId");

CREATE INDEX "message_attachments_status_deleteLastAttemptAt_idx" ON "message_attachments"("status", "deleteLastAttemptAt");

ALTER TABLE "malware_scanner_configs"
  ADD CONSTRAINT "malware_scanner_configs_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attachment_policies"
  ADD CONSTRAINT "attachment_policies_malwareScannerProviderId_fkey"
  FOREIGN KEY ("malwareScannerProviderId") REFERENCES "malware_scanner_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attachment_upload_rate_buckets"
  ADD CONSTRAINT "attachment_upload_rate_buckets_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attachment_upload_rate_buckets"
  ADD CONSTRAINT "attachment_upload_rate_buckets_userIdentityId_fkey"
  FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
