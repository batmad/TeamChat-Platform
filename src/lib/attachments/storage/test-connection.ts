import "server-only";

import { randomUUID } from "node:crypto";

import { createAttachmentStorageProvider } from "@/lib/attachments/storage/factory";
import { prisma } from "@/lib/db/prisma";

export async function testAttachmentStorageConnection(
  providerConfig: Parameters<typeof createAttachmentStorageProvider>[0],
) {
  const provider = createAttachmentStorageProvider(providerConfig);
  const key = `.teamchat-health/${randomUUID()}.probe`;
  const payload = new TextEncoder().encode(`teamchat-storage-probe:${providerConfig.id}`);

  let written = false;
  try {
    const health = await provider.healthCheck();
    if (!health.ok) {
      throw new Error(health.message || "Storage provider health check failed");
    }

    await provider.put({
      key,
      data: payload,
      contentType: "application/octet-stream",
    });
    written = true;

    if (!(await provider.exists(key))) {
      throw new Error("Storage provider wrote the probe but HEAD/exists could not find it");
    }

    const readBack = await provider.read(key);
    if (
      readBack.byteLength !== payload.byteLength ||
      readBack.some((byte, index) => byte !== payload[index])
    ) {
      throw new Error("Storage provider probe read-back verification failed");
    }

    await provider.delete(key);
    written = false;

    await prisma.storageProviderConfig.update({
      where: { id: providerConfig.id },
      data: {
        lastHealthCheckAt: new Date(),
        lastHealthStatus: "HEALTHY",
        lastHealthError: null,
      },
    });

    return { ok: true as const };
  } catch (error) {
    if (written) {
      await provider.delete(key).catch(() => undefined);
    }
    const message =
      error instanceof Error ? error.message : "Storage provider test failed";
    await prisma.storageProviderConfig
      .update({
        where: { id: providerConfig.id },
        data: {
          lastHealthCheckAt: new Date(),
          lastHealthStatus: "UNHEALTHY",
          lastHealthError: message.slice(0, 2000),
        },
      })
      .catch(() => undefined);

    return { ok: false as const, message };
  }
}
