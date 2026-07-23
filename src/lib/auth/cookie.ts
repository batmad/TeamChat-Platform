import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

export async function setSessionCookie(token: string) {
  const env = getServerEnv();
  const store = await cookies();

  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false", // default true, override via .env
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
