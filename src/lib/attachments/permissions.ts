export const ATTACHMENT_PERMISSIONS = {
  PRIVATE: {
    send: "chat.private.attachment.send",
    download: "chat.private.attachment.download",
    preview: "chat.private.attachment.preview",
    delete: "chat.private.attachment.delete",
    deleteOthers: "chat.private.attachment.delete_others",
  },
  GROUP: {
    send: "chat.group.attachment.send",
    download: "chat.group.attachment.download",
    preview: "chat.group.attachment.preview",
    delete: "chat.group.attachment.delete",
    deleteOthers: "chat.group.attachment.delete_others",
  },
} as const;

export type AttachmentRoomType = keyof typeof ATTACHMENT_PERMISSIONS;
export type AttachmentPermissionAction = keyof (typeof ATTACHMENT_PERMISSIONS)["PRIVATE"];

export function attachmentPermissionFor(roomType: AttachmentRoomType, action: AttachmentPermissionAction) {
  return ATTACHMENT_PERMISSIONS[roomType][action];
}
