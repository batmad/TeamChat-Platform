import "dotenv/config";

import { prisma } from "../src/lib/db/prisma";
import { runAttachmentMaintenance } from "../src/lib/attachments/maintenance/service";

async function main() {
  const batchSizeArg = Number(process.argv[2] ?? 200);
  const batchSize = Number.isFinite(batchSizeArg) && batchSizeArg > 0 ? Math.floor(batchSizeArg) : 200;
  const result = await runAttachmentMaintenance({ batchSize });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
