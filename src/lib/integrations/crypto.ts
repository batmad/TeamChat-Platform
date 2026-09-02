import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";

const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const env = getServerEnv();
  const material = env.INTEGRATION_ENCRYPTION_KEY ?? env.SESSION_SECRET;
  return createHash("sha256").update(material, "utf8").digest();
}

export function encryptIntegrationSecret(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptIntegrationSecret<T>(encrypted: string | null | undefined): T | null {
  if (!encrypted) return null;
  const [version, ivPart, tagPart, ciphertextPart] = encrypted.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Unsupported encrypted integration secret format");
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
