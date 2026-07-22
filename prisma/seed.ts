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
  ["chat.group.view", "View assigned group chats", "chat"],
  ["chat.group.send", "Send group chat messages", "chat"],
  ["chat.group.view_all", "View all application group chats", "chat"],
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
  console.log("System report and default retention configuration are ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
