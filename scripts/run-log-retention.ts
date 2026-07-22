import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { runLogRetentionCleanup } from "../src/lib/logs/retention";

async function main() {
  const result = await runLogRetentionCleanup();
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
