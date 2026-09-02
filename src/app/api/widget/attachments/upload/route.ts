import { NextResponse } from "next/server";

import { AppError } from "@/lib/api/app-error";
import { withApiHandler } from "@/lib/api/with-api-handler";
import {
  attachmentPermissionFor,
  type AttachmentRoomType,
} from "@/lib/attachments/permissions";
import { uploadTemporaryAttachments } from "@/lib/attachments/upload/service";
import {
  applyWidgetCors,
  widgetPreflightResponse,
} from "@/lib/widget-auth/cors";
import { requireChatSession } from "@/lib/widget-auth/current-chat-user";
import { getRequestOrigin } from "@//lib/widget-auth/request-origin";

export const runtime = "nodejs";

export const OPTIONS = async (request: Request) =>
  widgetPreflightResponse(request, "POST, OPTIONS");

function parseRoomType(value: FormDataEntryValue | null): AttachmentRoomType {
  if (value === "PRIVATE" || value === "GROUP") return value;
  throw new AppError(
    400,
    "ATTACHMENT_SCOPE_INVALID",
    "Attachment scope must be PRIVATE or GROUP",
  );
}

function getFiles(formData: FormData) {
  const values = [...formData.getAll("files"), ...formData.getAll("file")];
  return values.filter((value): value is File => value instanceof File);
}

const handledPost = withApiHandler(async (request) => {
  const current = await requireChatSession(request);
  const formData = await request.formData();
  const roomType = parseRoomType(formData.get("scope"));
  const files = getFiles(formData);

  const permission = attachmentPermissionFor(roomType, "send");
  if (!current.authorization.permissions.includes(permission)) {
    throw new AppError(
      403,
      "ATTACHMENT_SEND_FORBIDDEN",
      "You do not have permission to send attachments in this chat scope",
    );
  }

  const attachments = await uploadTemporaryAttachments({
    applicationId: current.authorization.applicationId,
    userIdentityId: current.authorization.userIdentityId,
    username: current.authorization.username,
    displayName: current.authorization.displayName,
    roomType,
    files,
  });

  return NextResponse.json(
    {
      success: true,
      data: { attachments },
    },
    { status: 201 },
  );
});

export const POST = async (request: Request) => {
  const requestOrigin = getRequestOrigin(request);
  return applyWidgetCors(await handledPost(request), requestOrigin);
};
