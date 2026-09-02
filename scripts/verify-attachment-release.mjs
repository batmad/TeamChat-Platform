#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const failures = [];
const checks = [];

async function exists(relative) {
  try {
    await stat(path.join(repoRoot, relative));
    return true;
  } catch {
    return false;
  }
}

async function requireFile(relative) {
  if (!(await exists(relative))) {
    failures.push(`missing ${relative}`);
    return null;
  }
  checks.push(`found ${relative}`);
  return readFile(path.join(repoRoot, relative), "utf8");
}

for (const relative of [
  "src/lib/attachments/config.ts",
  "src/lib/attachments/upload/service.ts",
  "src/lib/attachments/message/binding.ts",
  "src/lib/attachments/maintenance/service.ts",
  "src/lib/attachments/storage/s3-compatible.ts",
  "src/app/api/widget/attachments/upload/route.ts",
  "src/app/api/widget/attachments/config/route.ts",
  "src/app/api/widget/attachments/[attachmentId]/access/route.ts",
  "src/app/dashboard/attachments/page.tsx",
  "public/chat-widget-attachments.js",
]) {
  await requireFile(relative);
}

const schema = await requireFile("prisma/schema.prisma");
if (schema) {
  for (const marker of [
    "model MessageAttachment",
    "model AttachmentPolicy",
    "model AttachmentFileType",
    "model StorageProviderConfig",
    "model MalwareScannerConfig",
  ]) {
    if (!schema.includes(marker)) failures.push(`schema missing ${marker}`);
  }
}

for (const relative of [
  "public/chat-widget.js",
  "public/chat-widget-group-chat.js",
  "public/chat-widget-private-chat.js",
  "public/chat-widget-realtime.js",
  "public/chat-widget-attachments.js",
]) {
  const source = await requireFile(relative);
  if (!source) continue;
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(source)) {
    failures.push(`conflict marker in ${relative}`);
  }
  try {
    new vm.Script(source, { filename: relative });
    checks.push(`syntax ${relative}`);
  } catch (error) {
    failures.push(`syntax ${relative}: ${error.message}`);
  }
}

const integrationMarkers = {
  "public/chat-widget.js": ["/chat-widget-attachments.js"],
  "public/chat-widget-group-chat.js": [
    "attachmentIds: Array.isArray(options.attachmentIds)",
  ],
  "public/chat-widget-private-chat.js": [
    "attachmentIds: Array.isArray(options.attachmentIds)",
  ],
  "public/chat-widget-realtime.js": [
    "attachment:deleted",
    "Client.prototype.deleteAttachment",
  ],
  "src/lib/rbac/menu.ts": ["/dashboard/attachments"],
};
for (const [relative, markers] of Object.entries(integrationMarkers)) {
  const source = await requireFile(relative);
  if (!source) continue;
  for (const marker of markers) {
    if (!source.includes(marker))
      failures.push(`${relative} missing integration marker: ${marker}`);
    else checks.push(`integration ${relative}: ${marker}`);
  }
}

const packageJsonText = await requireFile("package.json");
if (packageJsonText) {
  const packageJson = JSON.parse(packageJsonText);
  for (const dependency of [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ]) {
    if (
      !packageJson.dependencies?.[dependency] &&
      !packageJson.devDependencies?.[dependency]
    ) {
      failures.push(
        `package.json missing ${dependency} (Package E prerequisite)`,
      );
    }
  }
  if (!packageJson.scripts?.["attachments:maintenance"]) {
    failures.push("package.json missing attachments:maintenance");
  }
  if (!packageJson.scripts?.["attachments:storage:migrate"]) {
    failures.push("package.json missing attachments:storage:migrate");
  }
  if (!packageJson.scripts?.["attachments:release:verify"]) {
    failures.push("package.json missing attachments:release:verify");
  }
}

const baseUrl = process.env.ATTACHMENT_SMOKE_BASE_URL?.replace(/\/+$/, "");
const token = process.env.ATTACHMENT_SMOKE_TOKEN;
if (baseUrl && token) {
  const response = await fetch(`${baseUrl}/api/widget/attachments/config`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    failures.push(`authenticated config smoke failed (${response.status})`);
  } else {
    checks.push("authenticated attachment config smoke");
  }

  const smokeFile = process.env.ATTACHMENT_SMOKE_FILE;
  if (smokeFile) {
    const { readFile: readBinary } = await import("node:fs/promises");
    const data = await readBinary(path.resolve(smokeFile));
    const form = new FormData();
    form.append(
      "scope",
      process.env.ATTACHMENT_SMOKE_SCOPE === "GROUP" ? "GROUP" : "PRIVATE",
    );
    form.append("files", new Blob([data]), path.basename(smokeFile));
    const uploadResponse = await fetch(
      `${baseUrl}/api/widget/attachments/upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
    const upload = await uploadResponse.json().catch(() => null);
    if (
      !uploadResponse.ok ||
      !upload?.success ||
      !upload.data?.attachments?.[0]?.id
    ) {
      failures.push(`upload smoke failed (${uploadResponse.status})`);
    } else {
      checks.push("attachment upload smoke");
      const attachmentId = upload.data.attachments[0].id;
      const discardResponse = await fetch(
        `${baseUrl}/api/widget/attachments/${encodeURIComponent(attachmentId)}/discard`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!discardResponse.ok)
        failures.push(`discard smoke failed (${discardResponse.status})`);
      else checks.push("temporary attachment discard smoke");
    }
  }
}

console.log(`Attachment release checks: ${checks.length} passed`);
for (const check of checks) console.log(`  ✓ ${check}`);
if (failures.length) {
  console.error(`Attachment release checks: ${failures.length} failed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Attachment release verification PASS");
}
