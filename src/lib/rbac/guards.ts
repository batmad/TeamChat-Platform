import "server-only";
import { AppError } from "@/lib/api/app-error";
import { getCurrentSession, type CurrentSession } from "@/lib/auth/dal";
import { hasEffectivePermission } from "@/lib/rbac/effective-permissions";

export function sessionHasPermission(session: CurrentSession, permissionCode: string): boolean {
  return hasEffectivePermission(session.permissions, permissionCode, session.isRoot);
}

export async function requireApiSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  }
  return session;
}

export async function requireApiPermission(
  permissionCode: string,
  applicationId?: string,
): Promise<CurrentSession> {
  const session = await requireApiSession();

  if (!session.isRoot && applicationId && session.applicationId !== applicationId) {
    throw new AppError(403, "APPLICATION_SCOPE_DENIED", "Application access is not allowed");
  }

  if (!sessionHasPermission(session, permissionCode)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to perform this action");
  }

  return session;
}

export async function requireApiRoot(): Promise<CurrentSession> {
  const session = await requireApiSession();
  if (!session.isRoot) {
    throw new AppError(403, "ROOT_REQUIRED", "Protected ROOT access is required");
  }
  return session;
}
