import "dotenv/config";

import { migrateAttachmentStorageBatch } from "../src/lib/attachments/storage/migration";
import { prisma } from "../src/lib/db/prisma";

function option(name: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length);
}

function flag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const sourceProviderId = option("source");
  const targetProviderId = option("target");
  const applicationId = option("application") || null;
  const limit = Number(option("batch") || "25");
  const deleteSource = flag("delete-source");
  const dryRun = flag("dry-run");

  if (!sourceProviderId || !targetProviderId) {
    throw new Error(
      "Usage: npm run attachments:storage:migrate -- --source=<providerId> --target=<providerId> [--application=<applicationId>] [--batch=25] [--delete-source] [--dry-run]",
    );
  }

  let afterId: string | null = null;
  let totalScanned = 0;
  let totalMigrated = 0;
  let totalFailed = 0;

  for (;;) {
    const result = await migrateAttachmentStorageBatch({
      sourceProviderId,
      targetProviderId,
      applicationId,
      afterId,
      limit,
      deleteSource,
      dryRun,
      actorUsername: "system:storage-migration",
    });

    totalScanned += result.scanned;
    totalMigrated += result.migrated;
    totalFailed += result.failed;

    console.log(
      JSON.stringify(
        {
          batch: result,
          total: {
            scanned: totalScanned,
            migrated: totalMigrated,
            failed: totalFailed,
          },
          dryRun,
          deleteSource,
        },
        null,
        2,
      ),
    );

    if (!result.nextAfterId) break;
    afterId = result.nextAfterId;
  }

  if (totalFailed > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
