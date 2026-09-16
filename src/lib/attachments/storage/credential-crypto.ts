import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getServerEnv } from "@/lib/env/server";

const ALGORITHM = "aes-256-gcm";

export type AttachmentStorageStaticCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

function storageCredentialKey(): Buffer {
  const serverEnv = getServerEnv();
  const dedicated = process.env.STORAGE_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (dedicated && dedicated.length < 32) {
    throw new Error("STORAGE_CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters");
  }

  const material =
    dedicated ||
    serverEnv.INTEGRATION_ENCRYPTION_KEY ||
    serverEnv.SESSION_SECRET;

  return createHash("sha256").update(material, "utf8").digest();
}

export function encryptAttachmentStorageCredentials(
  credentials: AttachmentStorageStaticCredentials,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, storageCredentialKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptAttachmentStorageCredentials(
  encrypted: string | null | undefined,
): AttachmentStorageStaticCredentials | null {
  if (!encrypted) return null;

  const [version, ivPart, tagPart, ciphertextPart] = encrypted.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Unsupported encrypted attachment storage credential format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    storageCredentialKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);

  const value = JSON.parse(plaintext.toString("utf8")) as Partial<AttachmentStorageStaticCredentials>;
  if (
    typeof value.accessKeyId !== "string" ||
    !value.accessKeyId ||
    typeof value.secretAccessKey !== "string" ||
    !value.secretAccessKey
  ) {
    throw new Error("Encrypted attachment storage credentials are invalid");
  }

  return {
    accessKeyId: value.accessKeyId,
    secretAccessKey: value.secretAccessKey,
    sessionToken:
      typeof value.sessionToken === "string" && value.sessionToken
        ? value.sessionToken
        : undefined,
  };
}
