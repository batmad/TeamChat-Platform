import "server-only";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { z } from "zod";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env/server";
import { WIDGET_BOOTSTRAP_AUDIENCE } from "@/lib/widget-auth/bootstrap-contract";
import { getActiveApplicationCredential } from "@/lib/application-credentials/service";


const untrustedClaimsSchema = z.object({
  app: z.string().trim().min(1).max(100),
  sub: z.string().trim().min(1).max(500),
});

function signingKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export type VerifiedWidgetBootstrap = {
  application: {
    id: string;
    key: string;
    name: string;
    allowedOrigins: string[];
  };
  credentialId: string;
  credentialKeyId: string;
  userIdentifier: string;
  issuedAt: number;
  expiresAt: number;
};

export async function verifyWidgetBootstrapToken(token: string): Promise<VerifiedWidgetBootstrap> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  let untrusted: z.infer<typeof untrustedClaimsSchema>;

  try {
    header = decodeProtectedHeader(token);
    untrusted = untrustedClaimsSchema.parse(decodeJwt(token));
  } catch {
    throw new AppError(401, "BOOTSTRAP_TOKEN_INVALID", "Bootstrap token is invalid");
  }

  if (header.alg !== "HS256" || typeof header.kid !== "string" || !header.kid) {
    throw new AppError(401, "BOOTSTRAP_TOKEN_HEADER_INVALID", "Bootstrap token header is invalid");
  }

  const application = await prisma.application.findUnique({
    where: { key: untrusted.app },
    select: { id: true, key: true, name: true, status: true, allowedOrigins: true },
  });
  if (!application || application.status !== "ACTIVE") {
    throw new AppError(401, "BOOTSTRAP_APPLICATION_INVALID", "Application is invalid or inactive");
  }

  const credential = await getActiveApplicationCredential(application.id, header.kid);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, signingKey(credential.secret), {
      algorithms: ["HS256"],
      issuer: application.key,
      audience: WIDGET_BOOTSTRAP_AUDIENCE,
      clockTolerance: 5,
    }));
  } catch {
    throw new AppError(401, "BOOTSTRAP_SIGNATURE_INVALID", "Bootstrap token signature or expiry is invalid");
  }

  if (
    payload.app !== application.key ||
    typeof payload.sub !== "string" ||
    !payload.sub.trim() ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new AppError(401, "BOOTSTRAP_CLAIMS_INVALID", "Bootstrap token claims are invalid");
  }

  const maxTtl = getServerEnv().WIDGET_BOOTSTRAP_MAX_TTL_SECONDS;
  if (payload.exp - payload.iat > maxTtl) {
    throw new AppError(401, "BOOTSTRAP_TTL_EXCEEDED", "Bootstrap token lifetime exceeds the allowed maximum");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.iat > now + 30) {
    throw new AppError(401, "BOOTSTRAP_IAT_INVALID", "Bootstrap token issued-at time is invalid");
  }

  await prisma.applicationCredential.update({
    where: { id: credential.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    application: {
      id: application.id,
      key: application.key,
      name: application.name,
      allowedOrigins: application.allowedOrigins,
    },
    credentialId: credential.id,
    credentialKeyId: credential.keyId,
    userIdentifier: payload.sub.trim(),
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}
