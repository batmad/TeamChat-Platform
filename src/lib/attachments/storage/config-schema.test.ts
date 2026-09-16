import { describe, expect, it } from "vitest";

import {
  normalizeObjectPrefix,
  storageNamespaceFingerprint,
} from "@/lib/attachments/storage/config-schema";

describe("attachment external storage config", () => {
  it("normalizes safe object prefixes", () => {
    expect(normalizeObjectPrefix("/teamchat/files/")).toBe("teamchat/files/");
    expect(normalizeObjectPrefix("")).toBe("");
  });

  it("rejects unsafe object prefixes", () => {
    expect(() => normalizeObjectPrefix("../secret")).toThrow();
    expect(() => normalizeObjectPrefix("safe/../secret")).toThrow();
  });

  it("does not treat signed-url changes as a storage namespace move", () => {
    const first = storageNamespaceFingerprint("S3", {
      bucket: "teamchat",
      region: "ap-southeast-1",
      forcePathStyle: false,
      credentialMode: "DEFAULT_CHAIN",
      signedUrlEnabled: true,
      signedUrlTtlSeconds: 60,
      prefix: "attachments",
    });
    const second = storageNamespaceFingerprint("S3", {
      bucket: "teamchat",
      region: "ap-southeast-1",
      forcePathStyle: false,
      credentialMode: "DEFAULT_CHAIN",
      signedUrlEnabled: false,
      signedUrlTtlSeconds: 120,
      prefix: "attachments",
    });
    expect(second).toBe(first);
  });

  it("detects bucket/prefix namespace changes", () => {
    const first = storageNamespaceFingerprint("MINIO", {
      endpoint: "https://minio.internal.example",
      bucket: "teamchat",
      region: "us-east-1",
      forcePathStyle: true,
      credentialMode: "STATIC",
      signedUrlEnabled: false,
      signedUrlTtlSeconds: 60,
      prefix: "v1",
    });
    const second = storageNamespaceFingerprint("MINIO", {
      endpoint: "https://minio.internal.example",
      bucket: "teamchat",
      region: "us-east-1",
      forcePathStyle: true,
      credentialMode: "STATIC",
      signedUrlEnabled: false,
      signedUrlTtlSeconds: 60,
      prefix: "v2",
    });
    expect(second).not.toBe(first);
  });
});
