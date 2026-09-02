export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("@/lib/logger/logger");
    logger.info({ runtime: process.env.NEXT_RUNTIME }, "Application instrumentation initialized");
  }
}
