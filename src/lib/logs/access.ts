import type { CurrentSession } from "@/lib/auth/dal";
import { sessionHasPermission } from "@/lib/rbac/guards";
import { AppError } from "@/lib/api/app-error";
import {
  LOG_CATEGORY_PERMISSIONS,
  LOG_CATEGORY_TYPES,
  type LogCategory,
} from "@/lib/logs/rules";

export type { LogCategory } from "@/lib/logs/rules";

export function ensureLogModuleAccess(session: CurrentSession) {
  if (!sessionHasPermission(session, "logs.view")) {
    throw new AppError(403, "FORBIDDEN", "Log module access is not allowed");
  }
}

export function getAllowedSystemLogTypes(session: CurrentSession, requestedCategory?: LogCategory | null) {
  ensureLogModuleAccess(session);
  if (requestedCategory) {
    if (!sessionHasPermission(session, LOG_CATEGORY_PERMISSIONS[requestedCategory])) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to view this log category");
    }
    return LOG_CATEGORY_TYPES[requestedCategory];
  }

  return (Object.keys(LOG_CATEGORY_TYPES) as LogCategory[])
    .filter((category) => sessionHasPermission(session, LOG_CATEGORY_PERMISSIONS[category]))
    .flatMap((category) => LOG_CATEGORY_TYPES[category]);
}
