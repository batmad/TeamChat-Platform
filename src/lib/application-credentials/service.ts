import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/app-error";
import {
  decryptApplicationSigningSecret,
  encryptApplicationSigningSecret,
  generateApplicationSigningSecret,
} from "@/lib/application-credentials/secret";

export function generateCredentialKeyId(): string {
  return `kid_${randomBytes(12).toString("base64url")}`;
}

export async function createApplicationCredential(input: {
  applicationId: string;
  name: string;
  expiresAt?: Date | null;
}) {
  const application = await prisma.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, key: true, name: true, status: true },
  });
  if (!application)
    throw new AppError(
      404,
      "APPLICATION_NOT_FOUND",
      "Application was not found",
    );
  if (application.status !== "ACTIVE") {
    throw new AppError(
      409,
      "APPLICATION_INACTIVE",
      "Credentials cannot be created for an inactive application",
    );
  }

  const secret = generateApplicationSigningSecret();
  const keyId = generateCredentialKeyId();
  const credential = await prisma.applicationCredential.create({
    data: {
      applicationId: input.applicationId,
      keyId,
      name: input.name,
      secretEncrypted: encryptApplicationSigningSecret(secret),
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      applicationId: true,
      keyId: true,
      name: true,
      isActive: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return {
    credential,
    secret,
    signing: {
      algorithm: "HS256" as const,
      issuer: application.key,
      audience: "chat-widget-bootstrap" as const,
      applicationKey: application.key,
    },
  };
}

export async function getActiveApplicationCredential(
  applicationId: string,
  keyId: string,
) {
  const credential = await prisma.applicationCredential.findFirst({
    where: {
      applicationId,
      keyId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      id: true,
      applicationId: true,
      keyId: true,
      secretEncrypted: true,
      expiresAt: true,
    },
  });

  if (!credential) {
    throw new AppError(
      401,
      "BOOTSTRAP_CREDENTIAL_INVALID",
      "Application signing credential is invalid or expired",
    );
  }

  return {
    ...credential,
    secret: decryptApplicationSigningSecret(credential.secretEncrypted),
  };
}
