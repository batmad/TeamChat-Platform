import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalAttachmentStorageProvider } from "@/lib/attachments/storage/local-storage";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalAttachmentStorageProvider", () => {
  it("supports put/read/exists/delete", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "teamchat-attachment-test-"));
    roots.push(cwd);
    const provider = new LocalAttachmentStorageProvider("local-test", "private-storage", cwd);
    const key = "app/2026/08/att/att.bin";
    const bytes = new TextEncoder().encode("hello");

    await provider.put({ key, data: bytes });
    expect(await provider.exists(key)).toBe(true);
    expect(new TextDecoder().decode(await provider.read(key))).toBe("hello");

    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
  });

  it("rejects path traversal keys", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "teamchat-attachment-test-"));
    roots.push(cwd);
    const provider = new LocalAttachmentStorageProvider("local-test", "private-storage", cwd);

    await expect(provider.put({ key: "../escape.bin", data: new Uint8Array([1]) })).rejects.toMatchObject({
      code: "ATTACHMENT_STORAGE_KEY_INVALID",
    });
  });

  it("rejects a public storage directory", () => {
    expect(() => new LocalAttachmentStorageProvider("local-test", "public/attachments", "/tmp/teamchat-app")).toThrow(
      /public directory/i,
    );
  });
});
