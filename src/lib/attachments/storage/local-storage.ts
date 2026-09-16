import "server-only";

import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/api/app-error";
import type {
  AttachmentStorageHealth,
  AttachmentStorageProvider,
  AttachmentStoragePutInput,
  AttachmentStoragePutResult,
} from "@/lib/attachments/storage/types";

function isInside(basePath: string, candidatePath: string) {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveLocalStorageBasePath(basePath: string, cwd = process.cwd()) {
  const configuredPath = basePath.trim();
  if (!configuredPath) {
    throw new AppError(
      500,
      "ATTACHMENT_STORAGE_CONFIG_INVALID",
      "Local attachment storage basePath is required",
    );
  }

  const resolved = path.resolve(cwd, configuredPath);
  const filesystemRoot = path.parse(resolved).root;
  if (resolved === filesystemRoot) {
    throw new AppError(
      500,
      "ATTACHMENT_STORAGE_CONFIG_UNSAFE",
      "Local attachment storage cannot use the filesystem root",
    );
  }

  const publicRoot = path.resolve(cwd, "public");
  if (isInside(publicRoot, resolved)) {
    throw new AppError(
      500,
      "ATTACHMENT_STORAGE_CONFIG_UNSAFE",
      "Local attachment storage must not be placed inside the public directory",
    );
  }

  return resolved;
}

function resolveObjectPath(rootPath: string, key: string) {
  if (!key || key.startsWith("/") || key.includes("\\")) {
    throw new AppError(400, "ATTACHMENT_STORAGE_KEY_INVALID", "Attachment storage key is invalid");
  }

  const normalizedKey = path.posix.normalize(key);
  if (normalizedKey === "." || normalizedKey.startsWith("../") || normalizedKey.includes("/../")) {
    throw new AppError(400, "ATTACHMENT_STORAGE_KEY_INVALID", "Attachment storage key is invalid");
  }

  const resolvedPath = path.resolve(rootPath, ...normalizedKey.split("/"));
  if (!isInside(rootPath, resolvedPath) || resolvedPath === rootPath) {
    throw new AppError(400, "ATTACHMENT_STORAGE_KEY_INVALID", "Attachment storage key is invalid");
  }

  return resolvedPath;
}

export class LocalAttachmentStorageProvider implements AttachmentStorageProvider {
  readonly providerType = "LOCAL" as const;
  readonly rootPath: string;

  constructor(
    readonly providerId: string,
    basePath: string,
    cwd?: string,
  ) {
    this.rootPath = resolveLocalStorageBasePath(basePath, cwd);
  }

  async put(input: AttachmentStoragePutInput): Promise<AttachmentStoragePutResult> {
    const objectPath = resolveObjectPath(this.rootPath, input.key);
    await mkdir(path.dirname(objectPath), { recursive: true });

    try {
      await writeFile(objectPath, input.data, { flag: "wx", mode: 0o600 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        throw new AppError(
          409,
          "ATTACHMENT_STORAGE_OBJECT_EXISTS",
          "Attachment storage object already exists",
        );
      }
      throw error;
    }

    return { key: input.key, sizeBytes: input.data.byteLength };
  }

  async read(key: string): Promise<Uint8Array> {
    const objectPath = resolveObjectPath(this.rootPath, key);
    try {
      return await readFile(objectPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError(404, "ATTACHMENT_STORAGE_OBJECT_NOT_FOUND", "Attachment file was not found");
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const objectPath = resolveObjectPath(this.rootPath, key);
    try {
      await access(objectPath, fsConstants.F_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const objectPath = resolveObjectPath(this.rootPath, key);
    await rm(objectPath, { force: true });
  }

  async healthCheck(): Promise<AttachmentStorageHealth> {
    try {
      await mkdir(this.rootPath, { recursive: true });
      await access(this.rootPath, fsConstants.R_OK | fsConstants.W_OK);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Local attachment storage is unavailable",
      };
    }
  }
}
