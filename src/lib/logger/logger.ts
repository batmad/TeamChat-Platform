import pino from "pino";
import { getServerEnv } from "@/lib/env/server";

const env = getServerEnv();

export const logger = pino({
  name: "syscca-teamchat-platform",
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "authorization",
      "headers.authorization",
      "cookie",
      "headers.cookie",
      "secret",
      "*.password",
      "*.token",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
