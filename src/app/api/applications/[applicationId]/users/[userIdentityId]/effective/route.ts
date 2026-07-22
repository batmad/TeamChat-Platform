import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import { requireApiPermission } from "@/lib/rbac/guards";
import { resolveEffectiveUser } from "@/lib/users/effective-user";

type Context = { params: Promise<{ applicationId: string; userIdentityId: string }> };

export const GET = withApiHandler(async (_request, context: Context) => {
  const { applicationId, userIdentityId } = await context.params;
  await requireApiPermission("users.view", applicationId);
  const effective = await resolveEffectiveUser(userIdentityId);
  if (!effective || effective.applicationId !== applicationId) {
    throw new AppError(404, "USER_NOT_FOUND", "User identity was not found");
  }
  return NextResponse.json({ success: true, data: { user: effective } });
});
