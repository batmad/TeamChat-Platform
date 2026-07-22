import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getServerEnv } from "@/lib/env/server";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function encryptionKey(): Buffer {
  const env = getServerEnv();
  const material =
    env.APPLICATION_CREDENTIAL_ENCRYPTION_KEY ??
    env.INTEGRATION_ENCRYPTION_KEY ??
    env.SESSION_SECRET;

  return createHash("sha256")
    .update("application-credential:", "utf8")
    .update(material, "utf8")
    .digest();
}

export function generateApplicationSigningSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function encryptApplicationSigningSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptApplicationSigningSecret(encrypted: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = encrypted.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Unsupported application credential secret format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
