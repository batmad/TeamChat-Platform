import { redirect } from "next/navigation";

import { AttachmentSettingsManager } from "@/components/attachments/attachment-settings-manager";
import { requireSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { sessionHasPermission } from "@/lib/rbac/guards";

export default async function AttachmentsPage() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "settings.view")) redirect("/unauthorized");

  const applications = session.isRoot
    ? await prisma.application.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, key: true, name: true },
      })
    : session.applicationId
      ? await prisma.application.findMany({
          where: { id: session.applicationId },
          select: { id: true, key: true, name: true },
        })
      : [];

  return (
    <main className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Chat file infrastructure</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Attachments</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Kelola policy upload, file type, preview, retention-related limits, quota, security, dan storage provider attachment.
          </p>
        </div>
        <AttachmentSettingsManager
          isRoot={session.isRoot}
          canManage={sessionHasPermission(session, "settings.manage")}
          currentApplicationId={session.applicationId}
          applications={applications}
        />
      </div>
    </main>
  );
}
