import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_NAME: z.string().min(1).default("Syscca TeamChat Platform"),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  INTEGRATION_ENCRYPTION_KEY: z.string().min(32).optional(),
  APPLICATION_CREDENTIAL_ENCRYPTION_KEY: z.string().min(32).optional(),
  CHAT_SESSION_SECRET: z.string().min(32).optional(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  CHAT_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(86_400)
    .default(28_800),
  WIDGET_BOOTSTRAP_MAX_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(900)
    .default(300),
  REALTIME_HOST: z.string().min(1).default("0.0.0.0"),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  REALTIME_PATH: z.string().min(1).default("/socket.io"),
  REALTIME_PING_INTERVAL_MS: z.coerce.number().int().min(5_000).default(25_000),
  REALTIME_PING_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(20_000),
  REALTIME_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .default(25_000),
  REALTIME_OFFLINE_GRACE_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(120_000)
    .default(15_000),
  REALTIME_CONNECTION_RECOVERY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(120_000),
  REALTIME_MESSAGE_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(10_000),
  REALTIME_MESSAGE_RATE_LIMIT_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(30),
  PRESENCE_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(3_600_000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

let cachedEnv: z.infer<typeof serverEnvSchema> | undefined;

export function getServerEnv() {
  if (cachedEnv) return cachedEnv;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid server environment variables",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid server environment configuration");
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
