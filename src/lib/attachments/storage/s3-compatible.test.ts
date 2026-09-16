import { describe, expect, it } from "vitest";

import {
  buildS3ClientConfig,
  buildS3CompatibleObjectKey,
} from "@/lib/attachments/storage/s3-compatible";

describe("S3-compatible attachment storage", () => {
  it("keeps the TeamChat logical key and applies provider prefix internally", () => {
    expect(
      buildS3CompatibleObjectKey(
        "tenant-files/",
        "app-1/2026/08/attachment/file.bin",
      ),
    ).toBe("tenant-files/app-1/2026/08/attachment/file.bin");
  });

  it("rejects traversal and absolute logical keys", () => {
    expect(() => buildS3CompatibleObjectKey("", "../secret")).toThrow();
    expect(() => buildS3CompatibleObjectKey("", "/absolute")).toThrow();
    expect(() => buildS3CompatibleObjectKey("", "safe/../secret")).toThrow();
  });

  it("builds custom-endpoint/path-style config for S3 compatible services", () => {
    const config = buildS3ClientConfig({
      region: "us-east-1",
      endpoint: "https://minio.example.test",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
    });

    expect(config.region).toBe("us-east-1");
    expect(config.endpoint).toBe("https://minio.example.test");
    expect(config.forcePathStyle).toBe(true);
    expect(config.credentials).toEqual({
      accessKeyId: "access",
      secretAccessKey: "secret",
      sessionToken: undefined,
    });
  });
});
