-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('DATABASE', 'API');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "DatabaseType" AS ENUM ('POSTGRESQL', 'MYSQL', 'MARIADB', 'SQLSERVER');

-- CreateEnum
CREATE TYPE "DatabaseSslMode" AS ENUM ('DISABLE', 'REQUIRE');

-- CreateEnum
CREATE TYPE "ApiAuthenticationMode" AS ENUM ('NONE', 'BEARER', 'API_KEY', 'BASIC');

-- CreateEnum
CREATE TYPE "UserSource" AS ENUM ('DATABASE', 'API', 'INTERNAL');

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "GroupSource" AS ENUM ('EXTERNAL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('PRIVATE', 'GROUP');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MESSAGE', 'SYSTEM', 'MODERATION');

-- CreateEnum
CREATE TYPE "ForbiddenWordScope" AS ENUM ('GLOBAL', 'APPLICATION', 'GROUP');

-- CreateEnum
CREATE TYPE "ForbiddenMatchMode" AS ENUM ('EXACT_WORD', 'CONTAINS');

-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('BLOCKED');

-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('INTEGRATION', 'API', 'AUTHENTICATION', 'ERROR', 'SYSTEM', 'USER_ACTIVITY', 'CHAT_ACTIVITY', 'CONTENT_VIOLATION', 'REPORT');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateEnum
CREATE TYPE "RetentionDataType" AS ENUM ('LOG', 'CHAT');

-- CreateEnum
CREATE TYPE "ReportScopeType" AS ENUM ('OWN_GROUP', 'SELECTED_GROUPS', 'ALL_GROUPS');

