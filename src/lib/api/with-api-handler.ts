import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { getRequestId } from "@/lib/api/request-id";
import { logger } from "@/lib/logger/logger";
import { writeSystemLogSafe } from "@/lib/logs/system-log";

type Handler<TArgs extends unknown[]> = (
  request: Request,
  ...args: TArgs
) => Promise<Response>;

function getApplicationIdFromPath(path: string) {
  const match = path.match(/^\/api\/applications\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function shouldPersistRequestLog(path: string) {
  return path !== "/api/health" && !path.startsWith("/api/logs");
}

async function persistRequestLog(input: {
  path: string;
  method: string;
  requestId: string;
  statusCode: number;
  durationMs: number;
  errorCode?: string | null;
}) {
  if (!shouldPersistRequestLog(input.path)) return;
  await writeSystemLogSafe({
    applicationId: getApplicationIdFromPath(input.path),
    type: "API",
    level:
      input.statusCode >= 500
        ? "ERROR"
        : input.statusCode >= 400
          ? "WARN"
          : "INFO",
    requestId: input.requestId,
    action: "HTTP_REQUEST",
    message: `${input.method} ${input.path} completed with ${input.statusCode}`,
    metadata: {
      method: input.method,
      path: input.path,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      errorCode: input.errorCode ?? null,
    },
  });
}

export function withApiHandler<TArgs extends unknown[]>(
  handler: Handler<TArgs>,
): Handler<TArgs> {
  return async (request, ...args) => {
    const requestId = getRequestId(request);
    const startedAt = performance.now();
    const path = new URL(request.url).pathname;

    try {
      const response = await handler(request, ...args);
      response.headers.set("x-request-id", requestId);
      response.headers.set("cache-control", "no-store");
      response.headers.set("x-content-type-options", "nosniff");
      const durationMs = Math.round(performance.now() - startedAt);

      logger.info(
        {
          requestId,
          method: request.method,
          path,
          statusCode: response.status,
          durationMs,
        },
        "HTTP request completed",
      );

      await persistRequestLog({
        path,
        method: request.method,
        requestId,
        statusCode: response.status,
        durationMs,
      });
      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);

      if (error instanceof AppError) {
        logger.warn(
          {
            requestId,
            method: request.method,
            path,
            statusCode: error.statusCode,
            errorCode: error.code,
            durationMs,
          },
          error.message,
        );

        await persistRequestLog({
          path,
          method: request.method,
          requestId,
          statusCode: error.statusCode,
          durationMs,
          errorCode: error.code,
        });

        return NextResponse.json(
          {
            success: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
            requestId,
          },
          {
            status: error.statusCode,
            headers: {
              "x-request-id": requestId,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }

      if (error instanceof ZodError) {
        await persistRequestLog({
          path,
          method: request.method,
          requestId,
          statusCode: 400,
          durationMs,
          errorCode: "VALIDATION_ERROR",
        });
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed",
              details: error.flatten(),
            },
            requestId,
          },
          {
            status: 400,
            headers: {
              "x-request-id": requestId,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }

      logger.error(
        {
          requestId,
          err: error,
          method: request.method,
          path,
          durationMs,
        },
        "Unhandled API error",
      );

      if (shouldPersistRequestLog(path)) {
        await writeSystemLogSafe({
          applicationId: getApplicationIdFromPath(path),
          type: "ERROR",
          level: "ERROR",
          requestId,
          action: "UNHANDLED_API_ERROR",
          message: `Unhandled error while processing ${request.method} ${path}`,
          metadata: {
            method: request.method,
            path,
            durationMs,
            error,
          },
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred",
          },
          requestId,
        },
        {
          status: 500,
          headers: {
            "x-request-id": requestId,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
  };
}
