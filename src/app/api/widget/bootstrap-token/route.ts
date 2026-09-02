import { SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SECRET_LENGTH = 500;
const MAX_TEXT_LENGTH = 255;
const EXPIRES_IN_SECONDS = 2 * 60;

interface BootstrapTokenRequest {
  applicationKey?: unknown;
  signingKeyId?: unknown;
  signingSecret?: unknown;
  username?: unknown;
}

interface ErrorResponse {
  success: false;
  message: string;
}

interface SuccessResponse {
  success: true;
  bootstrapToken: string;
  expiresIn: number;
  expiresAt: string;
}

type ApiResponse = ErrorResponse | SuccessResponse;

function normalizeString(
  value: unknown,
  maxLength: number = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function jsonResponse(
  body: ApiResponse,
  status: number = 200,
): NextResponse<ApiResponse> {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiResponse>> {
  try {
    let body: BootstrapTokenRequest;

    try {
      body = (await request.json()) as BootstrapTokenRequest;
    } catch {
      return jsonResponse(
        {
          success: false,
          message: "Request body harus berupa JSON yang valid.",
        },
        400,
      );
    }

    const applicationKey = normalizeString(body.applicationKey);
    const signingKeyId = normalizeString(body.signingKeyId);
    const signingSecret = normalizeString(
      body.signingSecret,
      MAX_SECRET_LENGTH,
    );
    const username = normalizeString(body.username);

    if (!applicationKey) {
      return jsonResponse(
        {
          success: false,
          message: "Application Key wajib diisi.",
        },
        400,
      );
    }

    if (!signingKeyId) {
      return jsonResponse(
        {
          success: false,
          message: "Signing Key ID wajib diisi.",
        },
        400,
      );
    }

    if (!signingSecret) {
      return jsonResponse(
        {
          success: false,
          message: "Signing Secret wajib diisi.",
        },
        400,
      );
    }

    if (signingSecret.length < 32) {
      return jsonResponse(
        {
          success: false,
          message: "Signing Secret minimal 32 karakter.",
        },
        400,
      );
    }

    if (!username) {
      return jsonResponse(
        {
          success: false,
          message: "Username wajib diisi.",
        },
        400,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const secretKey = new TextEncoder().encode(signingSecret);

    const bootstrapToken = await new SignJWT({
      app: applicationKey,
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "JWT",
        kid: signingKeyId,
      })
      .setSubject(username)
      .setIssuer(applicationKey)
      .setAudience("chat-widget-bootstrap")
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + EXPIRES_IN_SECONDS)
      .setJti(crypto.randomUUID())
      .sign(secretKey);

    return jsonResponse({
      success: true,
      bootstrapToken,
      expiresIn: EXPIRES_IN_SECONDS,
      expiresAt: new Date((now + EXPIRES_IN_SECONDS) * 1000).toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "Generate TeamChat bootstrap token error:",
      error instanceof Error ? error.message : error,
    );

    return jsonResponse(
      {
        success: false,
        message: "Gagal menghasilkan bootstrap token.",
      },
      500,
    );
  }
}

export function GET(): NextResponse<ApiResponse> {
  return jsonResponse(
    {
      success: false,
      message: "Gunakan method POST.",
    },
    405,
  );
}