-- CreateEnum
CREATE TYPE "ReportSubjectType" AS ENUM ('ROLE', 'USER');

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_credentials" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_configs" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DRAFT',
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "isDefaultUserSource" BOOLEAN NOT NULL DEFAULT false,
    "mappingRevision" INTEGER NOT NULL DEFAULT 0,
    "previewedMappingRevision" INTEGER,
    "lastMappingPreviewAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_integration_configs" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "databaseType" "DatabaseType" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "databaseName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEncrypted" TEXT,
    "schemaName" TEXT,
    "sslMode" "DatabaseSslMode" NOT NULL DEFAULT 'DISABLE',
    "userTable" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_integration_configs" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "testEndpoint" TEXT,
    "authenticationMode" "ApiAuthenticationMode" NOT NULL DEFAULT 'NONE',
    "credentialEncrypted" TEXT,
    "requestConfig" JSONB NOT NULL,
    "responseMapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_field_mappings" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "defaultValue" TEXT,
    "transformConfig" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_role_mappings" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceRole" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isProtectedRoot" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "source" "UserSource" NOT NULL,
    "internalUserId" TEXT,
    "displayNameSnapshot" TEXT,
    "sourceReference" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_overrides" (
    "id" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "roleOverrideId" TEXT,
    "isAccessDisabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" "GroupSource" NOT NULL,
    "externalKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_groups" (
    "id" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "source" "GroupSource" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_presence" (
    "id" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "effectiveRoleId" TEXT,
    "status" "PresenceStatus" NOT NULL DEFAULT 'OFFLINE',
    "connectionCount" INTEGER NOT NULL DEFAULT 0,
    "loginAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "logoutAt" TIMESTAMP(3),
    "offlineAt" TIMESTAMP(3),
    "sessionReference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "RoomType" NOT NULL,
    "name" TEXT,
    "groupId" TEXT,
    "privateKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "usernameSnapshot" TEXT NOT NULL,
    "displayNameSnapshot" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderUserIdentityId" TEXT,
    "senderUsername" TEXT NOT NULL,
    "senderName" TEXT,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "replyMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_group_contexts" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_group_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reads" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "usernameSnapshot" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "browserNotificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "muteAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_mutes" (
    "id" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "mutedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "recipientUserIdentityId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "roomId" TEXT,
    "messageId" TEXT,
    "metadata" JSONB,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forbidden_words" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "groupId" TEXT,
    "scope" "ForbiddenWordScope" NOT NULL,
    "pattern" TEXT NOT NULL,
    "normalizedPattern" TEXT NOT NULL,
    "matchMode" "ForbiddenMatchMode" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forbidden_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_violation_logs" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userIdentityId" TEXT,
    "username" TEXT NOT NULL,
    "userName" TEXT,
    "roomId" TEXT,
    "roomType" "RoomType",
    "groupId" TEXT,
    "forbiddenWordId" TEXT,
    "matchedText" TEXT NOT NULL,
    "attemptedMessage" TEXT NOT NULL,
    "status" "ViolationStatus" NOT NULL DEFAULT 'BLOCKED',
    "metadata" JSONB,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_violation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "type" "LogType" NOT NULL,
    "level" "LogLevel" NOT NULL,
    "requestId" TEXT,
    "username" TEXT,
    "action" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "actorInternalUserId" TEXT,
    "actorUsername" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "applicationId" TEXT,
    "dataType" "RetentionDataType" NOT NULL,
    "category" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "keepForever" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_scope_assignments" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "subjectType" "ReportSubjectType" NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "roleId" TEXT,
    "userIdentityId" TEXT,
    "scopeType" "ReportScopeType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_scope_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_scope_groups" (
    "id" TEXT NOT NULL,
    "scopeAssignmentId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_scope_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widget_configs" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'right-bottom',
    "bubbleIconUrl" TEXT,
    "bubbleSize" INTEGER NOT NULL DEFAULT 60,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563EB',
    "windowWidth" INTEGER NOT NULL DEFAULT 380,
    "windowHeight" INTEGER NOT NULL DEFAULT 600,
    "soundEnabledByDefault" BOOLEAN NOT NULL DEFAULT true,
    "browserNotificationEnabledByDefault" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "widget_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_key_key" ON "applications"("key");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "application_credentials_applicationId_isActive_idx" ON "application_credentials"("applicationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "application_credentials_applicationId_keyId_key" ON "application_credentials"("applicationId", "keyId");

-- CreateIndex
CREATE INDEX "integration_configs_applicationId_type_status_idx" ON "integration_configs"("applicationId", "type", "status");

-- CreateIndex
CREATE INDEX "integration_configs_applicationId_isDefaultUserSource_idx" ON "integration_configs"("applicationId", "isDefaultUserSource");

-- CreateIndex
CREATE UNIQUE INDEX "database_integration_configs_integrationId_key" ON "database_integration_configs"("integrationId");

-- CreateIndex
CREATE INDEX "database_integration_configs_databaseType_host_port_idx" ON "database_integration_configs"("databaseType", "host", "port");

-- CreateIndex
CREATE UNIQUE INDEX "api_integration_configs_integrationId_key" ON "api_integration_configs"("integrationId");

-- CreateIndex
CREATE INDEX "api_integration_configs_authenticationMode_idx" ON "api_integration_configs"("authenticationMode");

-- CreateIndex
CREATE UNIQUE INDEX "integration_field_mappings_integrationId_targetField_key" ON "integration_field_mappings"("integrationId", "targetField");

-- CreateIndex
CREATE INDEX "integration_role_mappings_roleId_idx" ON "integration_role_mappings"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_role_mappings_integrationId_sourceRole_key" ON "integration_role_mappings"("integrationId", "sourceRole");

-- CreateIndex
CREATE UNIQUE INDEX "internal_users_username_key" ON "internal_users"("username");

-- CreateIndex
CREATE INDEX "internal_users_isActive_idx" ON "internal_users"("isActive");

-- CreateIndex
CREATE INDEX "user_identities_applicationId_source_isActive_idx" ON "user_identities"("applicationId", "source", "isActive");

-- CreateIndex
CREATE INDEX "user_identities_internalUserId_idx" ON "user_identities"("internalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_applicationId_username_key" ON "user_identities"("applicationId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "user_overrides_userIdentityId_key" ON "user_overrides"("userIdentityId");

-- CreateIndex
CREATE INDEX "user_overrides_roleOverrideId_idx" ON "user_overrides"("roleOverrideId");

-- CreateIndex
CREATE INDEX "roles_applicationId_isActive_idx" ON "roles"("applicationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "roles_applicationId_code_key" ON "roles"("applicationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_isActive_idx" ON "permissions"("module", "isActive");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "user_permission_overrides_permissionId_idx" ON "user_permission_overrides"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_userIdentityId_permissionId_key" ON "user_permission_overrides"("userIdentityId", "permissionId");

-- CreateIndex
CREATE INDEX "groups_applicationId_source_isActive_idx" ON "groups"("applicationId", "source", "isActive");

-- CreateIndex
CREATE INDEX "groups_applicationId_externalKey_idx" ON "groups"("applicationId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "groups_applicationId_code_key" ON "groups"("applicationId", "code");

-- CreateIndex
CREATE INDEX "user_groups_groupId_source_idx" ON "user_groups"("groupId", "source");

-- CreateIndex
CREATE INDEX "user_groups_userIdentityId_isPrimary_idx" ON "user_groups"("userIdentityId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_userIdentityId_groupId_key" ON "user_groups"("userIdentityId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_presence_userIdentityId_key" ON "user_presence"("userIdentityId");

-- CreateIndex
CREATE INDEX "user_presence_status_offlineAt_idx" ON "user_presence"("status", "offlineAt");

-- CreateIndex
CREATE INDEX "user_presence_effectiveRoleId_idx" ON "user_presence"("effectiveRoleId");

-- CreateIndex
CREATE INDEX "rooms_applicationId_type_isActive_idx" ON "rooms"("applicationId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_applicationId_privateKey_key" ON "rooms"("applicationId", "privateKey");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_applicationId_groupId_type_key" ON "rooms"("applicationId", "groupId", "type");

-- CreateIndex
CREATE INDEX "room_members_userIdentityId_isActive_idx" ON "room_members"("userIdentityId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "room_members_roomId_userIdentityId_key" ON "room_members"("roomId", "userIdentityId");

-- CreateIndex
CREATE INDEX "messages_applicationId_roomId_createdAt_idx" ON "messages"("applicationId", "roomId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_applicationId_senderUsername_createdAt_idx" ON "messages"("applicationId", "senderUsername", "createdAt");

-- CreateIndex
CREATE INDEX "messages_replyMessageId_idx" ON "messages"("replyMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_applicationId_clientMessageId_key" ON "messages"("applicationId", "clientMessageId");

-- CreateIndex
CREATE INDEX "message_group_contexts_groupId_messageId_idx" ON "message_group_contexts"("groupId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "message_group_contexts_messageId_groupId_key" ON "message_group_contexts"("messageId", "groupId");

-- CreateIndex
CREATE INDEX "message_reads_userIdentityId_readAt_idx" ON "message_reads"("userIdentityId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_reads_messageId_userIdentityId_key" ON "message_reads"("messageId", "userIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_userIdentityId_key" ON "notification_settings"("userIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "room_mutes_userIdentityId_roomId_key" ON "room_mutes"("userIdentityId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_recipientUserIdentityId_readAt_createdAt_idx" ON "notifications"("recipientUserIdentityId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_recipientUserIdentityId_roomId_readAt_idx" ON "notifications"("recipientUserIdentityId", "roomId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_applicationId_createdAt_idx" ON "notifications"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "forbidden_words_scope_applicationId_groupId_isActive_idx" ON "forbidden_words"("scope", "applicationId", "groupId", "isActive");

-- CreateIndex
CREATE INDEX "forbidden_words_normalizedPattern_matchMode_idx" ON "forbidden_words"("normalizedPattern", "matchMode");

-- CreateIndex
CREATE INDEX "content_violation_logs_applicationId_attemptedAt_idx" ON "content_violation_logs"("applicationId", "attemptedAt");

-- CreateIndex
CREATE INDEX "content_violation_logs_username_attemptedAt_idx" ON "content_violation_logs"("username", "attemptedAt");

-- CreateIndex
CREATE INDEX "content_violation_logs_groupId_attemptedAt_idx" ON "content_violation_logs"("groupId", "attemptedAt");

-- CreateIndex
CREATE INDEX "system_logs_applicationId_type_createdAt_idx" ON "system_logs"("applicationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_level_createdAt_idx" ON "system_logs"("level", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_requestId_idx" ON "system_logs"("requestId");

-- CreateIndex
CREATE INDEX "system_logs_username_createdAt_idx" ON "system_logs"("username", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_applicationId_createdAt_idx" ON "audit_logs"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUsername_createdAt_idx" ON "audit_logs"("actorUsername", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_key_key" ON "retention_policies"("key");

-- CreateIndex
CREATE INDEX "retention_policies_applicationId_dataType_category_isActive_idx" ON "retention_policies"("applicationId", "dataType", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "report_definitions_code_key" ON "report_definitions"("code");

-- CreateIndex
CREATE INDEX "report_definitions_isActive_idx" ON "report_definitions"("isActive");

-- CreateIndex
CREATE INDEX "report_scope_assignments_applicationId_subjectType_idx" ON "report_scope_assignments"("applicationId", "subjectType");

-- CreateIndex
CREATE UNIQUE INDEX "report_scope_assignments_reportId_applicationId_subjectKey_key" ON "report_scope_assignments"("reportId", "applicationId", "subjectKey");

-- CreateIndex
CREATE INDEX "report_scope_groups_groupId_idx" ON "report_scope_groups"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "report_scope_groups_scopeAssignmentId_groupId_key" ON "report_scope_groups"("scopeAssignmentId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "widget_configs_applicationId_key" ON "widget_configs"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "application_credentials" ADD CONSTRAINT "application_credentials_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_integration_configs" ADD CONSTRAINT "database_integration_configs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_integration_configs" ADD CONSTRAINT "api_integration_configs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_field_mappings" ADD CONSTRAINT "integration_field_mappings_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_role_mappings" ADD CONSTRAINT "integration_role_mappings_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integration_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_role_mappings" ADD CONSTRAINT "integration_role_mappings_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_internalUserId_fkey" FOREIGN KEY ("internalUserId") REFERENCES "internal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_overrides" ADD CONSTRAINT "user_overrides_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_overrides" ADD CONSTRAINT "user_overrides_roleOverrideId_fkey" FOREIGN KEY ("roleOverrideId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_effectiveRoleId_fkey" FOREIGN KEY ("effectiveRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderUserIdentityId_fkey" FOREIGN KEY ("senderUserIdentityId") REFERENCES "user_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_replyMessageId_fkey" FOREIGN KEY ("replyMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_group_contexts" ADD CONSTRAINT "message_group_contexts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_group_contexts" ADD CONSTRAINT "message_group_contexts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_mutes" ADD CONSTRAINT "room_mutes_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_mutes" ADD CONSTRAINT "room_mutes_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientUserIdentityId_fkey" FOREIGN KEY ("recipientUserIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_words" ADD CONSTRAINT "forbidden_words_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_words" ADD CONSTRAINT "forbidden_words_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_violation_logs" ADD CONSTRAINT "content_violation_logs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_violation_logs" ADD CONSTRAINT "content_violation_logs_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_violation_logs" ADD CONSTRAINT "content_violation_logs_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_violation_logs" ADD CONSTRAINT "content_violation_logs_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_violation_logs" ADD CONSTRAINT "content_violation_logs_forbiddenWordId_fkey" FOREIGN KEY ("forbiddenWordId") REFERENCES "forbidden_words"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorInternalUserId_fkey" FOREIGN KEY ("actorInternalUserId") REFERENCES "internal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_scope_assignments" ADD CONSTRAINT "report_scope_assignments_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "report_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_scope_assignments" ADD CONSTRAINT "report_scope_assignments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_scope_assignments" ADD CONSTRAINT "report_scope_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_scope_assignments" ADD CONSTRAINT "report_scope_assignments_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_scope_groups" ADD CONSTRAINT "report_scope_groups_scopeAssignmentId_fkey" FOREIGN KEY ("scopeAssignmentId") REFERENCES "report_scope_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_scope_groups" ADD CONSTRAINT "report_scope_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_configs" ADD CONSTRAINT "widget_configs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
